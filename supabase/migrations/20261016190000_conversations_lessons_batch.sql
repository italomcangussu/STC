-- Conversas · aulas em lote (professor ou assessor de professor)
--
-- O assessor do professor manda a semana inteira de uma vez ("seg 19h30 José, ter 19h Júlio..."). Antes o João só sabia
-- tratar UMA reserva por proposta e não entendia a lista: a conversa virava pingue-pongue de "não entendi" entre dois robôs.
-- Agora `ai_propose` aceita a ação `lessons_batch`: valida cada aula pelas MESMAS regras de `validate_reservation`
-- (Quadra Rápida, 30 minutos, início em hora cheia ou meia, aluno ativo, card válido, horário livre), sem conflito entre as
-- próprias aulas do lote, e guarda numa proposta só as que passaram e as recusadas com o motivo. Um único aceite natural grava
-- todas (`ai_confirm` → `ai_confirm_lessons_batch`), revalidando cada uma; a que deixou de caber é relatada, as outras entram.
--
-- Rollback: `alter function conv_private.ai_propose_pre_lessons(uuid, jsonb) rename to ai_propose` (depois de dropar a nova),
-- idem `ai_confirm_pre_lessons` → `ai_confirm`, e tirar 'lessons_batch' da restrição de ações.

do $$
declare v_def text;
begin
  select string_agg(quote_literal(m[1]), ', ') into v_def
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_0-9]+)''', 'g') m
  where c.conname = 'conv_booking_proposals_action_check';
  if v_def not like '%''lessons_batch''%' then
    alter table public.conv_booking_proposals drop constraint conv_booking_proposals_action_check;
    execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s, %L]))', v_def, 'lessons_batch');
  end if;
end $$;

-- Grava UMA aula já validada (mesmo efeito do app e de `ai_confirm_booking`): perfil de aluno do sócio + reserva + auditoria.
create or replace function conv_private.ai_insert_lesson(n jsonb, p_requester uuid, p_proposal uuid, p_conversation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_socio uuid[]; v_students uuid[]; v_res uuid;
begin
  select coalesce(array_agg(x::uuid), '{}') into v_socio from jsonb_array_elements_text(n->'participant_ids') x;
  select coalesce(array_agg(x::uuid), '{}') into v_students from jsonb_array_elements_text(n->'non_socio_student_ids') x;
  if cardinality(v_socio) > 0 then
    insert into public.student_profiles(profile_id, professor_id, student_status)
    select x, nullif(n->>'professor_id', '')::uuid, 'active' from unnest(v_socio) x
    on conflict (profile_id) do nothing;
  end if;
  insert into public.reservations(type, date, start_time, end_time, court_id, creator_id, participant_ids, professor_id, student_type,
    non_socio_student_id, non_socio_student_ids, observation, status)
  values ('Aula', (n->>'date')::date, (n->>'start')::time, (n->>'end')::time, (n->>'court_id')::uuid, p_requester, v_socio,
    nullif(n->>'professor_id', '')::uuid,
    case when cardinality(v_socio) > 0 and cardinality(v_students) = 0 then 'socio'
         when cardinality(v_socio) = 0 and cardinality(v_students) > 0 then 'non-socio' else null end,
    case when cardinality(v_students) = 1 then v_students[1] else null end, v_students, 'Reserva via WhatsApp (IA, aulas em lote)', 'active')
  returning id into v_res;
  perform conv_private.audit('ai_reservation_created', 'reservations', v_res::text, null,
    jsonb_build_object('type', 'Aula', 'date', n->>'date', 'start', n->>'start', 'court', n->>'court_name'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', p_conversation, 'requester_profile_id', p_requester,
      'proposal_id', p_proposal, 'action', 'lessons_batch'), p_requester);
  return v_res;
end $$;

-- Confere o lote: cada aula na primeira Quadra Rápida que a aceitar, sem sobrepor outra aula do próprio lote.
-- Devolve {accepted: [normalized + label], rejected: [{label, code, message}]}. Não grava nada.
create or replace function conv_private.ai_lessons_check(p_requester uuid, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_item jsonb; v_court uuid; v_val jsonb; v_ok jsonb; v_accepted jsonb := '[]'::jsonb; v_rejected jsonb := '[]'::jsonb;
  v_courts uuid[]; v_overlap boolean;
begin
  select coalesce(array_agg(c.id order by c.name), '{}') into v_courts
    from public.courts c where coalesce(c.is_active, true) and conv_private.fold(c.type::text) like 'r%pida';
  for v_item in select x from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x loop
    v_ok := null; v_val := conv_private.vfail('COURT_NOT_FOUND', 'Não há Quadra Rápida ativa.');
    foreach v_court in array v_courts loop
      v_val := conv_private.validate_reservation(jsonb_build_object('type', 'Aula', 'duration', coalesce(nullif(v_item->>'duration', '')::int, 30),
        'date', v_item->>'date', 'start', v_item->>'start', 'court_id', v_court, 'requester_profile_id', p_requester,
        'participant_ids', coalesce(v_item->'participant_ids', '[]'::jsonb), 'non_socio_student_ids', coalesce(v_item->'non_socio_student_ids', '[]'::jsonb)));
      if (v_val->>'ok')::boolean then
        select exists (select 1 from jsonb_array_elements(v_accepted) a
          where a->>'court_id' = v_court::text and a->>'date' = v_val->'normalized'->>'date'
            and (a->>'start')::time < (v_val->'normalized'->>'end')::time and (v_val->'normalized'->>'start')::time < (a->>'end')::time) into v_overlap;
        if not v_overlap then v_ok := v_val->'normalized'; exit; end if;
        v_val := conv_private.vfail('SLOT_TAKEN', 'Esse horário já está pedido por outra aula desta lista.');
      elsif v_val->>'code' not in ('SLOT_TAKEN', 'COURT_NOT_FOUND') then
        exit;
      end if;
    end loop;
    if v_ok is not null then
      v_accepted := v_accepted || jsonb_build_array(v_ok || jsonb_build_object('label', v_item->>'label'));
    else
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('label', v_item->>'label', 'date', v_item->>'date', 'start', v_item->>'start',
        'code', v_val->>'code', 'message', v_val->>'message'));
    end if;
  end loop;
  return jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected);
end $$;

alter function conv_private.ai_propose(uuid, jsonb) rename to ai_propose_pre_lessons;

create or replace function conv_private.ai_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; v_req uuid; v_chk jsonb; v_id uuid; v_n integer;
begin
  if coalesce(p->>'action', '') <> 'lessons_batch' then return conv_private.ai_propose_pre_lessons(p_session, p); end if;
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_req := conv_private.acting_profile_id(sess.requester_contact_id);
  if v_req is null then return conv_private.vfail('REQUESTER_NOT_IDENTIFIED', 'Não consegui identificar seu cadastro de sócio por este telefone.'); end if;
  v_n := jsonb_array_length(coalesce(p->'items', '[]'::jsonb));
  if v_n = 0 or v_n > 30 then return conv_private.vfail('INVALID_BATCH', 'Mande de 1 a 30 aulas por vez.'); end if;
  v_chk := conv_private.ai_lessons_check(v_req, p->'items');
  if jsonb_array_length(v_chk->'accepted') = 0 then
    return conv_private.vfail('NOTHING_TO_BOOK', 'Nenhuma aula da lista pode ser marcada.') || jsonb_build_object('rejected', v_chk->'rejected');
  end if;
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_req, 'lessons_batch', v_chk, now() + make_interval(mins => coalesce(s.proposal_ttl_minutes, 20)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', 'lessons_batch', 'summary', v_chk);
end $$;

alter function conv_private.ai_confirm(uuid, uuid) rename to ai_confirm_pre_lessons;

create or replace function conv_private.ai_confirm(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_item jsonb; v_val jsonb; v_res uuid;
  v_created jsonb := '[]'::jsonb; v_failed jsonb := '[]'::jsonb;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action <> 'lessons_batch' then return conv_private.ai_confirm_pre_lessons(p_proposal, p_message); end if;
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
    return conv_private.vfail('NOT_AUTHORIZED_TO_CONFIRM', 'Só quem pediu pode confirmar.');
  end if;

  for v_item in select x from jsonb_array_elements(bp.payload->'accepted') x loop
    perform pg_advisory_xact_lock(hashtextextended('conv_res:' || (v_item->>'court_id') || ':' || (v_item->>'date'), 0));
    v_val := conv_private.validate_reservation(v_item || jsonb_build_object('type', 'Aula', 'requester_profile_id', bp.requester_profile_id));
    if (v_val->>'ok')::boolean then
      v_res := conv_private.ai_insert_lesson(v_val->'normalized', bp.requester_profile_id, bp.id, bp.conversation_id);
      v_created := v_created || jsonb_build_array(v_val->'normalized' || jsonb_build_object('label', v_item->>'label', 'reservation_id', v_res));
    else
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('label', v_item->>'label', 'date', v_item->>'date', 'start', v_item->>'start',
        'code', v_val->>'code', 'message', v_val->>'message'));
    end if;
  end loop;

  update public.conv_booking_proposals set status = case when jsonb_array_length(v_created) > 0 then 'confirmed' else 'failed' end,
    confirmed_at = case when jsonb_array_length(v_created) > 0 then now() end, confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, failure_code = case when jsonb_array_length(v_created) = 0 then 'NOTHING_BOOKED' end,
    payload = bp.payload || jsonb_build_object('result', jsonb_build_object('created', v_created, 'failed', v_failed))
  where id = bp.id;
  if jsonb_array_length(v_created) = 0 then
    return conv_private.vfail('NOTHING_BOOKED', 'Nenhuma aula pôde ser marcada.') || jsonb_build_object('failed', v_failed);
  end if;
  return jsonb_build_object('ok', true, 'action', 'lessons_batch', 'summary', jsonb_build_object('created', v_created, 'failed', v_failed,
    'rejected', bp.payload->'rejected'));
end $$;

revoke all on function conv_private.ai_insert_lesson(jsonb, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_lessons_check(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm(uuid, uuid) from public, anon, authenticated;
