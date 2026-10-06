-- Regras de vencimento do clube (decisões de 2026-10-06):
--
--  1. Vence no MÊS COBRADO. Um vínculo que começa em setembro tem a 1ª cobrança (competência
--     setembro) vencendo em setembro — antes vencia no dia 5 do mês seguinte. A competência já era
--     o mês do início do vínculo; o que muda é só o vencimento (`due_month_offset` 1 → 0).
--     Mensal: vence no próprio mês. Trimestral/semestral/anual: `due_month_offset = 0` continua
--     sendo o ÚLTIMO mês do período (comportamento já existente de `fin_private.due_date`).
--
--  2. Só FINS DE SEMANA são dias não úteis: feriado não conta. Dia 5 em sábado ou domingo vai para
--     a segunda; feriado de semana vence normalmente. Os feriados continuam cadastrados (consulta
--     e reativação na tela Configurações › Feriados), só ficam INATIVOS — o calendário do banco e o
--     do app já contam apenas os ativos. `seed_holidays` passa a semear tudo inativo, para que os
--     próximos anos não reativem os feriados.
--
-- Cobranças: só mudam as intocadas — abertas, geradas pelo sistema, sem pagamento efetivo e sem
-- ajuste (a mesma definição que `fin_set_plan_price` usa para reajustar preço). Não toca cobrança
-- paga, parcial, cancelada, com ajuste ou lançada à mão (`source = 'manual'`), nem o vencimento
-- próprio de um plano (`fin_member_plans.due_day` / `due_month_offset`).
--
-- Idempotente: rodar de novo não muda nada. Sem DROP e sem UPDATE sem WHERE (o conector do
-- Supabase trava nesses dois casos; ver .fabuloso/historico.md, 2026-10-06 (3)).

-- Rastro de auditoria legível (lido por `fin_private.audit_row`).
select set_config('fin.action', 'due_same_month', true);
select set_config('fin.reason', 'Vencimento no mês cobrado e só fins de semana (decisão do clube, 2026-10-06)', true);

-- 1. Instalações novas já nascem vencendo no mês cobrado.
alter table public.fin_settings alter column due_month_offset set default 0;

-- 1b. Configuração do clube: só sai da regra inicial (mês seguinte); quem já escolheu outra, fica.
--     `version` sobe para que uma tela de Configurações aberta antes não sobrescreva a regra nova.
update public.fin_settings
set due_month_offset = 0, version = version + 1, updated_at = now()
where id and due_month_offset = 1;

-- 2. Feriados não contam. As linhas ficam (o admin pode reativar qualquer uma).
update public.fin_holidays
set active = false, updated_at = now()
where active;

-- Mesma função da migration 1, mas semeando TUDO inativo (antes: feriados nacionais ativos).
create or replace function fin_private.seed_holidays(p_year integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_easter date := fin_private.easter(p_year); v_n integer;
begin
  insert into public.fin_holidays(holiday_date, name, scope, kind, active)
  select * from (values
    (make_date(p_year, 1, 1), 'Confraternização Universal', 'national', 'holiday', false),
    (v_easter - 2, 'Sexta-feira Santa', 'national', 'holiday', false),
    (make_date(p_year, 4, 21), 'Tiradentes', 'national', 'holiday', false),
    (make_date(p_year, 5, 1), 'Dia do Trabalho', 'national', 'holiday', false),
    (make_date(p_year, 9, 7), 'Independência do Brasil', 'national', 'holiday', false),
    (make_date(p_year, 10, 12), 'Nossa Senhora Aparecida', 'national', 'holiday', false),
    (make_date(p_year, 11, 2), 'Finados', 'national', 'holiday', false),
    (make_date(p_year, 11, 15), 'Proclamação da República', 'national', 'holiday', false),
    (make_date(p_year, 12, 25), 'Natal', 'national', 'holiday', false),
    (v_easter - 48, 'Carnaval (segunda-feira)', 'national', 'optional', false),
    (v_easter - 47, 'Carnaval (terça-feira)', 'national', 'optional', false),
    (v_easter + 60, 'Corpus Christi', 'national', 'optional', false)
  ) v(d, n, s, k, a)
  on conflict (holiday_date, scope) do nothing;
  get diagnostics v_n = row_count;
  if p_year >= 2024 then
    insert into public.fin_holidays(holiday_date, name, scope, kind, active)
    values (make_date(p_year, 11, 20), 'Dia da Consciência Negra', 'national', 'holiday', false)
    on conflict (holiday_date, scope) do nothing;
  end if;
  return v_n;
end $$;

-- 3. Cobranças já geradas e ainda intocadas passam a vencer com a regra nova (mês cobrado, só
--    fins de semana), em um único passe.
update public.fin_member_charges c
set due_date = x.new_due, version = c.version + 1, updated_at = now()
from (
  select c2.id,
    fin_private.due_date(c2.competence_month, c2.period_months, coalesce(pl.due_day, s.due_day),
      coalesce(pl.due_month_offset, s.due_month_offset), s.non_business_rule) as new_due
  from public.fin_member_charges c2
  join public.fin_member_plans pl on pl.id = c2.plan_id
  cross join public.fin_settings s
  where c2.status = 'open' and c2.source = 'generated'
    and not exists (select 1 from fin_private.charge_payments_effective p where p.charge_id = c2.id)
    and not exists (select 1 from public.fin_charge_adjustments a where a.charge_id = c2.id)
) x
where c.id = x.id and c.due_date is distinct from x.new_due;
