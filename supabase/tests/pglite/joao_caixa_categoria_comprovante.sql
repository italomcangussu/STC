-- Auditoria do caixa (22/10): categoria por nome aproximado, sugestão e criação; sócio novo com 1º mês proporcional;
-- comprovante de pendência com baixa automática; comprovante de despesa já lançada vira anexo sozinho.

create temp table u as select fab.usuario('adm@x.com') as adm, fab.usuario('novo@x.com') as novo, fab.usuario('lucas@x.com') as soc;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role, is_active) select soc, 'Lucas Rodrigues', 'socio', true from u on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true;
insert into public.fin_settings (id, payee_names) values (true, array['Sobral Tenis Clube']) on conflict (id) do update set payee_names = excluded.payee_names;
update public.fin_settings set finance_admin_profile_id = (select adm from u);
insert into public.fin_accounts (id, name, kind, active, is_default_receipts, opening_date) values ('00000000-0000-0000-0000-0000000000a1', 'Cora', 'bank', true, true, '2026-01-01');
insert into public.fin_categories (id, name, kind, dre_line, active, system_key) values
  ('00000000-0000-0000-0000-0000000000b1', 'Estrutura', 'expense', 'operational', true, 'group.structure'),
  ('00000000-0000-0000-0000-0000000000b2', 'Outras despesas', 'expense', 'operational', true, 'group.other');
insert into public.fin_categories (id, name, kind, dre_line, active, parent_id) values
  ('00000000-0000-0000-0000-0000000000b3', 'Manutenção das quadras', 'expense', 'operational', true, '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b4', 'Material de limpeza', 'expense', 'operational', true, '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b5', 'Outras despesas', 'expense', 'operational', true, '00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000b6', 'Manutenção predial', 'expense', 'operational', true, '00000000-0000-0000-0000-0000000000b1');
insert into public.fin_categories (id, name, kind, dre_line, active, system_key) values
  ('00000000-0000-0000-0000-0000000000b7', 'Receitas do clube', 'revenue', 'revenue', true, 'group.revenue') on conflict do nothing;
insert into public.fin_categories (id, name, kind, dre_line, active, system_key, parent_id)
select '00000000-0000-0000-0000-0000000000b8', 'Day Card (convidados)', 'revenue', 'revenue', true, 'day_card', '00000000-0000-0000-0000-0000000000b7'
where not exists (select 1 from public.fin_categories where system_key = 'day_card');

insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c201', '558800000201', 'Henrique', adm, 'linked' from u;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c202', '558800000202', 'Lucas', soc, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values
  ('00000000-0000-0000-0000-00000000d201', 'direct', '00000000-0000-0000-0000-00000000c201'),
  ('00000000-0000-0000-0000-00000000d202', 'direct', '00000000-0000-0000-0000-00000000c202');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-00000000d201', '00000000-0000-0000-0000-00000000c201', now() + interval '1 day');

create function pg_temp.lancar(p jsonb) returns jsonb language sql as $$
  select public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e201',
    jsonb_build_object('action', 'fin_entry_create', 'entry_kind', 'expense', 'amount_cents', 2250) || p)
$$;

-- 1) Categoria
select fab.como('service_role');
do $$ declare r jsonb; begin
  r := pg_temp.lancar('{"description":"Produtos","category_name":"material de limpeza"}');
  assert r->'summary'->>'category_name' = 'Material de limpeza' and r->'summary'->>'category_how' = 'nome', 'nome igual em minúsculas: ' || r::text;
  r := pg_temp.lancar('{"description":"Pintura","category_name":"Outros"}');
  assert r->'summary'->>'category_name' = 'Outras despesas', '"Outros" é Outras despesas: ' || r::text;
  r := pg_temp.lancar('{"description":"Reparo","category_name":"manutenção de quadra"}');
  assert r->'summary'->>'category_name' = 'Manutenção das quadras', 'quadra ≈ quadras: ' || r::text;
  r := pg_temp.lancar('{"description":"Rede nova da quadra 2"}');
  assert r->'summary'->>'category_name' = 'Manutenção das quadras' and r->'summary'->>'category_how' = 'palavra', 'sem nome sugere pela descrição: ' || r::text;
  r := pg_temp.lancar('{"description":"Bolinhas","category_name":"Material esportivo"}');
  assert r->>'code' = 'CATEGORY_UNKNOWN' and r->>'message' like '%crio "Material esportivo"%', 'nome que não existe pergunta: ' || r::text;
  r := pg_temp.lancar('{"description":"Coisa qualquer"}');
  assert r->>'code' = 'CATEGORY_REQUIRED' and r->>'message' like '%crio uma nova%', 'sem nome e sem pista pergunta: ' || r::text;
end $$;

-- histórico: lançamento parecido já usou a categoria
select fab.dono();
insert into public.fin_entries (kind, status, description, category_id, amount_cents, competence_date, due_date, request_id)
values ('expense', 'pending', 'Mão de obra do bombeiro hidráulico', '00000000-0000-0000-0000-0000000000b6', 15000, '2026-10-13', '2026-10-13', gen_random_uuid());
select fab.como('service_role');
do $$ declare r jsonb := pg_temp.lancar('{"description":"Material hidráulico"}'); begin
  assert r->'summary'->>'category_name' = 'Manutenção predial' and r->'summary'->>'category_how' = 'historico', 'sugere pelo histórico: ' || r::text;
end $$;

-- categoria nova a pedido: nasce no grupo da sugestão e o lançamento usa ela
create temp table prop as select pg_temp.lancar('{"description":"Bolinhas para o treino","category_name":"Material esportivo","category_new":true}') r;
grant select on prop to service_role;
do $$ declare r jsonb := (select r from prop); begin
  assert (r->>'ok')::boolean and (r->'summary'->>'category_new')::boolean and r->'summary'->>'category_parent_name' = 'Outras despesas',
    'proposta de categoria nova: ' || r::text;
end $$;
select fab.dono();
update public.conv_booking_proposals set created_at = now() - interval '1 minute' where id = ((select r from prop)->>'proposal_id')::uuid;
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, body) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-00000000d201', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c201', 'confirmo');
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_confirm(((select r from prop)->>'proposal_id')::uuid, '00000000-0000-0000-0000-0000000007a1'); begin
  assert (r->>'ok')::boolean, 'lançamento com categoria nova: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select c.name from public.fin_entries e join public.fin_categories c on c.id = e.category_id where e.description = 'Bolinhas para o treino')
    = 'Material esportivo', 'categoria criada e usada';
  assert (select parent_id from public.fin_categories where name = 'Material esportivo') = '00000000-0000-0000-0000-0000000000b2', 'no grupo Outras despesas';
end $$;

-- 2) Sócio novo com 1º mês proporcional (R$ 200 de R$ 400)
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-00000000d201', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c201', now() - interval '5 minutes');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, created_at)
select '00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-00000000d201', adm,
  '00000000-0000-0000-0000-00000000c201', jsonb_build_object('storage_path', 'x/ronaldo.jpg', 'file_name', 'ronaldo.jpg',
  'content_type', 'image/jpeg', 'size_bytes', 1000, 'content_sha256', repeat('c', 64), 'declared_amount_cents', 20000,
  'declared_paid_on', conv_private.today()::text, 'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', 'Sobral Tenis Clube')), now() - interval '5 minutes'
from u;
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_admin_access_propose('00000000-0000-0000-0000-00000000e201',
  '{"action":"fin_member_create","name":"Ronaldo Rezende","phone":"88999837196","amount_cents":40000}'); begin
  assert r->>'code' = 'RECEIPT_PRORATED', 'comprovante menor pergunta se é proporcional: ' || r::text;
end $$;
create temp table cad as select public.conv_svc_ai_admin_access_propose('00000000-0000-0000-0000-00000000e201',
  '{"action":"fin_member_create","name":"Ronaldo Rezende","phone":"88999837196","amount_cents":40000,"first_amount_cents":20000}') r;
grant select on cad to service_role;
do $$ declare r jsonb := (select r from cad); begin
  assert (r->>'ok')::boolean and (r->'summary'->>'first_amount_cents')::bigint = 20000, 'proposta com o proporcional: ' || r::text;
end $$;

select fab.dono();
insert into public.profiles (id, name, role, phone, is_active) select novo, 'Ronaldo Rezende', 'socio', '88999837196', true from u
  on conflict (id) do update set name = excluded.name, role = excluded.role, phone = excluded.phone, is_active = true;
update public.conv_booking_proposals set created_at = now() - interval '1 minute' where id = ((select r from cad)->>'proposal_id')::uuid;
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, body) values
  ('00000000-0000-0000-0000-0000000003a2', '00000000-0000-0000-0000-00000000d201', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c201', 'sim');
update public.conv_booking_proposals set payload = payload || '{"cleared":true,"cleared_message_id":"00000000-0000-0000-0000-0000000003a2"}'
where id = ((select r from cad)->>'proposal_id')::uuid;
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_admin_member_onboard(((select r from cad)->>'proposal_id')::uuid,
  (select novo from u), '00000000-0000-0000-0000-0000000003a2'); begin
  assert (r->>'ok')::boolean, 'cadastro proporcional concluído: ' || r::text;
end $$;
select fab.dono();
do $$ declare v_charge uuid; begin
  select c.id into v_charge from public.fin_member_charges c where c.profile_id = (select novo from u);
  assert (select status from public.fin_member_charges where id = v_charge) = 'paid', 'mês de entrada pago';
  assert (select sum(amount_cents) from public.fin_charge_adjustments where charge_id = v_charge and kind = 'discount') = 20000, 'desconto do proporcional';
  assert (select sum(principal_cents) from public.fin_charge_payments where charge_id = v_charge) = 20000, 'pagou R$ 200';
  assert (select pp.amount_cents from public.fin_member_plan_prices pp join public.fin_member_plans p on p.id = pp.plan_id
          where p.profile_id = (select novo from u)) = 40000, 'plano segue com R$ 400 para os próximos meses';
end $$;

-- 3) Pendência (Day Card do convidado) paga com o comprovante certo: baixa automática
select fab.como('authenticated', (select adm from u));
create temp table pend as select public.fin_create_member_pendency(gen_random_uuid(), jsonb_build_object('profile_id', (select soc from u),
  'description', 'Day Card de convidado', 'amount_cents', 5000, 'competence_month', (now() at time zone 'America/Fortaleza')::date, 'due_date', (now() at time zone 'America/Fortaleza')::date, 'pendency_kind', 'day_card',
  'guest_name', 'Glória', 'guest_date', (now() at time zone 'America/Fortaleza')::date)) r;
select fab.dono();
grant select on pend to service_role;
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d202', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c202');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data)
select '00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-00000000d202', soc,
  '00000000-0000-0000-0000-00000000c202', jsonb_build_object('storage_path', 'soc/dc.jpg', 'file_name', 'dc.jpg', 'content_type', 'image/jpeg',
  'size_bytes', 700, 'content_sha256', repeat('8', 64), 'declared_amount_cents', 5000, 'declared_paid_on', conv_private.today()::text,
  'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', 'Sobral Tenis Clube')) from u;
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-0000000008a1'); begin
  assert (r->>'applied')::boolean and r->>'charge_type' = 'member_pendency', 'pendência baixada sozinha: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select status from public.fin_member_charges where profile_id = (select soc from u)) = 'paid', 'Day Card pago';
  assert (select purpose_kind from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000008a1') = 'member_pendency', 'intenção como pendência';
end $$;

-- 4) Comprovante de despesa já lançada sem anexo: vira anexo dela
select fab.como('authenticated', (select adm from u));
select public.fin_create_entry(gen_random_uuid(), jsonb_build_object('kind', 'expense', 'status', 'paid', 'description', 'Limpeza do espaço',
  'category_id', '00000000-0000-0000-0000-0000000000b3', 'amount_cents', 40000, 'paid_on', (now() at time zone 'America/Fortaleza')::date - 1, 'account_id', '00000000-0000-0000-0000-0000000000a1'));
select fab.dono();
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id) values
  ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-00000000d201', 'inbound', 'document', 'received', 'customer', '00000000-0000-0000-0000-00000000c201');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data)
select '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-00000000d201', adm,
  '00000000-0000-0000-0000-00000000c201', jsonb_build_object('storage_path', 'adm/limpeza.pdf', 'file_name', 'limpeza.pdf', 'content_type', 'application/pdf',
  'size_bytes', 900, 'content_sha256', repeat('9', 64), 'declared_amount_cents', 40000, 'declared_paid_on', conv_private.today()::text,
  'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', 'JOSE WELINGTON BENTO')) from u;
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_admin_receipt('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-0000000009a1'); begin
  assert r->'attached_entry'->>'description' = 'Limpeza do espaço', 'anexou à despesa lançada: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select count(*) from public.fin_attachments f join public.fin_entries e on e.id = f.entry_id
          where e.description = 'Limpeza do espaço' and f.storage_path = 'adm/limpeza.pdf') = 1, 'anexo gravado';
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000009a1') = 'confirmed', 'intenção encerrada';
end $$;
