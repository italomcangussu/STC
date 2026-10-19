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

-- 5) busca de aluno tolerante: "Matheus Martins" acha "Matheus", "Ronaldo Rezende" acha "Ronaldo Resende";
--    quem não existe continua sem resultado, e a busca de SÓCIO não fica frouxa
insert into public.non_socio_students (id, name, plan_type, plan_status, master_expiration_date) values
  ('00000000-0000-0000-0000-000000000b03', 'Matheus', 'Card Mensal', 'active', current_date + 60),
  ('00000000-0000-0000-0000-000000000b04', 'Ronaldo Resende', 'Card Mensal', 'active', current_date + 60);
insert into public.non_socio_students (id, name, plan_type, plan_status, is_active) values
  ('00000000-0000-0000-0000-000000000b05', 'Matheus', 'Card Mensal', 'active', false);
create temp table sp_socio as select fab.usuario('carlos@x.com') as id;
insert into public.profiles (id, name, role) select id, 'Carlos Resende', 'socio' from sp_socio on conflict (id) do update set name = excluded.name, role = excluded.role;
do $$
declare r jsonb := conv_private.ai_resolve_people(array['Matheus Martins', 'Ronaldo Rezende', 'Guilherme', 'José Martins'], 'student');
begin
  assert r->0->>'status' = 'unique' and r->0->'matches'->0->>'name' = 'Matheus', 'Matheus Martins deveria achar o Matheus ativo: ' || (r->0)::text;
  assert r->1->>'status' = 'unique' and r->1->'matches'->0->>'name' = 'Ronaldo Resende', 'Rezende deveria achar Resende: ' || (r->1)::text;
  assert r->2->>'status' = 'none', 'Guilherme não existe';
  assert r->3->>'status' = 'unique' and r->3->'matches'->0->>'name' = 'José Martins', 'nome exato continua exato';
  assert conv_private.ai_resolve_people(array['Carlos Rezende'], 'member')->0->>'status' = 'none', 'busca de sócio não usa a grafia aproximada';
  assert conv_private.fold_loose('Rezende Matthews') = 'resendi matews', 'normalização: ' || conv_private.fold_loose('Rezende Matthews');
end $$;

-- 6) ç/ss soam igual; nome com dúvida (primeiro nome bate, sobrenome não) vira SUGESTÃO, nunca escolha
insert into public.non_socio_students (id, name, plan_type, plan_status, master_expiration_date) values
  ('00000000-0000-0000-0000-000000000b06', 'Ítalo Cangussú', 'Card Mensal', 'active', current_date + 60),
  ('00000000-0000-0000-0000-000000000b07', 'Lucas Rodrigues', 'Card Mensal', 'active', current_date + 60);
do $$
declare r jsonb := conv_private.ai_resolve_people(array['Ítalo Canguço', 'Lucas Martins', 'Guilherme'], 'student');
begin
  assert r->0->>'status' = 'unique' and r->0->'matches'->0->>'name' = 'Ítalo Cangussú', 'Canguço = Cangussú: ' || (r->0)::text;
  assert r->1->>'status' = 'suggest' and r->1->'matches'->0->>'name' = 'Lucas Rodrigues', 'Lucas Martins vira pergunta sobre Lucas Rodrigues: ' || (r->1)::text;
  assert r->2->>'status' = 'none', 'sem nenhum Guilherme continua sem resultado';
  assert conv_private.ai_resolve_people(array['Lucas Martins'], 'member')->0->>'status' = 'none', 'sócio não recebe sugestão';
end $$;

-- 7) o resumo do lote espera o professor: vale 24 h
do $$
declare r jsonb; v_seg date := (select seg from d);
begin
  r := conv_private.ai_propose('00000000-0000-0000-0000-00000000e001', jsonb_build_object('action', 'lessons_batch', 'items', jsonb_build_array(
    jsonb_build_object('label', 'Ronaldo Resende', 'date', v_seg, 'start', '06:00', 'non_socio_student_ids', jsonb_build_array('00000000-0000-0000-0000-000000000b04')))));
  assert (r->>'ok')::boolean, 'lote novo: ' || r::text;
  assert (select expires_at from public.conv_booking_proposals where id = (r->>'proposal_id')::uuid) > now() + interval '23 hours', 'proposta de lote vale 24 h';
end $$;
