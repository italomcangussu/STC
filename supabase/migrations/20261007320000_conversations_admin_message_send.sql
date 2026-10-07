-- Assessor: o administrador pede para o João chamar um sócio no privado e mandar uma mensagem ("chame o Igor e mande o link do app").
-- N1: resumo com o texto exato + "sim" do próprio administrador. Se o sócio ainda não tem conversa, ela é aberta (contato por telefone
-- do cadastro, vinculado ao perfil). O envio usa a mesma fila dos retornos (conv_followups com send_body, vencimento agora): sai na
-- próxima varredura do despacho, com a mesma trava de opt-out e de canal. Quando o sócio responde, quem atende é o João.
do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_message_send'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

create function conv_private.ai_admin_message_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_admin uuid; v_id uuid; v_payload jsonb;
  v_profile uuid := nullif(p->>'profile_id', '')::uuid; pr public.profiles%rowtype; v_body text := trim(coalesce(p->>'body', ''));
  v_phone text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  select * into pr from public.profiles where id = v_profile and coalesce(is_active, true);
  if pr.id is null then return conv_private.vfail('MEMBER_NOT_FOUND', 'Não achei esse sócio ativo.'); end if;
  v_phone := conv_private.phone_e164(pr.phone);
  if v_phone is null or length(v_phone) < 12 then
    return conv_private.vfail('NO_PHONE', pr.name || ' não tem telefone válido no cadastro, então não consigo chamar no WhatsApp.');
  end if;
  if exists (select 1 from public.conv_contacts c where c.phone = v_phone and c.opt_out) then
    return conv_private.vfail('OPT_OUT', pr.name || ' pediu para não receber mensagens por aqui.');
  end if;
  if length(v_body) not between 3 and 1000 then return conv_private.vfail('INVALID_BODY', 'Qual o texto da mensagem?'); end if;
  v_payload := jsonb_build_object('profile_id', pr.id, 'member_name', pr.name, 'phone', v_phone, 'body', v_body);
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, 'adm_message_send', v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'adm_message_send', 'summary', v_payload);
end $$;

create function public.conv_svc_ai_admin_message_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_message_propose(p_session, p) $$;

alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_pre_message_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid; v_res jsonb; v_err text; v_code text;
  v_contact uuid; v_conv uuid; v_fu uuid;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action <> 'adm_message_send' then return conv_private.ai_confirm_pre_message_step(p_proposal, p_message); end if;
  if bp.status = 'confirmed' then return jsonb_build_object('ok', true, 'replayed', true, 'action', bp.action, 'summary', bp.payload); end if;
  if bp.status <> 'open' then return conv_private.vfail('PROPOSAL_CLOSED', 'Essa proposta não está mais aberta.'); end if;
  if bp.expires_at <= now() then
    update public.conv_booking_proposals set status = 'expired' where id = bp.id;
    return conv_private.vfail('PROPOSAL_EXPIRED', 'A proposta venceu. Posso montar outra.');
  end if;
  select * into m from public.conv_messages where id = p_message and direction = 'inbound' and conversation_id = bp.conversation_id;
  if not found or m.created_at <= bp.created_at then
    return conv_private.vfail('CONFIRMATION_NOT_AFTER_PROPOSAL', 'A confirmação precisa vir depois da proposta.');
  end if;
  if m.kind <> 'text' or not (conv_private.is_confirmation(m.body) or conv_private.is_semantic_acceptance(m.body, false)) then
    return conv_private.vfail('NOT_EXPLICIT', 'Não entendi como confirmação clara.');
  end if;
  if m.sender_contact_id is distinct from bp.requester_contact_id then
    return conv_private.vfail('NOT_AUTHORIZED_TO_CONFIRM', 'Só o administrador que pediu pode confirmar.');
  end if;
  v_admin := conv_private.ai_admin_requester(bp.session_id);
  if v_admin is null or v_admin <> bp.requester_profile_id then
    update public.conv_booking_proposals set status = 'failed', failure_code = 'ADMIN_ONLY_PRIVATE' where id = bp.id;
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  begin
    if exists (select 1 from public.conv_contacts c where c.phone = bp.payload->>'phone' and c.opt_out) then raise exception 'OPT_OUT'; end if;
    v_contact := conv_private.upsert_contact(bp.payload->>'phone', null, bp.payload->>'member_name', true);
    v_conv := conv_private.open_direct(v_contact);
    insert into public.conv_followups(conversation_id, due_at, note, send_body, created_by)
    values (v_conv, now(), 'Mensagem pedida pelo administrador (WhatsApp)', bp.payload->>'body', v_admin) returning id into v_fu;
    v_res := jsonb_build_object('conversation_id', v_conv, 'followup_id', v_fu);
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'ADMIN_ACTION_FAILED' end;
    update public.conv_booking_proposals set status = 'failed', failure_code = v_code where id = bp.id;
    return conv_private.vfail(v_code, 'Não consegui concluir: ' || v_code || '.');
  end if;
  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('result', v_res) where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'conv_conversations', v_conv::text, null,
    jsonb_build_object('action', bp.action, 'member', bp.payload->>'profile_id'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('result', v_res));
end $$;

revoke all on function conv_private.ai_admin_message_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_message_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_message_propose(uuid, jsonb) to service_role;
revoke all on function conv_private.ai_confirm_pre_message_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
