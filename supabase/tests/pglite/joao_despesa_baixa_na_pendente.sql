-- Caso do Henrique (05/11): comprovante do aluguel com o mesmo valor da recorrente pendente vira BAIXA nela,
-- com o comprovante anexado, em vez de despesa nova. Sem pendente igual, lança como antes. Duas pendentes com o
-- mesmo valor não escolhe nenhuma. Pendente que deixou de estar aberta antes do "confirmo" não duplica.

create temp table u as select fab.usuario('adm@x.com') as adm;
grant select on u to service_role;
insert into public.profiles (id, name, role) select adm, 'Admin A', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.fin_accounts (id, name, kind, active, is_default_receipts, opening_date) values ('00000000-0000-0000-0000-0000000000b1', 'Cora', 'bank', true, true, '2026-01-01');
insert into public.fin_categories (id, name, kind, dre_line, active) values ('00000000-0000-0000-0000-0000000000b2', 'Despesas', 'expense', 'administrative', true);
insert into public.fin_categories (id, name, kind, dre_line, active, parent_id) values ('00000000-0000-0000-0000-0000000000b3', 'Aluguel', 'expense', 'administrative', true, '00000000-0000-0000-0000-0000000000b2');

-- pendentes: aluguel (único com 324200) e duas de 7500 (ambíguas)
insert into public.fin_entries (id, kind, status, description, category_id, amount_cents, competence_date, due_date, account_id, request_id) values
  ('00000000-0000-0000-0000-0000000007a1', 'expense', 'pending', 'Aluguel do Espaço', '00000000-0000-0000-0000-0000000000b3', 324200,
   date_trunc('month', conv_private.today())::date, conv_private.today() - 3, '00000000-0000-0000-0000-0000000000b1', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000007a2', 'expense', 'pending', 'Internet', '00000000-0000-0000-0000-0000000000b3', 7500,
   date_trunc('month', conv_private.today())::date, conv_private.today() - 3, '00000000-0000-0000-0000-0000000000b1', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000007a3', 'expense', 'pending', 'Telefone', '00000000-0000-0000-0000-0000000000b3', 7500,
   date_trunc('month', conv_private.today())::date, conv_private.today() - 3, '00000000-0000-0000-0000-0000000000b1', gen_random_uuid());

insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c301', '558800000301', 'Admin A', adm, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d301', 'direct', '00000000-0000-0000-0000-00000000c301');
insert into public.conv_ai_sessions (id, conversation_id, requester_contact_id, expires_at) values
  ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000d301', '00000000-0000-0000-0000-00000000c301', now() + interval '1 day');
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, created_at) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d301', 'inbound', 'document', 'received', 'customer', '00000000-0000-0000-0000-00000000c301', now() - interval '10 minutes');
insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data, created_at)
select '00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000d301', adm,
  '00000000-0000-0000-0000-00000000c301', jsonb_build_object('storage_path', 'whatsapp/x/aluguel.pdf', 'file_name', 'aluguel.pdf',
  'content_type', 'application/pdf', 'size_bytes', 2000, 'content_sha256', repeat('a', 64), 'declared_amount_cents', 324200,
  'declared_paid_on', conv_private.today()::text, 'ocr_status', 'ok'), now() - interval '10 minutes'
from u;

select fab.como('service_role');
-- valor sem pendente igual: lança como antes
do $$ declare r jsonb := public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e301',
  '{"action":"fin_entry_create","entry_kind":"expense","description":"Cimento","amount_cents":800,"category_name":"Aluguel"}'); begin
  assert (r->>'ok')::boolean, 'proposta montada: ' || r::text;
  assert not (r->'summary' ? 'settles_entry_id'), 'sem pendente igual não liga a nenhuma';
end $$;
-- duas pendentes com o mesmo valor: não escolhe
do $$ declare r jsonb := public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e301',
  '{"action":"fin_entry_create","entry_kind":"expense","description":"Pagamento da internet","amount_cents":7500,"category_name":"Aluguel"}'); begin
  assert not (r->'summary' ? 'settles_entry_id'), 'ambíguo não liga: ' || r::text;
end $$;
-- despesa a pagar (pendente) nunca vira baixa
do $$ declare r jsonb := public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e301',
  '{"action":"fin_entry_create","entry_kind":"expense","description":"Aluguel futuro","amount_cents":324200,"category_name":"Aluguel","entry_status":"pending","due_date":"2026-12-05"}'); begin
  assert not (r->'summary' ? 'settles_entry_id'), 'lançamento pendente não dá baixa';
end $$;

-- o caso: aluguel pago com o mesmo valor da recorrente
create temp table prop as select public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e301',
  '{"action":"fin_entry_create","entry_kind":"expense","description":"Pagamento do aluguel","amount_cents":324200,"category_name":"Aluguel"}') r;
grant select on prop to service_role;
do $$ declare r jsonb := (select r from prop); begin
  assert r->'summary'->>'settles_entry_id' = '00000000-0000-0000-0000-0000000007a1', 'liga à recorrente: ' || r::text;
  assert r->'summary'->>'settles_description' = 'Aluguel do Espaço', 'com a descrição dela';
  assert r->'summary'->>'receipt_id' = '00000000-0000-0000-0000-0000000006a1', 'e o comprovante segue junto';
end $$;

select fab.dono();
update public.conv_booking_proposals set created_at = now() - interval '1 minute' where id = ((select r from prop)->>'proposal_id')::uuid;
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, body) values
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000d301', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c301', 'confirmo');
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_confirm(((select r from prop)->>'proposal_id')::uuid, '00000000-0000-0000-0000-0000000005a2'); begin
  assert (r->>'ok')::boolean, 'baixa dada: ' || r::text;
end $$;

select fab.dono();
do $$ begin
  assert (select status from public.fin_entries where id = '00000000-0000-0000-0000-0000000007a1') = 'paid', 'recorrente quitada';
  assert (select settled_on from public.fin_entries where id = '00000000-0000-0000-0000-0000000007a1') = conv_private.today(), 'na data do pagamento';
  assert not exists (select 1 from public.fin_entries where description = 'Pagamento do aluguel'), 'nenhuma despesa nova';
  assert (select count(*) from public.fin_attachments where entry_id = '00000000-0000-0000-0000-0000000007a1' and storage_path = 'whatsapp/x/aluguel.pdf') = 1,
    'comprovante anexado à recorrente';
  assert (select finance_entry_id from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-0000000006a1') = '00000000-0000-0000-0000-0000000007a1',
    'intenção aponta a recorrente';
end $$;

-- pendente quitada por fora entre a proposta e o "confirmo": falha honesta, sem lançar
insert into public.fin_entries (id, kind, status, description, category_id, amount_cents, competence_date, due_date, account_id, request_id) values
  ('00000000-0000-0000-0000-0000000007a4', 'expense', 'pending', 'Contador', '00000000-0000-0000-0000-0000000000b3', 18000,
   date_trunc('month', conv_private.today())::date, conv_private.today() - 3, '00000000-0000-0000-0000-0000000000b1', gen_random_uuid());
select fab.como('service_role');
create temp table prop2 as select public.conv_svc_ai_admin_finance_propose('00000000-0000-0000-0000-00000000e301',
  '{"action":"fin_entry_create","entry_kind":"expense","description":"Pagamento do contador","amount_cents":18000,"category_name":"Aluguel"}') r;
grant select on prop2 to service_role;
select fab.dono();
do $$ begin assert (select r->'summary'->>'settles_entry_id' from prop2) = '00000000-0000-0000-0000-0000000007a4', 'liga ao contador'; end $$;
update public.fin_entries set status = 'canceled', canceled_at = now(), cancel_reason = 'teste' where id = '00000000-0000-0000-0000-0000000007a4';
update public.conv_booking_proposals set created_at = now() - interval '1 minute' where id = ((select r from prop2)->>'proposal_id')::uuid;
insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id, body) values
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000d301', 'inbound', 'text', 'received', 'customer', '00000000-0000-0000-0000-00000000c301', 'confirmo');
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_ai_confirm(((select r from prop2)->>'proposal_id')::uuid, '00000000-0000-0000-0000-0000000005a3'); begin
  assert not coalesce((r->>'ok')::boolean, false), 'não confirma: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert not exists (select 1 from public.fin_entries where description = 'Pagamento do contador'), 'nada lançado em dobro';
end $$;
