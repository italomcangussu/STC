-- Assessor: consultas nominais e operacionais (somente leitura, administrador no privado): inadimplentes, quem pagou, ficha do sócio,
-- vencimentos, alunos e últimos lançamentos. Usa as mesmas linhas de cobrança do painel (fin_private.charge_rows).
create function conv_private.ai_admin_read_more(p_session uuid, p_domain text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid; v_out jsonb; v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_from date; v_to date; v_profile uuid := nullif(p_args->>'profile_id', '')::uuid; v_days int;
begin
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador consulta, e só na conversa privada comigo.');
  end if;
  begin
    v_from := coalesce(nullif(p_args->>'from', '')::date, date_trunc('month', v_today)::date);
    v_to := coalesce(nullif(p_args->>'to', '')::date, v_today);
    v_days := least(greatest(coalesce(nullif(p_args->>'days', '')::int, 30), 1), 120);
  exception when others then
    return conv_private.vfail('INVALID_DATA', 'Não entendi o período. Pode dizer as datas?');
  end;
  if v_to < v_from or v_to - v_from > 731 then
    return conv_private.vfail('INVALID_DATA', 'Esse período não vale (início depois do fim, ou mais de 2 anos).');
  end if;

  if p_domain = 'inadimplentes' then
    select jsonb_build_object('as_of', v_today,
      'total_cents', coalesce(sum(t.total), 0), 'members', count(*),
      'items', coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'total_cents', t.total, 'charges', t.n, 'days_late', t.late) order by t.total desc) filter (where t.rk <= 30), '[]'::jsonb))
    into v_out from (
      select r.profile_name name, sum(r.total_due_cents)::bigint total, count(*)::int n, max(r.days_late)::int late,
             row_number() over (order by sum(r.total_due_cents) desc) rk
      from fin_private.charge_rows(null, null, '{}'::jsonb, v_today, 5000, 0) r where r.overdue and r.total_due_cents > 0
      group by r.profile_id, r.profile_name) t;
  elsif p_domain = 'pagamentos' then
    select jsonb_build_object('from', v_from, 'to', v_to, 'total_cents', coalesce(sum(t.paid), 0), 'members', count(*),
      'items', coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'paid_cents', t.paid, 'last', t.last) order by t.last desc, t.name) filter (where t.rk <= 40), '[]'::jsonb))
    into v_out from (
      select r.profile_name name, sum(r.principal_paid_cents)::bigint paid, max(r.last_payment_on) last,
             row_number() over (order by max(r.last_payment_on) desc, r.profile_name) rk
      from fin_private.charge_rows(null, null, '{}'::jsonb, v_today, 5000, 0) r
      where r.last_payment_on between v_from and v_to and r.principal_paid_cents > 0
      group by r.profile_id, r.profile_name) t;
  elsif p_domain = 'socio_ficha' then
    if v_profile is null then return conv_private.vfail('MEMBER_REQUIRED', 'De qual sócio?'); end if;
    select jsonb_build_object('name', p.name, 'role', p.role::text, 'active', coalesce(p.is_active, true), 'phone', p.phone,
      'since', p.created_at::date,
      'overdue_cents', coalesce((select sum(r.total_due_cents) from fin_private.charge_rows(v_profile, null, '{}'::jsonb, v_today, 500, 0) r where r.overdue), 0),
      'open_cents', coalesce((select sum(r.total_due_cents) from fin_private.charge_rows(v_profile, null, '{}'::jsonb, v_today, 500, 0) r where r.display_status in ('open', 'overdue', 'partial')), 0),
      'next_due', (select min(r.due_date) from fin_private.charge_rows(v_profile, null, '{}'::jsonb, v_today, 500, 0) r where r.display_status in ('open', 'overdue', 'partial', 'forecast') and r.principal_remaining_cents > 0),
      'last_payment', (select max(r.last_payment_on) from fin_private.charge_rows(v_profile, null, '{}'::jsonb, v_today, 500, 0) r),
      'dependents', coalesce((select jsonb_agg(d.name order by d.name) from public.non_socio_students d where d.responsible_socio_id = p.id and coalesce(d.is_active, true)), '[]'::jsonb))
    into v_out from public.profiles p where p.id = v_profile;
    if v_out is null then return conv_private.vfail('MEMBER_NOT_FOUND', 'Não achei esse sócio.'); end if;
  elsif p_domain = 'vencimentos' then
    select jsonb_build_object('until', v_today + v_days, 'payable_cents', coalesce(sum(e.amount_cents) filter (where e.kind = 'expense'), 0),
      'receivable_cents', coalesce(sum(e.amount_cents) filter (where e.kind = 'revenue'), 0),
      'items', coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'description', e.description, 'supplier', e.supplier, 'due_date', e.due_date, 'amount_cents', e.amount_cents, 'late', e.due_date < v_today) order by e.due_date, e.amount_cents desc), '[]'::jsonb))
    into v_out from (select * from public.fin_entries x where x.status = 'pending' and x.due_date <= v_today + v_days order by x.due_date limit 30) e;
  elsif p_domain = 'alunos' then
    select jsonb_build_object('regular', count(*) filter (where s.student_type = 'regular'), 'dependent', count(*) filter (where s.student_type = 'dependent'),
      'items', coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'type', s.student_type, 'plan', s.plan_type, 'expires', s.master_expiration_date) order by s.name) filter (where s.student_type = 'regular'), '[]'::jsonb))
    into v_out from public.non_socio_students s where coalesce(s.is_active, true) and s.plan_status = 'active';
  elsif p_domain = 'movimentos' then
    select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'description', e.description, 'amount_cents', e.amount_cents, 'on', e.settled_on) order by e.settled_on desc, e.created_at desc), '[]'::jsonb))
    into v_out from (select * from public.fin_entries x where x.status = 'paid' and x.settled_on is not null order by x.settled_on desc, x.created_at desc limit 15) e;
  else
    return conv_private.vfail('INVALID_DOMAIN', 'Essa consulta eu ainda não sei fazer.');
  end if;
  perform conv_private.audit('ai_admin_read', 'conv_ai_sessions', p_session::text, null,
    jsonb_build_object('domain', p_domain), jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'requester_profile_id', v_admin), v_admin);
  return jsonb_build_object('ok', true, 'domain', p_domain, 'data', v_out);
end $$;

create function public.conv_svc_ai_admin_read_more(p_session uuid, p_domain text, p_args jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_read_more(p_session, p_domain, coalesce(p_args, '{}'::jsonb)) $$;

revoke all on function conv_private.ai_admin_read_more(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_read_more(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_read_more(uuid, text, jsonb) to service_role;
