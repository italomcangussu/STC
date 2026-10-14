-- Transparência financeira: o sócio ativo lê o Painel e as saídas fixas do clube; quem não é sócio ativo, não.

create temp table u as select fab.usuario('socio@x.com') as socio, fab.usuario('ex@x.com') as ex, fab.usuario('adm@x.com') as adm;
grant select on u to authenticated;

insert into public.profiles (id, name, role) select socio, 'Sócio', 'socio' from u;
insert into public.profiles (id, name, role, is_active) select ex, 'Ex-sócio', 'socio', false from u;
insert into public.profiles (id, name, role) select adm, 'Admin', 'admin' from u;

insert into public.fin_categories (id, name, kind, dre_line) values ('00000000-0000-0000-0000-0000000000c1', 'Energia elétrica', 'expense', 'operational');
insert into public.fin_recurrences (id, description, supplier, category_id, amount_cents, frequency, due_day, start_month, end_month, active) values
  ('00000000-0000-0000-0000-0000000000f1', 'Conta de luz', 'Enel', '00000000-0000-0000-0000-0000000000c1', 85000, 'monthly', 10, '2026-01-01', null, true),
  ('00000000-0000-0000-0000-0000000000f2', 'Contrato antigo', null, '00000000-0000-0000-0000-0000000000c1', 10000, 'monthly', 5, '2020-01-01', '2020-12-01', true),
  ('00000000-0000-0000-0000-0000000000f3', 'Desativada', null, '00000000-0000-0000-0000-0000000000c1', 20000, 'yearly', 5, '2026-01-01', null, false);

-- 1) sócio ativo lê as cinco leituras do Painel
select fab.como('authenticated', (select socio from u));
select fab.espera_linhas($$select 1 from public.fin_receivables_summary()$$, 1);
select fab.espera_linhas($$select 1 from public.fin_payables_summary()$$, 1);
select fab.espera_linhas($$select 1 from public.fin_monthly_trend(null, 6)$$, 6);
select public.fin_account_balances();
select public.fin_dre_lines('2026-10-01', '2026-10-31');

-- 2) saídas fixas: só as ativas e vigentes, com o nome da categoria
select fab.espera_linhas($$select 1 from public.fin_club_fixed_expenses()$$, 1);
select fab.espera_linhas($$select 1 from public.fin_club_fixed_expenses() where description = 'Conta de luz' and category_name = 'Energia elétrica' and amount_cents = 85000$$, 1);

-- 3) o sócio continua sem as leituras que não são do Painel (detalhe com lançamento por pessoa)
select fab.espera_erro($$select public.fin_dre_detail('2026-10-01', '2026-10-31')$$, 'FINANCE_FORBIDDEN');

-- 4) sócio inativo não lê nada
select fab.como('authenticated', (select ex from u));
select fab.espera_erro($$select public.fin_club_fixed_expenses()$$, 'FINANCE_FORBIDDEN');
select fab.espera_erro($$select public.fin_receivables_summary()$$, 'FINANCE_FORBIDDEN');

-- 5) admin segue lendo
select fab.como('authenticated', (select adm from u));
select fab.espera_linhas($$select 1 from public.fin_club_fixed_expenses()$$, 1);
select fab.espera_linhas($$select 1 from public.fin_payables_summary()$$, 1);
