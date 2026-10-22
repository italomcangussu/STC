-- Resumo da manhã do João: o resultado do mês é o mesmo do painel (competência do mês inteiro, `fin_dre_lines`),
-- não o caixa do dia 1 até hoje. Despesa paga de outro mês entra no caixa mas não no resultado; despesa pendente
-- com competência no mês entra no resultado mesmo sem ter saído dinheiro.

create temp table u as select fab.usuario('adm-briefing@x.com') as adm;
insert into public.profiles (id, name, role) select adm, 'Admin Resumo', 'admin' from u on conflict (id) do update set name = excluded.name, role = excluded.role;
insert into public.conv_contacts (id, phone, name, profile_id, link_status) select '00000000-0000-0000-0000-00000000c201', '558800000201', 'Admin Resumo', adm, 'linked' from u;
insert into public.conv_conversations (id, kind, contact_id) values ('00000000-0000-0000-0000-00000000d201', 'direct', '00000000-0000-0000-0000-00000000c201');
insert into public.conv_admin_briefing_recipients (profile_id) select adm from u;
grant select on u to service_role;

insert into public.fin_accounts (id, name, kind, opening_date) values ('00000000-0000-0000-0000-0000000000a1', 'Conta Teste', 'bank', '2026-01-01');
insert into public.fin_categories (id, name, kind, dre_line) values
  ('00000000-0000-0000-0000-0000000000b1', 'Receita teste', 'revenue', 'revenue'),
  ('00000000-0000-0000-0000-0000000000b2', 'Despesa teste', 'expense', 'operational');

create temp table m as select date_trunc('month', (now() at time zone 'America/Fortaleza'))::date as ini;
insert into public.fin_entries (kind, status, description, category_id, amount_cents, competence_date, due_date, account_id, settled_on, request_id)
select v.kind, v.status, v.descr, v.cat, v.amt, v.comp, v.comp, '00000000-0000-0000-0000-0000000000a1', v.settled, gen_random_uuid() from m, lateral (values
  ('revenue', 'paid',    'Receita do mês',            '00000000-0000-0000-0000-0000000000b1'::uuid, 100000::bigint, m.ini,                       m.ini),
  ('expense', 'pending', 'Despesa do mês, a pagar',   '00000000-0000-0000-0000-0000000000b2'::uuid,  30000::bigint, m.ini,                       null::date),
  ('expense', 'paid',    'Despesa do mês passado',    '00000000-0000-0000-0000-0000000000b2'::uuid,  20000::bigint, (m.ini - interval '1 month')::date, m.ini)
) v(kind, status, descr, cat, amt, comp, settled);

select fab.como('service_role');
do $$
declare r jsonb; d jsonb;
begin
  r := public.conv_svc_admin_briefing_data((select adm from u));
  assert (r->>'ok')::boolean, 'o resumo monta: ' || r::text;
  d := r->'data'->'month_dre';
  assert d->>'revenue_cents' = '100000', 'receita do mês por competência: ' || coalesce(d::text, 'null');
  assert d->>'expenses_cents' = '30000', 'despesa por competência conta a pendente do mês e ignora a do mês passado: ' || d::text;
  assert d->>'result_cents' = '70000', 'resultado = receita − despesas: ' || d::text;
end $$;
