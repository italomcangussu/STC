-- Caso do Henrique (19/10): um comprovante de R$ 300 paga Matheus (mensalista, R$ 200) e José (Kids, R$ 100).
create temp table u as select fab.usuario('adm@x.com') as adm;
grant select on u to service_role;
insert into public.profiles (id, name, role) select adm, 'Henrique', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.fin_settings (id, payee_names, card_mensal_price_cents) values (true, array['Sobral Tenis Clube'], 20000)
  on conflict (id) do update set payee_names = excluded.payee_names, card_mensal_price_cents = 20000;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c401', '558800000401', 'Henrique', adm, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d401', 'direct', '00000000-0000-0000-0000-00000000c401');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e401', '00000000-0000-0000-0000-00000000d401', '00000000-0000-0000-0000-00000000c401', now() + interval '1 day');
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d401', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c401', now() - interval '30 minutes');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, created_at)
select '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d401', adm,
  '00000000-0000-0000-0000-00000000c401', jsonb_build_object('storage_path', 'w/x/pix.jpg', 'file_name', 'pix.jpg', 'content_type', 'image/jpeg',
  'size_bytes', 900, 'content_sha256', repeat('e', 64), 'declared_amount_cents', 30000, 'declared_paid_on', '2026-10-14', 'ocr_status', 'ok',
  'ocr', jsonb_build_object('payee', 'Sobral Tenis Clube')), now() - interval '30 minutes'
from u;

-- passo de "sim": cria a mensagem de aceite depois da proposta e confirma
create function pg_temp.aceitar(p_prop uuid, p_msg uuid) returns jsonb language plpgsql as $$
begin
  perform fab.dono();
  update public.conv_booking_proposals set created_at = now() - interval '1 minute' where id = p_prop;
  insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, body)
  values (p_msg, '00000000-0000-0000-0000-00000000d401', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c401', 'sim');
  perform fab.como('service_role');
  return public.conv_svc_ai_confirm(p_prop, p_msg);
end $$;

select fab.como('service_role');
create temp table p1 as select public.conv_svc_ai_admin_student_propose('00000000-0000-0000-0000-00000000e401',
  '{"name":"Matheus","plan":"Card Mensal","card_tier":"regular","paid":true,"amount_cents":20000}') r;
grant select on p1 to service_role;
do $$ declare r jsonb := (select r from p1); begin
  assert (r->>'ok')::boolean, 'proposta do Matheus: ' || r::text;
  assert r->'summary'#>>'{receipt,intent_id}' = '00000000-0000-0000-0000-0000000009a1', 'usa o comprovante de R$ 300';
  assert r->'summary'->>'paid_on' = '2026-10-14' and r->'summary'->>'new_valid_until' = '2026-11-14', 'vence todo dia 14 (data do comprovante)';
end $$;
do $$ declare r jsonb := pg_temp.aceitar(((select r from p1)->>'proposal_id')::uuid, '00000000-0000-0000-0000-0000000008b1'); begin
  assert (r->>'ok')::boolean, 'Matheus cadastrado: ' || r::text;
end $$;

-- José Kids: sem valor dito, cobra a metade (R$ 100) e usa o saldo do mesmo comprovante
create temp table p2 as select public.conv_svc_ai_admin_student_propose('00000000-0000-0000-0000-00000000e401',
  '{"name":"José","plan":"Card Mensal","card_tier":"kids","paid":true}') r;
grant select on p2 to service_role;
do $$ declare r jsonb := (select r from p2); begin
  assert r->'summary'->>'amount_cents' = '10000', 'Kids paga metade: ' || r::text;
  assert r->'summary'#>>'{receipt,remaining_cents}' = '10000', 'restam R$ 100 no comprovante';
end $$;
do $$ declare r jsonb := pg_temp.aceitar(((select r from p2)->>'proposal_id')::uuid, '00000000-0000-0000-0000-0000000008b2'); begin
  assert (r->>'ok')::boolean, 'José cadastrado: ' || r::text;
end $$;

select fab.dono();
do $$ begin
  assert (select count(*) from public.non_socio_students where name in ('Matheus', 'José') and plan_status = 'active' and plan_type = 'Card Mensal') = 2, 'os dois ativos';
  assert (select card_tier from public.non_socio_students where name = 'José') = 'kids', 'José é Kids';
  assert (select master_expiration_date from public.non_socio_students where name = 'Matheus') = '2026-11-14', 'validade até 14/11';
  assert (select sum(amount) from public.student_payments where receipt_intent_id = '00000000-0000-0000-0000-0000000009a1') = 300, 'R$ 300 ligados ao comprovante';
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000009a1') = 'confirmed', 'comprovante usado inteiro sai de aguardando';
  assert (select count(*) from public.student_profiles sp join public.non_socio_students n on n.id = sp.non_socio_student_id where n.name in ('Matheus', 'José')) = 2, 'perfil de aluno criado';
end $$;

-- aluno repetido não é recadastrado
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_admin_student_propose('00000000-0000-0000-0000-00000000e401', '{"name":"matheus"}'); begin
  assert r->>'code' = 'STUDENT_EXISTS', 'Matheus já existe: ' || r::text;
end $$;

-- renovar o Card do José (Kids) sem comprovante: cobra R$ 100
do $$ declare r jsonb := public.conv_svc_ai_student_card_propose('00000000-0000-0000-0000-00000000e401',
  jsonb_build_object('student_id', (select id from public.non_socio_students where name = 'José'), 'paid_on', (now() at time zone 'America/Fortaleza')::date)); begin
  assert (r->>'ok')::boolean and r->'summary'->>'amount_cents' = '10000', 'renovação do Kids sai por R$ 100: ' || r::text;
  assert r->'summary'->>'card_tier' = 'kids', 'com a faixa no resumo';
end $$;
