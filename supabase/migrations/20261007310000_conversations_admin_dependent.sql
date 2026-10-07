-- Assessor: cadastrar dependente de sócio (esposa, esposo, filho, filha, outro) pelo WhatsApp. N1: resumo + "sim" do próprio
-- administrador. Grava como o painel: `non_socio_students` (student_type 'dependent', sem cobrança) + `student_profiles`.
-- CPF não faz parte do cadastro de dependente (nenhuma coluna guarda), então o João não pede nem grava.
do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_dependent_create'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

create function conv_private.ai_admin_dependent_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_admin uuid; v_id uuid; v_payload jsonb;
  v_profile uuid := nullif(p->>'profile_id', '')::uuid; v_name text; v_dep text := regexp_replace(trim(coalesce(p->>'dependent_name', '')), '\s+', ' ', 'g');
  v_rel text := lower(coalesce(p->>'relationship', '')); v_phone text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;
  select name into v_name from public.profiles where id = v_profile and role::text in ('socio', 'admin') and coalesce(is_active, true);
  if v_name is null then return conv_private.vfail('MEMBER_NOT_FOUND', 'Não achei esse sócio ativo para ser o responsável.'); end if;
  if length(v_dep) < 3 or length(v_dep) > 120 then return conv_private.vfail('INVALID_NAME', 'Qual o nome completo do dependente?'); end if;
  if v_rel not in ('filho', 'filha', 'esposo', 'esposa', 'outro') then
    return conv_private.vfail('INVALID_RELATIONSHIP', 'Qual o parentesco com ' || v_name || ': esposa, esposo, filho, filha ou outro?');
  end if;
  if v_phone <> '' and length(v_phone) not between 10 and 13 then
    return conv_private.vfail('INVALID_PHONE', 'O telefone precisa ter DDD. Pode conferir? (O telefone é opcional.)');
  end if;
  if exists (select 1 from public.non_socio_students n where n.responsible_socio_id = v_profile and n.student_type = 'dependent'
             and coalesce(n.is_active, true) and fin_private.fold_text(n.name) = fin_private.fold_text(v_dep)) then
    return conv_private.vfail('DEPENDENT_EXISTS', v_dep || ' já está cadastrado(a) como dependente de ' || v_name || '.');
  end if;
  v_payload := jsonb_strip_nulls(jsonb_build_object('profile_id', v_profile, 'member_name', v_name, 'dependent_name', v_dep,
    'relationship', v_rel, 'phone', nullif(v_phone, '')));
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, 'adm_dependent_create', v_payload,
    now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'adm_dependent_create', 'summary', v_payload);
end $$;

create function public.conv_svc_ai_admin_dependent_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_dependent_propose(p_session, p) $$;

-- ---------------------------------------------------------------------------------------------- execução
alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_pre_dependent_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid; v_id uuid; v_res jsonb; v_err text; v_code text;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action <> 'adm_dependent_create' then return conv_private.ai_confirm_pre_dependent_step(p_proposal, p_message); end if;
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
    if not exists (select 1 from public.profiles where id = (bp.payload->>'profile_id')::uuid and role::text in ('socio', 'admin') and coalesce(is_active, true)) then
      raise exception 'MEMBER_NOT_FOUND';
    end if;
    insert into public.non_socio_students(name, phone, student_type, responsible_socio_id, relationship_type, plan_type, plan_status)
    values (bp.payload->>'dependent_name', bp.payload->>'phone', 'dependent', (bp.payload->>'profile_id')::uuid, bp.payload->>'relationship', 'Dependente', 'active')
    returning id into v_id;
    insert into public.student_profiles(non_socio_student_id, student_status) values (v_id, 'active');
    v_res := jsonb_build_object('id', v_id);
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
  perform conv_private.audit('ai_admin_action', 'non_socio_students', v_id::text, null,
    jsonb_build_object('action', bp.action, 'responsible', bp.payload->>'profile_id', 'relationship', bp.payload->>'relationship'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', bp.payload || jsonb_build_object('result', v_res));
end $$;

revoke all on function conv_private.ai_admin_dependent_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_dependent_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_dependent_propose(uuid, jsonb) to service_role;
revoke all on function conv_private.ai_confirm_pre_dependent_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
