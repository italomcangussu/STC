-- Admin que também é sócio (Hermeson, 03/11): o Pix da própria mensalidade tem baixa automática como o de qualquer sócio.
create temp table u as select fab.usuario('henrique@x.com') as adm, fab.usuario('socio@x.com') as soc;
grant select on u to service_role, authenticated;
insert into public.profiles (id, name, role) select adm, 'Henrique Coelho', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.profiles (id, name, role, is_active) select soc, 'Hermeson Veras', 'admin', true from u on conflict (id) do update set name = excluded.name, role = excluded.role, is_active = true;
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
      'ocr_status', 'ok', 'ocr', jsonb_build_object('payee', p_payee)) from u;
$$;

-- valor diferente: não baixa

select pg_temp.comprovante('00000000-0000-0000-0000-00000000f101', 15000, 'Sobral Tenis Clube', repeat('9', 64));
select fab.como('service_role');
do $$ declare r jsonb := public.conv_svc_receipt_membership_auto('00000000-0000-0000-0000-00000000f101'); begin
  assert (r->>'applied')::boolean, 'admin com mensalidade em aberto tem baixa: ' || r::text;
end $$;
select fab.dono();
do $$ begin
  assert (select status from public.fin_member_charges where id = (select id from cob)) = 'paid', 'mensalidade do admin paga';
end $$;
