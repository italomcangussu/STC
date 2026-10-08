-- Assessor: comunicado da diretoria no WhatsApp pessoal de cada sócio ("dispare este texto às 8h00"). N1: o resumo mostra o texto exato,
-- quantos sócios recebem e o horário; só depois do "sim" do administrador. Cada sócio vira uma mensagem na fila dos retornos
-- (conv_followups com send_body e vencimento no horário escolhido), com a mesma trava de opt-out e canal. Resposta do sócio: quem atende é o João.
do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_broadcast_send'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

create function conv_private.ai_admin_broadcast_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_admin uuid; v_id uuid; v_payload jsonb;
  v_body text := trim(coalesce(p->>'body', '')); v_at timestamptz; v_rec jsonb; v_n int; v_skipped int;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  if length(v_body) not between 10 and 3500 then return conv_private.vfail('INVALID_BODY', 'Qual o texto do comunicado?'); end if;
  v_at := coalesce(nullif(p->>'send_at', '')::timestamptz, now());
  if v_at < now() then v_at := now(); end if;
  if v_at > now() + interval '7 days' then return conv_private.vfail('INVALID_DATE', 'Só consigo agendar até 7 dias à frente.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', x.id, 'name', x.name, 'phone', x.ph) order by x.name), '[]'::jsonb), count(*)
    into v_rec, v_n
  from (select pr.id, pr.name, conv_private.phone_e164(pr.phone) ph from public.profiles pr
        where coalesce(pr.is_active, true) and pr.role::text in ('socio', 'admin') and pr.id <> v_admin) x
  where x.ph is not null and length(x.ph) >= 12
    and not exists (select 1 from public.conv_contacts c where c.phone = x.ph and c.opt_out);
  if v_n = 0 then return conv_private.vfail('NO_RECIPIENTS', 'Não achei sócio com telefone válido para receber.'); end if;
  select count(*) into v_skipped from public.profiles pr
    where coalesce(pr.is_active, true) and pr.role::text in ('socio', 'admin') and pr.id <> v_admin;
  v_skipped := v_skipped - v_n;
  v_payload := jsonb_build_object('body', v_body, 'send_at', v_at, 'count', v_n, 'skipped', v_skipped, 'recipients', v_rec);
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, 'adm_broadcast_send', v_payload,
    now() + make_interval(mins => greatest(coalesce(s.proposal_ttl_minutes, 20), 30)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'adm_broadcast_send', 'summary', v_payload - 'recipients');
end $$;

create function public.conv_svc_ai_admin_broadcast_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_broadcast_propose(p_session, p) $$;

alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_pre_broadcast_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid; v_err text; v_code text;
  r jsonb; v_contact uuid; v_conv uuid; v_n int := 0; v_at timestamptz;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action <> 'adm_broadcast_send' then return conv_private.ai_confirm_pre_broadcast_step(p_proposal, p_message); end if;
  if bp.status = 'confirmed' then return jsonb_build_object('ok', true, 'replayed', true, 'action', bp.action, 'summary', bp.payload - 'recipients'); end if;
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
  v_at := greatest((bp.payload->>'send_at')::timestamptz, now());
  begin
    for r in select * from jsonb_array_elements(bp.payload->'recipients') loop
      if exists (select 1 from public.conv_contacts c where c.phone = r->>'phone' and c.opt_out) then continue; end if;
      v_contact := conv_private.upsert_contact(r->>'phone', null, r->>'name', true);
      v_conv := conv_private.open_direct(v_contact);
      insert into public.conv_followups(conversation_id, due_at, note, send_body, created_by)
      values (v_conv, v_at, 'Comunicado da diretoria (WhatsApp)', bp.payload->>'body', v_admin);
      v_n := v_n + 1;
    end loop;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'ADMIN_ACTION_FAILED' end;
    update public.conv_booking_proposals set status = 'failed', failure_code = v_code where id = bp.id;
    return conv_private.vfail(v_code, 'Não consegui concluir: ' || v_code || '.');
  end if;
  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id,
    payload = (bp.payload - 'recipients') || jsonb_build_object('queued', v_n) where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'conv_booking_proposals', bp.id::text, null,
    jsonb_build_object('action', bp.action, 'queued', v_n, 'send_at', v_at),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', (bp.payload - 'recipients') || jsonb_build_object('queued', v_n));
end $$;

revoke all on function conv_private.ai_admin_broadcast_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_broadcast_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_broadcast_propose(uuid, jsonb) to service_role;
revoke all on function conv_private.ai_confirm_pre_broadcast_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
