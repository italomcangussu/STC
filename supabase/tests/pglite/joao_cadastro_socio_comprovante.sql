-- Cadastro de sócio novo pelo João com o comprovante que chegou pelo WhatsApp como intenção (sem submissão):
-- a proposta acha a imagem do administrador e a conclusão vira submissão, move para o sócio e dá baixa no mês.

create temp table u as select fab.usuario('adm@x.com') as adm, fab.usuario('novo@x.com') as novo;
grant select on u to service_role;
insert into public.profiles (id, name, role) select adm, 'Admin A', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.fin_settings (id, payee_names) values (true, array['Sobral Tenis Clube']) on conflict (id) do update set payee_names = excluded.payee_names;
insert into public.fin_accounts (id, name, kind, active, is_default_receipts, opening_date) values ('00000000-0000-0000-0000-0000000000a1', 'Cora', 'bank', true, true, '2026-01-01');

insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c201', '558800000201', 'Admin A', adm, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d201', 'direct', '00000000-0000-0000-0000-00000000c201');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-00000000d201', '00000000-0000-0000-0000-00000000c201', now() + interval '1 day');
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-00000000d201', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c201', now() - interval '5 minutes');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, created_at)
select '00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-00000000d201', adm,
  '00000000-0000-0000-0000-00000000c201', jsonb_build_object('storage_path', 'x/comprovante.jpg', 'file_name', 'comprovante.jpg',
  'content_type', 'image/jpeg', 'size_bytes', 1000, 'content_sha256', repeat('c', 64), 'declared_amount_cents', 20000,
  'declared_paid_on', conv_private.today()::text, 'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', 'Sobral Tenis Clube')), now() - interval '5 minutes'
from u;

select fab.como('service_role');
create temp table prop as select public.conv_svc_ai_admin_access_propose('00000000-0000-0000-0000-00000000e201',
  '{"action":"fin_member_create","name":"Ronaldo Rezende","phone":"(88) 99983-7196","amount_cents":20000}') r;
grant select on prop to service_role;
do $$ declare r jsonb := (select r from prop); begin
  assert (r->>'ok')::boolean, 'proposta aceita o comprovante que ficou como intenção: ' || r::text;
  assert r->'summary'->>'submission_id' = '00000000-0000-0000-0000-0000000004a1', 'a proposta aponta a intenção';
end $$;

-- sem comprovante nenhum continua pedindo a imagem
select fab.dono();
update fin_private.whatsapp_receipt_intents set created_at = now() - interval '7 hours' where id = '00000000-0000-0000-0000-0000000004a1';
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_admin_access_propose('00000000-0000-0000-0000-00000000e201',
  '{"action":"fin_member_create","name":"Ronaldo Rezende","phone":"88999837196","amount_cents":20000}'); begin
  assert r->>'code' = 'RECEIPT_REQUIRED', 'comprovante de mais de 6 h não vale: ' || r::text;
end $$;

-- "sim" do administrador; a função de borda cria o usuário no Auth e chama a conclusão
select fab.dono();
insert into public.profiles (id, name, role, phone, is_active) select novo, 'Ronaldo Rezende', 'socio', '88999837196', true from u
  on conflict (id) do update set name = excluded.name, role = excluded.role, phone = excluded.phone, is_active = true;
update fin_private.whatsapp_receipt_intents set created_at = now() - interval '5 minutes' where id = '00000000-0000-0000-0000-0000000004a1';
update public.conv_booking_proposals set status = 'open', created_at = now() - interval '1 minute' where id = ((select r from prop)->>'proposal_id')::uuid;
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, body) values
  ('00000000-0000-0000-0000-0000000003a2', '00000000-0000-0000-0000-00000000d201', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c201', 'sim');
update public.conv_booking_proposals set payload = payload || '{"cleared":true,"cleared_message_id":"00000000-0000-0000-0000-0000000003a2"}'
where id = ((select r from prop)->>'proposal_id')::uuid;

select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_admin_member_onboard(((select r from prop)->>'proposal_id')::uuid,
  (select novo from u), '00000000-0000-0000-0000-0000000003a2'); begin
  assert (r->>'ok')::boolean, 'cadastro concluído: ' || r::text;
end $$;

select fab.dono();
do $$ begin
  assert (select status from public.fin_receipt_submissions where id = '00000000-0000-0000-0000-0000000004a1') = 'approved', 'comprovante aprovado';
  assert (select profile_id from public.fin_receipt_submissions where id = '00000000-0000-0000-0000-0000000004a1') = (select novo from u), 'comprovante do sócio novo';
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000004a1') = 'confirmed', 'intenção encerrada';
  assert (select sum(amount_cents) from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
          where c.profile_id = (select novo from u)) = 20000, 'mensalidade do mês paga';
end $$;
