-- STC: nao expor nem gerar mensalidades antes do dia 1 da competencia.
-- Cobranças futuras existentes sao estacionadas e reativadas em sua competencia.
CREATE OR REPLACE FUNCTION fin_private.generate_charges(p_plan uuid, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.fin_settings%rowtype; pl public.fin_member_plans%rowtype; v_until date; v_cursor date; v_amount bigint;
  v_due date; v_n integer; v_created integer := 0; v_existing integer := 0; v_missing integer := 0;
begin
  select * into s from public.fin_settings;
  -- Limite incondicional: mensalidade so na competencia iniciada em Fortaleza.
  v_until := least(
    (date_trunc('month', p_today::timestamp) + make_interval(months => s.horizon_months))::date,
    date_trunc('month', fin_private.today()::timestamp)::date
  );
  for pl in select * from public.fin_member_plans where status = 'active' and (p_plan is null or id = p_plan) order by created_at loop
    perform fin_private.ensure_holidays(extract(year from pl.start_on)::integer, extract(year from v_until)::integer + 1);
    v_cursor := date_trunc('month', pl.start_on::timestamp)::date;
    while v_cursor <= v_until and (pl.ended_on is null or v_cursor <= pl.ended_on) loop
      select amount_cents into v_amount from public.fin_member_plan_prices
      where plan_id = pl.id and effective_from <= v_cursor order by effective_from desc limit 1;
      if not found then
        v_missing := v_missing + 1;
      else
        v_due := fin_private.due_date(v_cursor, pl.period_months, coalesce(pl.due_day, s.due_day),
          coalesce(pl.due_month_offset, s.due_month_offset), s.non_business_rule);
        insert into public.fin_member_charges(plan_id, profile_id, competence_month, period_months, due_date, original_amount_cents, created_by, updated_by)
        values (pl.id, pl.profile_id, v_cursor, pl.period_months, v_due, v_amount, auth.uid(), auth.uid())
        on conflict (plan_id, competence_month) do update
          set status='open', canceled_at=null, canceled_by=null, cancel_reason=null,
              version=fin_member_charges.version+1, updated_at=now(), updated_by=auth.uid()
          where fin_member_charges.status='canceled'
            and fin_member_charges.source='generated'
            and fin_member_charges.cancel_reason='COMPETENCE_GENERATED_EARLY_20261010'
            and not exists (
              select 1 from fin_private.charge_payments_effective ep
              where ep.charge_id=fin_member_charges.id
            );
        get diagnostics v_n = row_count;
        if v_n > 0 then v_created := v_created + 1; else v_existing := v_existing + 1; end if;
      end if;
      v_cursor := (v_cursor + make_interval(months => pl.period_months))::date;
    end loop;
  end loop;
  return jsonb_build_object('created', v_created, 'existing', v_existing, 'missing_price', v_missing);
end $function$;


create or replace function fin_private.ensure_member_charges(p_profile uuid, p_extend boolean)
returns integer language plpgsql security definer set search_path='' as $function$
declare pl public.fin_member_plans%rowtype; v_before integer; v_after integer;
begin
  select count(*) into v_before from public.fin_member_charges where profile_id=p_profile;
  for pl in select * from public.fin_member_plans where profile_id=p_profile and status='active' order by created_at loop
    perform fin_private.generate_charges(pl.id,fin_private.today());
  end loop;
  -- p_extend permanece por compatibilidade; extensao futura nao e permitida.
  select count(*) into v_after from public.fin_member_charges where profile_id=p_profile;
  return v_after-v_before;
end $function$;

CREATE OR REPLACE FUNCTION fin_private.charge_rows(p_profile uuid, p_ids uuid[], p_filters jsonb, p_as_of date, p_limit integer, p_offset integer)
 RETURNS TABLE(charge_id uuid, plan_id uuid, profile_id uuid, profile_name text, competence_month date, period_months smallint, due_date date, original_amount_cents bigint, stored_status text, display_status text, in_review boolean, principal_base_cents bigint, principal_paid_cents bigint, principal_remaining_cents bigint, days_late integer, fine_due_cents bigint, interest_due_cents bigint, fees_due_cents bigint, fees_paid_cents bigint, fees_waived_cents bigint, total_due_cents bigint, fees_configured boolean, overdue boolean, last_payment_on date, cancel_reason text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_search text := nullif(trim(coalesce(p_filters->>'search', '')), '');
begin
  return query
  with x as (
    select c.id, c.plan_id, c.profile_id, pr.name pname, c.competence_month, c.period_months, c.due_date, c.original_amount_cents,
      c.status, c.cancel_reason,
      exists (select 1 from public.fin_receipt_charges rc join public.fin_receipt_submissions rs on rs.id = rc.submission_id
              where rc.charge_id = c.id and rs.status in ('submitted', 'in_review')) as rev,
      st.*,
      (select max(e.paid_on) from fin_private.charge_payments_effective e where e.charge_id = c.id) as last_pay
    from public.fin_member_charges c
    join public.profiles pr on pr.id = c.profile_id
    cross join lateral fin_private.charge_statement(c.id, p_as_of) st
    where (c.charge_type <> 'membership' or
           c.competence_month <= date_trunc('month', fin_private.today()::timestamp)::date)
      and (p_profile is null or c.profile_id = p_profile)
      and (p_ids is null or c.id = any(p_ids))
      and (v_search is null or pr.name ilike '%' || v_search || '%')
      and (nullif(p_filters->>'profile_id', '') is null or c.profile_id = (p_filters->>'profile_id')::uuid)
      and (nullif(p_filters->>'plan_id', '') is null or c.plan_id = (p_filters->>'plan_id')::uuid)
      and (nullif(p_filters->>'charge_type', '') is null or c.charge_type = p_filters->>'charge_type')
      and (nullif(p_filters->>'competence_from', '') is null or c.competence_month >= (p_filters->>'competence_from')::date)
      and (nullif(p_filters->>'competence_to', '') is null or c.competence_month <= (p_filters->>'competence_to')::date)
      and (nullif(p_filters->>'due_from', '') is null or c.due_date >= (p_filters->>'due_from')::date)
      and (nullif(p_filters->>'due_to', '') is null or c.due_date <= (p_filters->>'due_to')::date)
  ), y as (
    select x.*, case
      when x.status = 'canceled' then 'canceled'
      when x.status = 'paid' then 'paid'
      when x.rev then 'in_review'
      when x.status = 'partial' then 'partial'
      when p_as_of > x.due_date then 'overdue'
      when p_as_of <= ((x.competence_month + make_interval(months => x.period_months::integer))::date - 1) then 'forecast'
      else 'open' end as dstatus
    from x
  )
  select y.id, y.plan_id, y.profile_id, y.pname, y.competence_month, y.period_months, y.due_date, y.original_amount_cents,
    y.status, y.dstatus, y.rev, y.principal_base, y.principal_paid, y.principal_remaining, y.days_late, y.fine_due, y.interest_due,
    y.fees_due, y.fees_paid, y.fees_waived, y.total_due, y.fees_configured, y.overdue, y.last_pay, y.cancel_reason,
    count(*) over() as total_count
  from y
  where (nullif(p_filters->>'status', '') is null or y.dstatus = (p_filters->>'status'))
  order by y.due_date desc, y.pname, y.id
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end $function$;


alter policy fin_member_charges_read on public.fin_member_charges
using (
  (public.is_admin() or profile_id=(select auth.uid()))
  and (
    charge_type <> 'membership'
    or competence_month <= date_trunc('month',(now() at time zone 'America/Fortaleza'))::date
  )
);

update public.fin_member_charges c
set status='canceled', canceled_at=now(),
    cancel_reason='COMPETENCE_GENERATED_EARLY_20261010',
    canceled_by=null, version=version+1, updated_at=now()
where c.charge_type='membership'
  and c.source='generated'
  and c.competence_month>date_trunc('month',fin_private.today()::timestamp)::date
  and c.status='open'
  and not exists (
    select 1 from fin_private.charge_payments_effective p where p.charge_id=c.id
  );
-- Horizonte de previsao 0: nao anunciar geracao antecipada nas configuracoes.
update public.fin_settings set horizon_months=0, version=version+1, updated_at=now()
where horizon_months<>0;

-- Pagamentos indevidos exigem conciliacao individual, realizada apos a migracao.
