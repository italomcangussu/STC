-- Ítalo (04/11/2026): o custo do aplicativo e o do agente de IA são abatidos da mensalidade dele.
-- Pix de 400 - 148 - 23 = 229 quita a mensalidade de 400 e paga as duas despesas na mesma conta e data.
create temp table u as select fab.usuario('henrique@x.com') as adm, fab.usuario('italo@x.com') as ita, fab.usuario('outro@x.com') as out;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role, is_active) select ita, 'Ítalo Cangussú', 'admin', true from u on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true;
insert into public.profiles (id, name, role, is_active) select out, 'Outro Sócio', 'socio', true from u on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true;
insert into public.fin_settings (id, payee_names) values (true, array['Sobral Tenis Clube']) on conflict (id) do update set payee_names = excluded.payee_names;
update public.fin_settings set finance_admin_profile_id = (select adm from u);
insert into public.fin_accounts (id, name, kind, active, is_default_receipts, opening_date) values ('00000000-0000-0000-0000-0000000000c1', 'Cora', 'bank', true, true, '2026-01-01');
insert into public.fin_categories (id, name, kind, dre_line, active) values ('00000000-0000-0000-0000-0000000000b2', 'Sistemas', 'expense', 'administrative', true);
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c601', '558800000601', 'Henrique', adm, 'linked' from u;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c602', '558800000602', 'Ítalo', ita, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d602', 'direct', '00000000-0000-0000-0000-00000000c602');

create temp table mes as select date_trunc('month', now() at time zone 'America/Fortaleza')::date m, (now() at time zone 'America/Fortaleza')::date hoje;
grant select on mes to service_role, authenticated;

-- planos de 400 e cobranças do mês
select fab.como('authenticated', (select adm from u));
create temp table plano as select public.fin_create_member_plan(gen_random_uuid(), jsonb_build_object('profile_id', (select ita from u), 'start_on', (select m from mes), 'amount_cents', 40000)) r
  union all select public.fin_create_member_plan(gen_random_uuid(), jsonb_build_object('profile_id', (select out from u), 'start_on', (select m from mes), 'amount_cents', 40000));
select public.fin_generate_member_charges(gen_random_uuid(), (r->>'id')::uuid, (select hoje from mes)) from plano;
select fab.dono();

-- despesas recorrentes abatidas da mensalidade do Ítalo
insert into public.fin_recurrences (id, description, category_id, amount_cents, frequency, due_day, due_month_offset, start_month, account_id, active, offset_profile_id)
select '00000000-0000-0000-0000-0000000000e1'::uuid, 'Custo aplicativo', '00000000-0000-0000-0000-0000000000b2'::uuid, 14800, 'monthly', 5, 0, m, '00000000-0000-0000-0000-0000000000c1'::uuid, true, ita from mes, u
union all
select '00000000-0000-0000-0000-0000000000e2'::uuid, 'Custo agente de IA', '00000000-0000-0000-0000-0000000000b2'::uuid, 2300, 'monthly', 5, 0, m, '00000000-0000-0000-0000-0000000000c1'::uuid, true, ita from mes, u;
select fin_private.generate_recurrences(null, null);

create temp table cob as select c.id, c.profile_id from public.fin_member_charges c, mes where c.competence_month = mes.m;
grant select on cob to service_role, authenticated;

do $$ begin
  assert fin_private.member_offset_cents((select id from cob where profile_id = (select ita from u))) = 17100, 'abate 148 + 23';
  assert fin_private.member_offset_cents((select id from cob where profile_id = (select out from u))) = 0, 'outro sócio não abate nada';
  assert jsonb_array_length(fin_private.member_offset_plan((select ita from u))) = 2, 'ficha mostra as duas despesas';
  assert (conv_private.receipt_proposal_offsets(jsonb_build_object('paid_on', (select hoje from mes),
    'allocations', jsonb_build_array(jsonb_build_object('charge_id', (select id from cob where profile_id = (select ita from u)), 'amount_cents', 22900))))->>'offset_cents')::bigint = 17100,
    'proposta pelo WhatsApp avisa o abatimento';
  assert conv_private.receipt_proposal_offsets(jsonb_build_object('paid_on', (select hoje from mes),
    'allocations', jsonb_build_array(jsonb_build_object('charge_id', (select id from cob where profile_id = (select ita from u)), 'amount_cents', 10000)))) = '{}'::jsonb,
    'valor parcial qualquer não abate';
end $$;

create function pg_temp.comprovante(p_id uuid, p_amount bigint, p_hash text) returns void language sql as $$
  insert into public.conv_messages (id, conversation_id, direction, kind, status, origin, sender_contact_id)
  values (p_id, '00000000-0000-0000-0000-00000000d602', 'inbound', 'image', 'received', 'customer', '00000000-0000-0000-0000-00000000c602');
  insert into fin_private.whatsapp_receipt_intents (id, source_message_id, conversation_id, profile_id, contact_id, original_data)
  select p_id, p_id, '00000000-0000-0000-0000-00000000d602', ita, '00000000-0000-0000-0000-00000000c602',
    jsonb_build_object('storage_path', 'ita/' || p_id || '.jpg', 'file_name', 'pix.jpg', 'content_type', 'image/jpeg', 'size_bytes', 700,
      'content_sha256', p_hash, 'declared_amount_cents', p_amount, 'declared_paid_on', (now() at time zone 'America/Fortaleza')::date::text,
      'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', 'Sobral Tenis Clube', 'amount_cents', p_amount, 'paid_on', (now() at time zone 'America/Fortaleza')::date::text,
      'confidence', jsonb_build_object('amount', 'high', 'date', 'high'))) from u;
$$;

-- valor que não é nem o cheio nem o líquido: não baixa e informa o líquido
select pg_temp.comprovante('00000000-0000-0000-0000-00000000f101', 30000, repeat('8', 64));
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f101', '{}'::jsonb); begin
  assert r->>'reason' = 'AMOUNT_MISMATCH' and (r->>'due_cents')::bigint = 22900, 'divergência mostra o valor líquido: ' || r::text;
end $$;
select fab.dono();

-- Pix de 229: quita os 400 e paga as despesas
select pg_temp.comprovante('00000000-0000-0000-0000-00000000f102', 22900, repeat('9', 64));
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f102', '{}'::jsonb); begin
  assert (r->>'applied')::boolean, 'baixa com abatimento: ' || r::text;
  assert (r->>'offset_cents')::bigint = 17100 and r->>'offset_items' = 'Custo agente de IA 23,00, Custo aplicativo 148,00', 'retorno descreve o abatimento: ' || r::text;
end $$;
select fab.dono();
do $$ declare v_charge uuid := (select id from cob where profile_id = (select ita from u)); begin
  assert (select status from public.fin_member_charges where id = v_charge) = 'paid', 'mensalidade quitada';
  assert (select sum(amount_cents) from public.fin_charge_payments where charge_id = v_charge) = 40000, 'mensalidade recebida cheia';
  assert (select count(*) from public.fin_entries e, mes where e.recurrence_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2')
          and e.competence_date = mes.m and e.status = 'paid' and e.settled_on = mes.hoje) = 2, 'as duas despesas pagas hoje';
  assert (select sum(p.amount_cents) from public.fin_entry_payments p join public.fin_entries e on e.id = p.entry_id, mes
          where e.competence_date = mes.m and p.account_id = '00000000-0000-0000-0000-0000000000c1') = 17100, 'despesas saem da mesma conta';
  assert fin_private.member_offset_cents(v_charge) = 0, 'nada mais a abater';
end $$;
