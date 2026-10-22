-- Comprovante que o administrador manda no WhatsApp vira anexo da despesa que o João lança com o mesmo valor,
-- e a intenção sai de "aguardando finalidade". Valor diferente lança sem anexo e não mexe na intenção.

create temp table u as select fab.usuario('adm@x.com') as adm;
grant select on u to service_role;
insert into public.profiles (id, name, role) select adm, 'Admin A', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.fin_accounts (id, name, kind, active, is_default_receipts, opening_date) values ('00000000-0000-0000-0000-0000000000b1', 'Cora', 'bank', true, true, '2026-01-01');
insert into public.fin_categories (id, name, kind, dre_line, active) values ('00000000-0000-0000-0000-0000000000b2', 'Despesas', 'expense', 'administrative', true);
insert into public.fin_categories (id, name, kind, dre_line, active, parent_id) values ('00000000-0000-0000-0000-0000000000b3', 'Outras despesas', 'expense', 'administrative', true, '00000000-0000-0000-0000-0000000000b2');

insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c301', '558800000301', 'Admin A', adm, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d301', 'direct', '00000000-0000-0000-0000-00000000c301');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000d301', '00000000-0000-0000-0000-00000000c301', now() + interval '1 day');
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d301', 'inbound', 'document', 'received', 'customer', '00000000-0000-0000-0000-00000000c301', now() - interval '10 minutes');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, created_at)
select '00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d301', adm,
  '00000000-0000-0000-0000-00000000c301', jsonb_build_object('storage_path', 'whatsapp/x/bombeiro.pdf', 'file_name', 'bombeiro.pdf',
  'content_type', 'application/pdf', 'size_bytes', 2000, 'content_sha256', repeat('d', 64), 'declared_amount_cents', 15000,
  'declared_paid_on', conv_private.today()::text, 'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', 'Jose')), now() - interval '10 minutes'
from u;

-- valor diferente: proposta sem comprovante
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e301',
  '{"action":"fin_entry_create","entry_kind":"expense","description":"Outra coisa","amount_cents":9900,"category_name":"Outras despesas"}'); begin
  assert (r->>'ok')::boolean, 'proposta montada: ' || r::text;
  assert not (r->'summary' ? 'receipt_id'), 'valor diferente não leva o comprovante';
end $$;

-- mesmo valor: proposta leva o comprovante
create temp table prop as select public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e301',
  '{"action":"fin_entry_create","entry_kind":"expense","description":"Mão de obra do bombeiro hidráulico","amount_cents":15000,"category_name":"Outras despesas"}') r;
grant select on prop to service_role;
do $$ declare r jsonb := (select r from prop); begin
  assert r->'summary'->>'receipt_id' = '00000000-0000-0000-0000-0000000006a1', 'mesmo valor leva o comprovante: ' || r::text;
  assert r->'summary'->>'receipt_file' = 'bombeiro.pdf', 'com o nome do arquivo';
end $$;

-- "confirmo" do administrador pelo caminho real
select fab.dono();
update public.conv_booking_proposals set created_at = now() - interval '1 minute' where id = ((select r from prop)->>'proposal_id')::uuid;
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, body) values
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d301', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c301', 'confirmo');
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_confirm(((select r from prop)->>'proposal_id')::uuid, '00000000-0000-0000-0000-0000000005a2'); begin
  assert (r->>'ok')::boolean, 'despesa lançada: ' || r::text;
end $$;

select fab.dono();
do $$ declare v_entry uuid; begin
  select id into v_entry from public.fin_entries where description = 'Mão de obra do bombeiro hidráulico';
  assert v_entry is not null, 'a despesa existe';
  assert (select count(*) from public.fin_attachments where entry_id = v_entry and bucket = 'fin-receipts'
          and storage_path = 'whatsapp/x/bombeiro.pdf' and file_name = 'bombeiro.pdf') = 1, 'comprovante anexado à despesa';
  assert (select status from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000006a1') = 'confirmed', 'intenção encerrada';
  assert (select finance_entry_id from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000006a1') = v_entry, 'intenção aponta a despesa';
end $$;

select fab.como('service_role');
do $$ begin
  assert public.conv_svc_receipt_stage('00000000-0000-0000-0000-00000000d301') is null, 'nada mais fica em análise na conversa';
end $$;
select fab.dono();

-- o painel continua anexando em fin-docs por padrão
do $$ begin
  insert into public.fin_attachments(entry_id, storage_path, file_name, content_type, size_bytes)
  select id, 'e/painel.pdf', 'painel.pdf', 'application/pdf', 10 from public.fin_entries where description = 'Mão de obra do bombeiro hidráulico';
  assert (select bucket from public.fin_attachments where storage_path = 'e/painel.pdf') = 'fin-docs', 'anexo do painel segue em fin-docs';
end $$;
