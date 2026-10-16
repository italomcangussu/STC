-- Aulas em lote: o assessor do professor manda a semana; o João valida cada aula pelas regras do clube, propõe numa
-- proposta só e um único aceite grava todas (revalidando). Recusadas voltam com o motivo, sem travar as outras.

create temp table u as select fab.usuario('prof@x.com') as prof;
insert into public.profiles (id, name, role) select prof, 'Professor A', 'socio' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.professors (id, user_id, name) values ('00000000-0000-0000-0000-0000000000a1', (select prof from u), 'Professor A');
insert into public.courts (id, name, type) values ('00000000-0000-0000-0000-0000000000f1', 'Quadra Rápida', 'Rápida');
insert into public.non_socio_students (id, name, plan_type, plan_status, master_expiration_date) values
  ('00000000-0000-0000-0000-000000000b01', 'José Martins', 'Card Mensal', 'active', current_date + 60),
  ('00000000-0000-0000-0000-000000000b02', 'Vinícius', 'Card Mensal', 'active', current_date + 60);

insert into public.conv_contacts (id, phone, name) values ('00000000-0000-0000-0000-00000000c001', '558800000001', 'Assessor');
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d001', 'direct', '00000000-0000-0000-0000-00000000c001');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', now() + interval '1 day');
insert into public.conv_contact_delegates (contact_id, principal_profile_id) select '00000000-0000-0000-0000-00000000c001', prof from u;

-- próxima segunda-feira (não-sócio só de manhã ou a partir das 20h, exceto domingo)
create temp table d as select (current_date + (8 - extract(isodow from current_date)::int))::date as seg;

-- 1) lote: 2 válidas, 1 com início fora do relógio do clube, 1 que repete o horário de outra da lista
do $$
declare r jsonb; v_seg date := (select seg from d);
begin
  r := conv_private.ai_propose('00000000-0000-0000-0000-00000000e001', jsonb_build_object('action', 'lessons_batch', 'items', jsonb_build_array(
    jsonb_build_object('label', 'José Martins', 'date', v_seg, 'start', '20:00', 'non_socio_student_ids', jsonb_build_array('00000000-0000-0000-0000-000000000b01')),
    jsonb_build_object('label', 'Vinícius', 'date', v_seg, 'start', '20:30', 'non_socio_student_ids', jsonb_build_array('00000000-0000-0000-0000-000000000b02')),
    jsonb_build_object('label', 'José Martins', 'date', v_seg, 'start', '19:45', 'non_socio_student_ids', jsonb_build_array('00000000-0000-0000-0000-000000000b01')),
    jsonb_build_object('label', 'Vinícius', 'date', v_seg, 'start', '20:00', 'non_socio_student_ids', jsonb_build_array('00000000-0000-0000-0000-000000000b02')))));
  assert (r->>'ok')::boolean, 'o lote com aulas válidas vira proposta: ' || r::text;
  assert jsonb_array_length(r->'summary'->'accepted') = 2, 'duas aulas cabem';
  assert jsonb_array_length(r->'summary'->'rejected') = 2, 'duas são recusadas';
  assert r->'summary'->'rejected'->0->>'code' = 'INVALID_START', 'início 19:45 é recusado pela regra do clube';
  assert r->'summary'->'rejected'->1->>'code' = 'SLOT_TAKEN', 'aula que repete o horário de outra da lista é recusada';
  assert (select count(*) from public.reservations) = 0, 'propor não grava nada';
end $$;

-- 2) um aceite natural grava as aulas aceitas, em nome do professor
insert into public.conv_messages (id, conversation_id, direction, kind, body, status, origin, sender_contact_id, created_at)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000d001', 'inbound', 'text', 'Confirmo, pode marcar', 'received', 'customer',
  '00000000-0000-0000-0000-00000000c001', now() + interval '1 second');
do $$
declare r jsonb; v_prop uuid := (select id from public.conv_booking_proposals where action = 'lessons_batch' and status = 'open');
begin
  r := conv_private.ai_confirm(v_prop, '00000000-0000-0000-0000-0000000000aa');
  assert (r->>'ok')::boolean, 'confirmação do lote: ' || r::text;
  assert jsonb_array_length(r->'summary'->'created') = 2, 'as duas aulas foram gravadas';
  assert (select count(*) from public.reservations where type = 'Aula' and creator_id = (select prof from u)
    and professor_id = '00000000-0000-0000-0000-0000000000a1') = 2, 'aulas no nome do professor, com ele como professor';
  assert (select status from public.conv_booking_proposals where id = v_prop) = 'confirmed', 'proposta confirmada';
  -- repetir o "sim" não duplica
  r := conv_private.ai_confirm(v_prop, '00000000-0000-0000-0000-0000000000aa');
  assert (r->>'replayed')::boolean and (select count(*) from public.reservations) = 2, 'replay não duplica';
end $$;

-- 3) lote em que nada cabe não abre proposta e devolve os motivos
do $$
declare r jsonb; v_seg date := (select seg from d);
begin
  r := conv_private.ai_propose('00000000-0000-0000-0000-00000000e001', jsonb_build_object('action', 'lessons_batch', 'items', jsonb_build_array(
    jsonb_build_object('label', 'José Martins', 'date', v_seg, 'start', '20:00', 'non_socio_student_ids', jsonb_build_array('00000000-0000-0000-0000-000000000b01')))));
  assert r->>'code' = 'NOTHING_TO_BOOK' and r->'rejected'->0->>'code' = 'SLOT_TAKEN', 'horário já ocupado: nada a propor ' || r::text;
end $$;

-- 4) as outras ações de reserva continuam pelo caminho antigo
do $$ begin
  assert conv_private.ai_propose('00000000-0000-0000-0000-00000000e001', '{"action":"cancel","reservation_id":"00000000-0000-0000-0000-000000000099"}')->>'code' = 'RESERVATION_NOT_FOUND',
    'cancelar segue pelo ai_propose anterior';
end $$;
