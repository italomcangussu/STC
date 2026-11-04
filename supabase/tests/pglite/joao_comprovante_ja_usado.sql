-- Caso Marcelo (03/11): o Pix de R$ 130 que pagou a inscrição em 28/10 volta dizendo "mensalidade".
-- O repasse não pode criar pendência nova no financeiro; o João recebe o uso anterior para explicar.
create temp table u as select fab.usuario('henrique@x.com') as adm, fab.usuario('marcelo@x.com') as soc;
grant select on u to service_role;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role) select soc, 'Marcelo Sampieri', 'socio' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.fin_settings (id, payee_names) values (true, array['Sobral Tenis Clube'])
  on conflict (id) do update set payee_names = excluded.payee_names;
update public.fin_settings set finance_admin_profile_id = (select adm from u);

insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c601', '558800000601', 'Henrique', adm, 'linked' from u;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c602', '558800000602', 'Marcelo', soc, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d602', 'direct', '00000000-0000-0000-0000-00000000c602');
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-00000000d602', 'inbound', 'document', 'received', 'customer', '00000000-0000-0000-0000-00000000c602', now() - interval '6 days'),
  ('00000000-0000-0000-0000-00000000ab02', '00000000-0000-0000-0000-00000000d602', 'inbound', 'document', 'received', 'customer', '00000000-0000-0000-0000-00000000c602', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-00000000ab03', '00000000-0000-0000-0000-00000000d602', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c602', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-00000000ab04', '00000000-0000-0000-0000-00000000d602', 'inbound', 'document', 'received', 'customer', '00000000-0000-0000-0000-00000000c602', now());

-- 28/10: o Pix já pagou a inscrição (intenção confirmada, sem submissão no financeiro)
create temp table pix as select jsonb_build_object('storage_path', 'soc/a/c.pdf', 'file_name', 'c.pdf', 'content_type', 'application/pdf',
  'size_bytes', 1774, 'content_sha256', repeat('b', 64), 'declared_amount_cents', 13000, 'declared_paid_on', '2026-10-28',
  'declared_reference', 'E0000000020261028122921509550721', 'ocr_status', 'ok',
  'ocr', jsonb_build_object('payee', 'Sobral Tenis Clube', 'identifier', 'E0000000020261028122921509550721', 'amount_cents', 13000)) d;
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, status, purpose_kind, purpose_detail, original_data, created_at)
select '00000000-0000-0000-0000-00000000be01', '00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-00000000d602', soc,
  '00000000-0000-0000-0000-00000000c602', 'confirmed', 'other', 'Inscrição Serra e Sertão 2026: Marcelo Sampieri', (select d from pix), now() - interval '6 days'
from u;
-- 03/11: o mesmo arquivo de novo
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, created_at)
select '00000000-0000-0000-0000-00000000be02', '00000000-0000-0000-0000-00000000ab02', '00000000-0000-0000-0000-00000000d602', soc,
  '00000000-0000-0000-0000-00000000c602', (select d from pix), now() - interval '2 minutes'
from u;

select fab.como('service_role');
create temp table esc as select public.conv_svc_receipt_escalate('00000000-0000-0000-0000-00000000be02', '00000000-0000-0000-0000-00000000ab03', 'membership', 'mensalidade') r;
grant select on esc to service_role;
do $$ declare r jsonb := (select r from esc); begin
  assert r->>'code' = 'DUPLICATE', 'reenvio é duplicado: ' || r::text;
  assert r->>'used_for' = 'Inscrição Serra e Sertão 2026: Marcelo Sampieri', 'diz para que o Pix já foi usado';
  assert r->>'used_on' is not null, 'e quando';
end $$;

select fab.dono();
do $$ begin
  assert not exists (select 1 from public.fin_receipt_submissions where id = '00000000-0000-0000-0000-00000000be02'), 'não cria pendência no financeiro';
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-00000000be02') = 'canceled', 'reenvio encerrado';
end $$;

-- Mesmo Pix em OUTRO arquivo (print em vez do PDF): o identificador também acusa o reenvio
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data)
select '00000000-0000-0000-0000-00000000be03', '00000000-0000-0000-0000-00000000ab04', '00000000-0000-0000-0000-00000000d602', soc,
  '00000000-0000-0000-0000-00000000c602', (select d || jsonb_build_object('content_sha256', repeat('c', 64), 'declared_reference', 'e00000000 20261028122921509550721') from pix)
from u;
do $$ begin
  assert fin_private.receipt_prior_use('00000000-0000-0000-0000-00000000be03')->>'used_for' like 'Inscrição Serra e Sertão%', 'mesmo Pix por identificador';
  assert fin_private.receipt_prior_use('00000000-0000-0000-0000-00000000be01') is null, 'o primeiro uso não acusa a si mesmo nem o reenvio posterior';
end $$;

-- Comprovante inédito continua indo ao financeiro como antes
update fin_private.whatsapp_receipt_intents set original_data = original_data || jsonb_build_object('declared_reference', 'E9999999999', 'ocr', '{}'::jsonb)
 where id = '00000000-0000-0000-0000-00000000be03';
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_escalate('00000000-0000-0000-0000-00000000be03', '00000000-0000-0000-0000-00000000ab03', 'membership', 'mensalidade'); begin
  assert (r->>'ok')::boolean and r->>'submission_id' = '00000000-0000-0000-0000-00000000be03', 'inédito vira submissão: ' || r::text;
end $$;
select fab.dono();
