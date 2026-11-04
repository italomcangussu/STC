-- Época da mensalidade: comprovante do sócio com o valor devido e o clube como favorecido tem baixa automática.
create temp table u as select fab.usuario('henrique@x.com') as adm, fab.usuario('socio@x.com') as soc;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role, is_active) select soc, 'Tiago Sócio', 'socio', true from u on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true;
insert into public.fin_settings (id, payee_names) values (true, array['Sobral Tenis Clube']) on conflict (id) do update set payee_names = excluded.payee_names;
update public.fin_settings set finance_admin_profile_id = (select adm from u);
insert into public.fin_accounts (id, name, kind, active, is_default_receipts, opening_date) values ('00000000-0000-0000-0000-0000000000c1', 'Cora', 'bank', true, true, '2026-01-01');
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c601', '558800000601', 'Henrique', adm, 'linked' from u;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c602', '558800000602', 'Tiago', soc, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d602', 'direct', '00000000-0000-0000-0000-00000000c602');

-- plano e cobrança do mês do sócio, como o painel faz
select fab.como('authenticated', (select adm from u));
create temp table plano as select public.fin_create_member_plan(gen_random_uuid(), jsonb_build_object('profile_id', (select soc from u),
  'start_on', date_trunc('month', now() at time zone 'America/Fortaleza')::date, 'amount_cents', 15000)) r;
select public.fin_generate_member_charges(gen_random_uuid(), ((select r from plano)->>'id')::uuid, (now() at time zone 'America/Fortaleza')::date);
select fab.dono();
create temp table cob as select c.id, st.total_due from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, (now() at time zone 'America/Fortaleza')::date) st
  where c.profile_id = (select soc from u) and c.competence_month = date_trunc('month', now() at time zone 'America/Fortaleza')::date;
grant select on cob to service_role;

create function pg_temp.comprovante(p_id uuid, p_amount bigint, p_payee text, p_hash text) returns void language sql as $$
  insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id)
  values (p_id, '00000000-0000-0000-0000-00000000d602', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c602');
  insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data)
  select p_id, p_id, '00000000-0000-0000-0000-00000000d602', soc, '00000000-0000-0000-0000-00000000c602',
    jsonb_build_object('storage_path', 'soc/' || p_id || '.jpg', 'file_name', 'pix.jpg', 'content_type', 'image/jpeg', 'size_bytes', 700,
      'content_sha256', p_hash, 'declared_amount_cents', p_amount, 'declared_paid_on', (now() at time zone 'America/Fortaleza')::date::text,
      'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', p_payee, 'amount_cents', p_amount, 'paid_on', (now() at time zone 'America/Fortaleza')::date::text, 'confidence', jsonb_build_object('amount', 'high', 'date', 'high'))) from u;
$$;


-- Meses com o mesmo valor não se resolvem pela preferência pelo mês atual.
insert into public.fin_member_charges(plan_id, profile_id, competence_month, period_months, due_date, original_amount_cents)
select plan_id, profile_id, (competence_month - interval '1 month')::date, 1, due_date, original_amount_cents
from public.fin_member_charges where id = (select id from cob);
select pg_temp.comprovante('00000000-0000-0000-0000-00000000f201', (select total_due from cob), 'Sobral Tenis Clube', repeat('1',64));
select fab.como('service_role');
do $$ declare r jsonb; begin
  r := public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f201');
  assert r->>'reason' = 'AMBIGUOUS', 'duas competências iguais precisam do mês: ' || r::text;
end $$;
select fab.dono();

-- Sem OCR confiável, data inexistente/futura ou agendamento, nenhuma baixa.
do $$ declare v_issue text; v_data jsonb; v_today date := conv_private.today(); begin
  select original_data into v_data from fin_private.whatsapp_receipt_intents where id = '00000000-0000-0000-0000-00000000f201';
  assert fin_private.receipt_payment_issue(v_data, v_today) is null;
  assert fin_private.receipt_payment_issue(v_data #- '{ocr,confidence}', v_today) = 'OCR_UNCERTAIN';
  assert fin_private.receipt_payment_issue(jsonb_set(v_data, '{ocr,confidence,amount}', '"low"'), v_today) = 'OCR_UNCERTAIN';
  assert fin_private.receipt_payment_issue(jsonb_set(v_data, '{ocr,confidence,date}', '"none"'), v_today) = 'OCR_UNCERTAIN';
  assert fin_private.receipt_payment_issue(jsonb_set(v_data, '{ocr,amount_cents}', '9999'), v_today) = 'OCR_UNCERTAIN';
  foreach v_issue in array array['scheduled','pending','failed'] loop
    assert fin_private.receipt_payment_issue(jsonb_set(v_data, '{ocr,payment_status}', to_jsonb(v_issue)), v_today) = 'PAYMENT_NOT_COMPLETED';
  end loop;
  v_data := jsonb_set(jsonb_set(v_data, '{declared_paid_on}', to_jsonb((v_today+1)::text)), '{ocr,paid_on}', to_jsonb((v_today+1)::text));
  assert fin_private.receipt_payment_issue(v_data, v_today) = 'INVALID_PAYMENT_DATE';
end $$;
update fin_private.whatsapp_receipt_intents set original_data = jsonb_set(original_data, '{ocr,confidence,amount}', '"low"')
where id = '00000000-0000-0000-0000-00000000f201';
select fab.como('service_role');
do $$ declare r jsonb; begin
  r := public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f201', jsonb_build_object('purpose_kind', 'membership', 'month', date_trunc('month', now() at time zone 'America/Fortaleza')::date));
  assert r->>'reason' = 'OCR_UNCERTAIN', 'guarda vale no RPC real: ' || r::text;
end $$;
select fab.dono();
update fin_private.whatsapp_receipt_intents set original_data = jsonb_set(original_data, '{ocr,confidence,amount}', '"high"')
where id = '00000000-0000-0000-0000-00000000f201';

-- CNPJ só do favorecido também identifica o clube quando o nome não foi lido.
update fin_private.whatsapp_receipt_intents set original_data = jsonb_set(jsonb_set(original_data, '{ocr,payee}', 'null'), '{ocr,payee_document}', '"11222333000181"')
where id = '00000000-0000-0000-0000-00000000f201';
select fab.como('service_role');
do $$ declare r jsonb; begin
  r := public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f201');
  assert r->>'reason' = 'PAYEE', 'CNPJ diferente não baixa: ' || r::text;
end $$;
select fab.dono();
update fin_private.whatsapp_receipt_intents set original_data = jsonb_set(original_data, '{ocr,payee_document}', '"52393541000120"')
where id = '00000000-0000-0000-0000-00000000f201';

-- Competência atrasada explícita: baixa só ela e informa a competência REAL.
update fin_private.whatsapp_receipt_intents set original_data = original_data || jsonb_build_object('declared_reference','E12345678202611041111abcdefghijk')
where id = '00000000-0000-0000-0000-00000000f201';
select fab.como('service_role');
do $$ declare r jsonb; v_month date := (date_trunc('month', now() at time zone 'America/Fortaleza') - interval '1 month')::date; begin
  r := public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f201', jsonb_build_object('purpose_kind', 'membership', 'month', v_month));
  assert (r->>'applied')::boolean, 'competência explícita resolve: ' || r::text;
  assert (r->>'month')::date = v_month, 'resposta deve informar o mês pago, não o atual';
end $$;
select fab.dono();
do $$ begin
  assert (select status from public.fin_member_charges where id = (select id from cob)) = 'open', 'mês atual permanece aberto';
  assert (select count(*) from public.fin_member_charges where profile_id = (select soc from u) and status='paid') = 1;
end $$;

-- Outra foto do mesmo Pix tem hash diferente mas não vira outro pagamento.
select pg_temp.comprovante('00000000-0000-0000-0000-00000000f202', (select total_due from cob), 'Sobral Tenis Clube', repeat('2',64));
update fin_private.whatsapp_receipt_intents set original_data = original_data || jsonb_build_object('declared_reference','e12345678202611041111abcdefghijk')
where id = '00000000-0000-0000-0000-00000000f202';
select fab.como('service_role');
do $$ declare r jsonb; begin
  r := public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f202');
  assert r->>'reason' = 'DUPLICATE', 'mesma transação em imagem diferente: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select count(*) from public.fin_charge_payments where charge_id in (select id from public.fin_member_charges where profile_id = (select soc from u))) = 1, 'um Pix gera um pagamento';
end $$;

-- Não autoriza cliente público a executar a baixa.
select fab.como('authenticated', (select soc from u));
select fab.espera_erro($q$select public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f202', '{}'::jsonb)$q$, 'permission denied');
select fab.como('anon');
select fab.espera_erro($q$select public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f202')$q$, 'permission denied');
