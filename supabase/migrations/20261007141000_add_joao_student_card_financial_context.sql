create or replace function conv_private.ai_financial_context()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
with
today as (
  select (now() at time zone 'America/Fortaleza')::date as d
),
students as (
  select
    ns.id,
    ns.name,
    ns.plan_type,
    ns.plan_status,
    coalesce(ns.is_active, true) as record_active,
    ns.student_type,
    ns.master_expiration_date,
    coalesce(sp.student_status, 'active') as student_status,
    prof_profile.name as professor_name,
    resp.name as responsible_name,
    greatest(ns.master_expiration_date, ap.active_valid_until::date) as effective_valid_until,
    ap.last_active_payment_at,
    ap.last_active_amount,
    lp.payment_date as latest_payment_at,
    lp.amount as latest_payment_amount,
    lp.status::text as latest_payment_status,
    lp.cancelled_reason as latest_cancelled_reason
  from public.non_socio_students ns
  left join lateral (
    select x.student_status, x.professor_id
    from public.student_profiles x
    where x.non_socio_student_id = ns.id
    order by x.updated_at desc, x.created_at desc
    limit 1
  ) sp on true
  left join public.professors prof on prof.id = coalesce(sp.professor_id, ns.professor_id)
  left join public.profiles prof_profile on prof_profile.id = prof.user_id
  left join public.profiles resp on resp.id = ns.responsible_socio_id
  left join lateral (
    select
      max(p.valid_until) filter (where p.status::text = 'active') as active_valid_until,
      max(p.payment_date) filter (where p.status::text = 'active') as last_active_payment_at,
      (array_agg(p.amount order by p.payment_date desc) filter (where p.status::text = 'active'))[1] as last_active_amount
    from public.student_payments p
    where p.student_id = ns.id
  ) ap on true
  left join lateral (
    select p.payment_date, p.amount, p.status, p.cancelled_reason
    from public.student_payments p
    where p.student_id = ns.id
    order by p.payment_date desc, p.created_at desc
    limit 1
  ) lp on true
),
student_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', s.name,
      'plan_type', s.plan_type,
      'plan_status', s.plan_status,
      'record_active', s.record_active,
      'student_type', s.student_type,
      'student_status', s.student_status,
      'card_status',
        case
          when not s.record_active then 'inactive'
          when s.student_status = 'paused' then 'paused'
          when s.student_status = 'ended' then 'ended'
          when coalesce(s.plan_status, 'active') <> 'active' then coalesce(s.plan_status, 'inactive')
          when s.plan_type = 'Dependente' then 'active'
          when s.effective_valid_until is null then 'no_validity'
          when s.effective_valid_until >= t.d then 'active'
          else 'expired'
        end,
      'valid_until', s.effective_valid_until,
      'days_to_expiration',
        case when s.effective_valid_until is null then null else (s.effective_valid_until - t.d) end,
      'professor', s.professor_name,
      'responsible', s.responsible_name,
      'last_active_payment_on', s.last_active_payment_at,
      'last_active_payment_amount', s.last_active_amount,
      'latest_payment_on', s.latest_payment_at,
      'latest_payment_amount', s.latest_payment_amount,
      'latest_payment_status', s.latest_payment_status,
      'latest_cancelled_reason', s.latest_cancelled_reason
    )
    order by s.name
  ), '[]'::jsonb) as value
  from students s cross join today t
),
day_cards as (
  select
    r.date as occurred_on,
    trim(r.guest_name) as guest_name,
    p.name as booked_by,
    r.payment_status::text as payment_status,
    case when r.payment_status::text = 'exempt' then 0::bigint else fs.day_card_price_cents end as amount_cents
  from public.reservations r
  left join public.profiles p on p.id = r.creator_id
  cross join public.fin_settings fs
  cross join today t
  where r.type = 'Play'
    and nullif(trim(coalesce(r.guest_name, '')), '') is not null
    and coalesce(r.status::text, 'active') <> 'cancelled'
    and r.date between (t.d - 90) and (t.d + 60)
),
day_card_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', d.occurred_on,
      'guest_name', d.guest_name,
      'booked_by', d.booked_by,
      'payment_status', d.payment_status,
      'amount_cents', d.amount_cents
    )
    order by d.occurred_on desc, d.guest_name
  ), '[]'::jsonb) as value
  from day_cards d
)
select jsonb_build_object(
  'as_of', to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI'),
  'students', (select value from student_json),
  'day_cards', (select value from day_card_json),
  'day_card_price_cents', (select day_card_price_cents from public.fin_settings limit 1)
)
$function$;

create or replace function public.conv_svc_ai_financial_context()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select conv_private.ai_financial_context()
$function$;

revoke all on function public.conv_svc_ai_financial_context() from public;
revoke all on function public.conv_svc_ai_financial_context() from anon;
revoke all on function public.conv_svc_ai_financial_context() from authenticated;
grant execute on function public.conv_svc_ai_financial_context() to service_role;
