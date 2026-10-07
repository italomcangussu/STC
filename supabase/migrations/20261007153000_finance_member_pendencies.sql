-- Member pendencies: receivables, configurable WhatsApp collection, OCR auto-settlement and João context.
-- Idempotent so it can reconcile databases where part of the feature was applied interactively.

alter table public.fin_member_charges alter column plan_id drop not null;
alter table public.fin_member_charges
  add column if not exists charge_type text not null default 'membership',
  add column if not exists description text,
  add column if not exists pendency_kind text,
  add column if not exists category_id uuid references public.fin_categories(id),
  add column if not exists guest_name text,
  add column if not exists guest_date date,
  add column if not exists collection_enabled boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='fin_member_charges_charge_type_check') then
    alter table public.fin_member_charges add constraint fin_member_charges_charge_type_check
      check (charge_type in ('membership','member_pendency'));
  end if;
  if not exists (select 1 from pg_constraint where conname='fin_member_charges_pendency_kind_check') then
    alter table public.fin_member_charges add constraint fin_member_charges_pendency_kind_check
      check (pendency_kind is null or pendency_kind in ('day_card','consumo','evento','multa','dano_reposicao','outros'));
  end if;
  if not exists (select 1 from pg_constraint where conname='fin_member_charges_shape_check') then
    alter table public.fin_member_charges add constraint fin_member_charges_shape_check
      check (
        (charge_type='membership' and plan_id is not null)
        or
        (charge_type='member_pendency' and plan_id is null
          and description is not null and length(trim(description)) between 3 and 300
          and pendency_kind is not null and category_id is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname='fin_member_charges_guest_name_check') then
    alter table public.fin_member_charges add constraint fin_member_charges_guest_name_check
      check (guest_name is null or length(trim(guest_name)) between 2 and 120);
  end if;
end $$;

create index if not exists fin_member_pendency_profile_status_idx
  on public.fin_member_charges(profile_id,due_date,id)
  where charge_type='member_pendency' and status in ('open','partial');

alter table public.fin_settings
  add column if not exists pix_key text not null default '52.393.541/0001-20',
  add column if not exists pendency_automation_enabled boolean not null default true,
  add column if not exists pendency_reminder_days integer[] not null default array[0,3,7,14,21],
  add column if not exists pendency_grace_days smallint not null default 0,
  add column if not exists pendency_fine_fixed_cents bigint not null default 0,
  add column if not exists pendency_fine_percent_bps integer not null default 0,
  add column if not exists pendency_interest_daily_fixed_cents bigint not null default 0,
  add column if not exists pendency_interest_daily_percent_bps integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='fin_settings_pendency_grace_check') then
    alter table public.fin_settings add constraint fin_settings_pendency_grace_check check (pendency_grace_days between 0 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname='fin_settings_pendency_fine_fixed_check') then
    alter table public.fin_settings add constraint fin_settings_pendency_fine_fixed_check check (pendency_fine_fixed_cents between 0 and 100000000);
  end if;
  if not exists (select 1 from pg_constraint where conname='fin_settings_pendency_fine_pct_check') then
    alter table public.fin_settings add constraint fin_settings_pendency_fine_pct_check check (pendency_fine_percent_bps between 0 and 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname='fin_settings_pendency_interest_fixed_check') then
    alter table public.fin_settings add constraint fin_settings_pendency_interest_fixed_check check (pendency_interest_daily_fixed_cents between 0 and 100000000);
  end if;
  if not exists (select 1 from pg_constraint where conname='fin_settings_pendency_interest_pct_check') then
    alter table public.fin_settings add constraint fin_settings_pendency_interest_pct_check check (pendency_interest_daily_percent_bps between 0 and 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname='fin_settings_pendency_reminders_check') then
    alter table public.fin_settings add constraint fin_settings_pendency_reminders_check check (cardinality(pendency_reminder_days) between 1 and 20);
  end if;
end $$;

alter table public.fin_receipt_submissions
  add column if not exists source text not null default 'app',
  add column if not exists source_message_id uuid references public.conv_messages(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='fin_receipt_submissions_source_check') then
    alter table public.fin_receipt_submissions
      add constraint fin_receipt_submissions_source_check check (source in ('app','whatsapp'));
  end if;
end $$;

create unique index if not exists fin_receipt_submissions_source_message_uidx
  on public.fin_receipt_submissions(source_message_id)
  where source_message_id is not null;

update public.fin_settings
set payee_names=array['Sobral Tênis Clube'], updated_at=now()
where cardinality(payee_names)=0;

insert into public.fin_categories(parent_id,name,kind,dre_line,system_key,active,position)
select g.id,'Pendências de sócios','revenue','revenue','member_pendency',true,80
from public.fin_categories g
where g.system_key='group.revenue'
  and not exists (select 1 from public.fin_categories x where x.system_key='member_pendency');

CREATE OR REPLACE FUNCTION conv_private.ai_financial_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with
today as (
  select (now() at time zone 'America/Fortaleza')::date as d
),
students as (
  select
    ns.id, ns.name, ns.plan_type, ns.plan_status, coalesce(ns.is_active,true) record_active,
    ns.student_type, ns.master_expiration_date,
    coalesce(sp.student_status,'active') student_status,
    prof_profile.name professor_name, resp.name responsible_name,
    greatest(ns.master_expiration_date,ap.active_valid_until::date) effective_valid_until,
    ap.last_active_payment_at, ap.last_active_amount,
    lp.payment_date latest_payment_at, lp.amount latest_payment_amount, lp.status::text latest_payment_status,
    lp.cancelled_reason latest_cancelled_reason
  from public.non_socio_students ns
  left join lateral (
    select x.student_status,x.professor_id from public.student_profiles x
    where x.non_socio_student_id=ns.id order by x.updated_at desc,x.created_at desc limit 1
  ) sp on true
  left join public.professors prof on prof.id=coalesce(sp.professor_id,ns.professor_id)
  left join public.profiles prof_profile on prof_profile.id=prof.user_id
  left join public.profiles resp on resp.id=ns.responsible_socio_id
  left join lateral (
    select max(p.valid_until) filter(where p.status::text='active') active_valid_until,
      max(p.payment_date) filter(where p.status::text='active') last_active_payment_at,
      (array_agg(p.amount order by p.payment_date desc) filter(where p.status::text='active'))[1] last_active_amount
    from public.student_payments p where p.student_id=ns.id
  ) ap on true
  left join lateral (
    select p.payment_date,p.amount,p.status,p.cancelled_reason from public.student_payments p
    where p.student_id=ns.id order by p.payment_date desc,p.created_at desc limit 1
  ) lp on true
),
student_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name',s.name,'plan_type',s.plan_type,'plan_status',s.plan_status,'record_active',s.record_active,
    'student_type',s.student_type,'student_status',s.student_status,
    'card_status',case
      when not s.record_active then 'inactive'
      when s.student_status='paused' then 'paused'
      when s.student_status='ended' then 'ended'
      when coalesce(s.plan_status,'active')<>'active' then coalesce(s.plan_status,'inactive')
      when s.plan_type='Dependente' then 'active'
      when s.effective_valid_until is null then 'no_validity'
      when s.effective_valid_until>=t.d then 'active' else 'expired' end,
    'valid_until',s.effective_valid_until,
    'days_to_expiration',case when s.effective_valid_until is null then null else s.effective_valid_until-t.d end,
    'professor',s.professor_name,'responsible',s.responsible_name,
    'last_active_payment_on',s.last_active_payment_at,'last_active_payment_amount',s.last_active_amount,
    'latest_payment_on',s.latest_payment_at,'latest_payment_amount',s.latest_payment_amount,
    'latest_payment_status',s.latest_payment_status,'latest_cancelled_reason',s.latest_cancelled_reason
  ) order by s.name),'[]'::jsonb) value
  from students s cross join today t
),
day_cards as (
  select r.date occurred_on,trim(r.guest_name) guest_name,p.name booked_by,r.payment_status::text payment_status,
    case when r.payment_status::text='exempt' then 0::bigint else fs.day_card_price_cents end amount_cents
  from public.reservations r
  left join public.profiles p on p.id=r.creator_id
  cross join public.fin_settings fs cross join today t
  where r.type='Play' and nullif(trim(coalesce(r.guest_name,'')),'') is not null
    and coalesce(r.status::text,'active')<>'cancelled'
    and r.date between (t.d-90) and (t.d+60)
),
day_card_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'date',d.occurred_on,'guest_name',d.guest_name,'booked_by',d.booked_by,
    'payment_status',d.payment_status,'amount_cents',d.amount_cents
  ) order by d.occurred_on desc,d.guest_name),'[]'::jsonb) value from day_cards d
),
pendencies as (
  select c.id,c.profile_id,p.name member_name,c.description,c.pendency_kind,c.guest_name,c.guest_date,
    c.competence_month,c.due_date,c.status,c.collection_enabled,cat.name category_name,
    st.principal_paid,st.principal_remaining,st.fees_due,st.total_due,st.days_late,st.overdue,
    exists(
      select 1 from public.fin_receipt_charges rc join public.fin_receipt_submissions rs on rs.id=rc.submission_id
      where rc.charge_id=c.id and rs.status in ('submitted','in_review')
    ) in_review
  from public.fin_member_charges c
  join public.profiles p on p.id=c.profile_id
  left join public.fin_categories cat on cat.id=c.category_id
  cross join today t
  cross join lateral fin_private.charge_statement(c.id,t.d) st
  where c.charge_type='member_pendency'
    and (c.status in ('open','partial') or c.updated_at>=now()-interval '90 days')
),
pendency_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'member_id',x.profile_id,'member_name',x.member_name,'description',x.description,
    'kind',x.pendency_kind,'category',x.category_name,'guest_name',x.guest_name,'guest_date',x.guest_date,
    'competence',x.competence_month,'due_date',x.due_date,'status',x.status,'collection_enabled',x.collection_enabled,
    'principal_paid_cents',x.principal_paid,'principal_remaining_cents',x.principal_remaining,
    'fees_cents',x.fees_due,'total_due_cents',x.total_due,'days_late',x.days_late,'overdue',x.overdue,'in_review',x.in_review
  ) order by (x.status in ('open','partial')) desc,x.due_date,x.member_name),'[]'::jsonb) value
  from pendencies x
)
select jsonb_build_object(
  'as_of',to_char(now() at time zone 'America/Fortaleza','YYYY-MM-DD"T"HH24:MI'),
  'students',(select value from student_json),
  'day_cards',(select value from day_card_json),
  'member_pendencies',(select value from pendency_json),
  'day_card_price_cents',(select day_card_price_cents from public.fin_settings where id),
  'pix_key',(select pix_key from public.fin_settings where id)
)
$function$


CREATE OR REPLACE FUNCTION conv_private.aud_finance(a conv_automations, p_as_of date)
 RETURNS SETOF conv_private.audience_row
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d jsonb := a.definition; v_stage text := d->>'stage';
  v_days integer := coalesce(nullif(d->>'days','')::int, case v_stage when 'period_start' then 3 when 'before_due' then 3 else 1 end);
  v_repeat integer := greatest(coalesce(nullif(d->>'repeat_days','')::int,7),1);
  v_excl boolean := coalesce((d->>'exclude_in_review')::boolean,true);
  v_filters jsonb; v_enabled boolean; v_reminders integer[];
begin
  if v_stage='member_pendency' then
    select pendency_automation_enabled, pendency_reminder_days into v_enabled,v_reminders from public.fin_settings where id;
    if not coalesce(v_enabled,true) then return; end if;
    return query
    with trigger_profiles as (
      select distinct c.profile_id
      from public.fin_member_charges c
      cross join lateral fin_private.charge_statement(c.id,p_as_of) st
      where c.charge_type='member_pendency'
        and c.collection_enabled
        and c.status in ('open','partial')
        and st.total_due > 0
        and p_as_of >= c.due_date
        and (p_as_of-c.due_date)=any(coalesce(v_reminders,array[0,3,7,14,21]))
        and not exists (
          select 1 from public.fin_receipt_charges rc
          join public.fin_receipt_submissions rs on rs.id=rc.submission_id
          where rc.charge_id=c.id and rs.status in ('submitted','in_review')
        )
    )
    select
      'fin:member_pendency:'||tp.profile_id||':'||p_as_of::text,
      tp.profile_id,null::uuid,pr.phone::text,pr.name,
      s.subject || jsonb_build_object('scope','due'),
      coalesce(pr.is_active,true) and s.subject is not null,
      case when not coalesce(pr.is_active,true) then 'SOCIO_INATIVO'
           when s.subject is null then 'SEM_PENDENCIA_COBRAVEL' end
    from trigger_profiles tp
    join public.profiles pr on pr.id=tp.profile_id
    cross join lateral (select conv_private.member_pendency_subject(tp.profile_id,p_as_of,false) subject) s;
    return;
  end if;

  v_filters := case v_stage
    when 'period_start' then jsonb_build_object('competence_from',p_as_of-v_days,'competence_to',p_as_of)
    when 'before_due' then jsonb_build_object('due_from',p_as_of,'due_to',p_as_of+v_days)
    when 'overdue' then jsonb_build_object('due_from',p_as_of-730,'due_to',p_as_of-1)
    else jsonb_build_object('competence_from',p_as_of-730) end;

  return query
  with rows as (
    select r.* from fin_private.charge_rows(null,null,v_filters,p_as_of,5000,0) r
    join public.fin_member_charges c on c.id=r.charge_id
    where c.charge_type='membership'
      and r.stored_status in ('open','partial')
      and case v_stage
        when 'period_start' then r.competence_month<=p_as_of and p_as_of-r.competence_month<v_days
        when 'before_due' then r.due_date>=p_as_of and r.due_date-p_as_of<=v_days
        when 'overdue' then p_as_of>r.due_date and r.days_late>=v_days
        when 'in_review' then r.in_review else false end
      and (v_stage='in_review' or not r.in_review or not v_excl)
  ), agg as (
    select r.profile_id,max(r.profile_name) pname,array_agg(r.charge_id order by r.due_date,r.charge_id) ids,
      sum(r.total_due_cents) total,sum(r.principal_remaining_cents) principal,sum(r.fees_due_cents) fees,
      min(r.due_date) due,max(r.days_late) late,bool_and(r.fees_configured) fees_ok,
      array_agg(distinct r.competence_month order by r.competence_month) comps,max(r.competence_month) last_comp
    from rows r group by r.profile_id
  )
  select
    'fin:'||v_stage||':'||g.profile_id||':'||
      case v_stage when 'period_start' then to_char(g.last_comp,'YYYY-MM')
                   when 'before_due' then g.due::text
                   when 'overdue' then (g.late/v_repeat)::text
                   else md5(array_to_string(g.ids,',')) end,
    g.profile_id,null::uuid,pr.phone::text,g.pname,
    jsonb_build_object('charge_ids',to_jsonb(g.ids),'total_cents',g.total,'principal_cents',g.principal,'fees_cents',g.fees,
      'fees_configured',g.fees_ok,'due_date',g.due,'days_late',g.late,
      'competence_label',(select string_agg(conv_private.month_pt(x),' e ' order by x) from unnest(g.comps) x)),
    coalesce(pr.is_active,true),
    case when not coalesce(pr.is_active,true) then 'SOCIO_INATIVO' end
  from agg g join public.profiles pr on pr.id=g.profile_id;
end $function$


CREATE OR REPLACE FUNCTION conv_private.automation_ctx(p_source text, p_subject jsonb, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v jsonb:=jsonb_build_object('nome',conv_private.first_name(p_name),'clube','Sobral Tênis Clube'); v_days integer;
begin
  if p_source='finance_charge' then
    v:=v||jsonb_build_object(
      'competencia',p_subject->>'competence_label',
      'vencimento',case when p_subject->>'due_date' is null then null else conv_private.date_br((p_subject->>'due_date')::date) end,
      'valor',case when p_subject->>'principal_cents' is null then null else conv_private.brl((p_subject->>'principal_cents')::bigint) end,
      'total',case when p_subject->>'total_cents' is null then null else conv_private.brl((p_subject->>'total_cents')::bigint) end,
      'dias_atraso',nullif(p_subject->>'days_late','0'),
      'encargos',case when coalesce((p_subject->>'fees_configured')::boolean,false) then conv_private.brl(coalesce((p_subject->>'fees_cents')::bigint,0)) end,
      'itens',p_subject->>'items_text',
      'qtd',p_subject->>'item_count',
      'pix',p_subject->>'pix_key',
      'pago',case when p_subject->>'paid_cents' is null then null else conv_private.brl((p_subject->>'paid_cents')::bigint) end,
      'saldo',case when p_subject->>'balance_cents' is null then null else conv_private.brl((p_subject->>'balance_cents')::bigint) end
    );
  elsif p_source='card_mensal' then
    v_days:=((p_subject->>'expiration')::date-conv_private.today());
    v:=v||jsonb_build_object('vencimento',conv_private.date_br((p_subject->>'expiration')::date),
      'dias_para_vencer',case when v_days>=0 then v_days::text end,
      'dias_vencido',case when v_days<0 then (-v_days)::text end);
  elsif p_source='championship_notice' then
    v:=v||jsonb_build_object('campeonato',p_subject->>'championship','classe',p_subject->>'class');
  elsif p_source='championship_result' then
    v:=v||jsonb_build_object('campeonato',p_subject->>'championship','fase',p_subject->>'phase',
      'adversario',p_subject->>'opponent','placar',p_subject->>'score','resultado',p_subject->>'outcome');
  elsif p_source='championship_advance' then
    v:=v||jsonb_build_object('campeonato',p_subject->>'championship','fase',p_subject->>'phase',
      'adversario',coalesce(p_subject->>'opponent','a definir'));
  end if;
  return v;
end $function$


CREATE OR REPLACE FUNCTION conv_private.automation_revalidate(a conv_automations, r conv_automation_recipients)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d jsonb:=a.definition; v_stage text:=d->>'stage'; v_ids uuid[]; v_subject jsonb; v_row record; v_as_of date:=conv_private.today();
  v_total bigint:=0; v_principal bigint:=0; v_fees bigint:=0; v_due date; v_late integer:=0; v_fees_ok boolean:=true; v_comps date[];
  v_repeat integer; v_c record; v_ok boolean; s record; v_include_future boolean; v_rs text;
begin
  if a.source='finance_charge' and v_stage='member_pendency_receipt_review' then
    select status into v_rs from public.fin_receipt_submissions where id=(r.subject->>'submission_id')::uuid;
    if v_rs not in ('submitted','in_review') then
      return jsonb_build_object('ok',false,'reason','COMPROVANTE_JA_RESOLVIDO');
    end if;
    return jsonb_build_object('ok',true,'subject',r.subject);
  elsif a.source='finance_charge' and v_stage='member_pendency_paid' then
    v_subject:=conv_private.pendency_paid_subject((r.subject->>'submission_id')::uuid);
    if v_subject is null then return jsonb_build_object('ok',false,'reason','PAGAMENTO_NAO_CONFIRMADO'); end if;
    return jsonb_build_object('ok',true,'subject',v_subject);
  elsif a.source='finance_charge' and v_stage='member_pendency' then
    if not coalesce((select pendency_automation_enabled from public.fin_settings where id),true)
       and coalesce(r.subject->>'scope','')<>'manual' then
      return jsonb_build_object('ok',false,'reason','COBRANCA_AUTOMATICA_DESATIVADA');
    end if;
    v_include_future:=coalesce(r.subject->>'scope','')='manual';
    v_subject:=conv_private.member_pendency_subject(r.profile_id,v_as_of,v_include_future);
    if v_subject is null then return jsonb_build_object('ok',false,'reason','PENDENCIA_QUITADA_OU_EM_ANALISE'); end if;
    return jsonb_build_object('ok',true,'subject',v_subject||jsonb_build_object('scope',coalesce(r.subject->>'scope','due')));
  elsif a.source='finance_charge' then
    select coalesce(array_agg(x::uuid),'{}') into v_ids from jsonb_array_elements_text(r.subject->'charge_ids') x;
    v_repeat:=greatest(coalesce(nullif(d->>'repeat_days','')::int,7),1);
    for v_c in select * from fin_private.charge_rows(r.profile_id,v_ids,'{}'::jsonb,v_as_of,100,0) loop
      v_ok:=v_c.stored_status in ('open','partial') and case v_stage
        when 'period_start' then v_c.competence_month<=v_as_of
        when 'before_due' then v_c.due_date>=v_as_of
        when 'overdue' then v_as_of>v_c.due_date
        when 'in_review' then v_c.in_review else false end
        and (v_stage='in_review' or not v_c.in_review or not coalesce((d->>'exclude_in_review')::boolean,true));
      continue when not v_ok;
      v_total:=v_total+v_c.total_due_cents; v_principal:=v_principal+v_c.principal_remaining_cents; v_fees:=v_fees+v_c.fees_due_cents;
      v_due:=least(coalesce(v_due,v_c.due_date),v_c.due_date); v_late:=greatest(v_late,v_c.days_late);
      v_fees_ok:=v_fees_ok and v_c.fees_configured; v_comps:=array_append(coalesce(v_comps,'{}'),v_c.competence_month);
    end loop;
    if v_comps is null then return jsonb_build_object('ok',false,'reason','COBRANCA_NAO_PENDENTE'); end if;
    v_subject:=jsonb_build_object('total_cents',v_total,'principal_cents',v_principal,'fees_cents',v_fees,'fees_configured',v_fees_ok,
      'due_date',v_due,'days_late',v_late,
      'competence_label',(select string_agg(conv_private.month_pt(x),' e ' order by x) from (select distinct unnest(v_comps) x) q));
  elsif a.source='card_mensal' then
    select s2.* into s from public.non_socio_students s2 where s2.id=r.student_id;
    if not found or s.plan_type<>'Card Mensal' or coalesce(s.plan_status,'inactive')<>'active' or not coalesce(s.is_active,true) then
      return jsonb_build_object('ok',false,'reason','CARD_INATIVO_OU_CANCELADO');
    end if;
    if s.master_expiration_date is distinct from (r.subject->>'expiration')::date then return jsonb_build_object('ok',false,'reason','CARD_RENOVADO_OU_ALTERADO'); end if;
    if exists(select 1 from public.student_profiles sp where sp.non_socio_student_id=s.id and sp.student_status<>'active') then
      return jsonb_build_object('ok',false,'reason','ALUNO_PAUSADO_OU_ENCERRADO');
    end if;
    v_subject:=r.subject;
  elsif a.source in ('championship_result','championship_advance') then
    select x.* into v_row from conv_private.audience(a,v_as_of,null) x where x.dedupe_key=r.dedupe_key;
    if not found or not v_row.included then return jsonb_build_object('ok',false,'reason',coalesce(v_row.reason,'EVENTO_NAO_CONFIRMADO_AGORA')); end if;
    if a.source='championship_result' and (v_row.subject->>'winner_ref') is distinct from (r.subject->>'winner_ref') then
      return jsonb_build_object('ok',false,'reason','RESULTADO_ALTERADO');
    end if;
    v_subject:=v_row.subject;
  else
    select x.* into v_row from conv_private.audience(a,v_as_of,split_part(r.dedupe_key,':',2)) x where x.dedupe_key=r.dedupe_key;
    if not found or not v_row.included then return jsonb_build_object('ok',false,'reason',coalesce(v_row.reason,'FORA_DO_PUBLICO')); end if;
    v_subject:=coalesce(v_row.subject,r.subject);
  end if;
  return jsonb_build_object('ok',true,'subject',v_subject);
end $function$


CREATE OR REPLACE FUNCTION conv_private.automation_vars(p_source text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_source
    when 'finance_charge' then array['nome','clube','competencia','vencimento','valor','total','dias_atraso','encargos','itens','qtd','pix','pago','saldo']
    when 'card_mensal' then array['nome','clube','vencimento','dias_para_vencer','dias_vencido']
    when 'championship_notice' then array['nome','clube','campeonato','classe']
    when 'championship_result' then array['nome','clube','campeonato','fase','adversario','placar','resultado']
    when 'championship_advance' then array['nome','clube','campeonato','fase','adversario']
    when 'audience' then array['nome','clube']
    else array[]::text[] end
$function$


CREATE OR REPLACE FUNCTION conv_private.member_pendency_subject(p_profile uuid, p_as_of date, p_include_future boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with rows as (
  select r.*, c.description, c.pendency_kind, c.guest_name, c.guest_date
  from fin_private.charge_rows(p_profile, null, '{}'::jsonb, p_as_of, 1000, 0) r
  join public.fin_member_charges c on c.id=r.charge_id
  where c.charge_type='member_pendency'
    and c.collection_enabled
    and r.stored_status in ('open','partial')
    and not r.in_review
    and (p_include_future or r.due_date <= p_as_of)
    and r.total_due_cents > 0
), agg as (
  select
    array_agg(charge_id order by (due_date >= p_as_of), due_date, charge_id) ids,
    sum(total_due_cents)::bigint total,
    sum(principal_remaining_cents)::bigint principal,
    sum(fees_due_cents)::bigint fees,
    min(due_date) due,
    max(days_late) late,
    bool_and(fees_configured) fees_ok,
    string_agg(
      '• ' || description
      || case when guest_name is not null then ' — ' || guest_name else '' end
      || case when guest_date is not null then ' (' || conv_private.date_br(guest_date) || ')' else '' end
      || ' — ' || conv_private.brl(total_due_cents)
      || ' — vence ' || conv_private.date_br(due_date),
      E'\n' order by (due_date >= p_as_of), due_date, charge_id
    ) items,
    count(*)::integer qty,
    array_agg(distinct competence_month order by competence_month) comps
  from rows
)
select case when coalesce(a.qty,0)=0 then null else
  jsonb_build_object(
    'charge_ids',to_jsonb(a.ids),
    'total_cents',a.total,
    'principal_cents',a.principal,
    'fees_cents',a.fees,
    'fees_configured',a.fees_ok,
    'due_date',a.due,
    'days_late',a.late,
    'competence_label',(select string_agg(conv_private.month_pt(x),' e ' order by x) from unnest(a.comps) x),
    'items_text',a.items,
    'item_count',a.qty,
    'pix_key',(select pix_key from public.fin_settings where id),
    'include_future',p_include_future
  ) end
from agg a
$function$


CREATE OR REPLACE FUNCTION conv_private.pendency_paid_subject(p_submission uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with s as (
  select r.id,r.profile_id,r.status,
    coalesce((select sum(p.amount_cents) from public.fin_charge_payments p where p.submission_id=r.id and p.kind='payment'),0)::bigint paid
  from public.fin_receipt_submissions r where r.id=p_submission
), bal as (
  select coalesce(sum(st.total_due),0)::bigint balance
  from s
  join public.fin_member_charges c on c.profile_id=s.profile_id and c.charge_type='member_pendency' and c.status in ('open','partial')
  cross join lateral fin_private.charge_statement(c.id,fin_private.today()) st
  where c.collection_enabled
)
select case when s.status<>'approved' then null else jsonb_build_object(
  'submission_id',s.id,'paid_cents',s.paid,'balance_cents',bal.balance
) end
from s cross join bal
$function$


CREATE OR REPLACE FUNCTION conv_private.queue_member_pendency_now(p_profile uuid, p_charge uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.conv_automations%rowtype; v_run uuid; v_rec uuid; v_subject jsonb; v_name text; v_phone text;
begin
  select * into a from public.conv_automations
  where source='finance_charge' and definition->>'stage'='member_pendency' and status='active'
  order by created_at limit 1;
  if not found then return null; end if;

  v_subject:=conv_private.member_pendency_subject(p_profile,conv_private.today(),true);
  if v_subject is null then return null; end if;
  select name,phone::text into v_name,v_phone from public.profiles where id=p_profile;
  if v_name is null then return null; end if;

  insert into public.conv_automation_runs(automation_id,version,kind,planned_for,status,created_at)
  values(a.id,a.version,'manual',now(),'running',now()) returning id into v_run;

  insert into public.conv_automation_recipients(
    run_id,automation_id,purpose_key,dedupe_key,profile_id,phone,display_name,subject,status,due_at
  ) values(
    v_run,a.id,conv_private.automation_purpose(a),
    'fin:member_pendency:manual:'||v_run::text,
    p_profile,conv_private.phone_e164(v_phone),v_name,
    v_subject||jsonb_build_object('scope','manual'),'pending',now()
  )
  on conflict (purpose_key,dedupe_key) where status<>'canceled' do nothing
  returning id into v_rec;

  if v_rec is null then
    update public.conv_automation_runs set status='done',finished_at=now() where id=v_run;
  end if;
  return v_rec;
end $function$


CREATE OR REPLACE FUNCTION conv_private.queue_pendency_paid_notice(p_profile uuid, p_submission uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.conv_automations%rowtype; v_run uuid; v_rec uuid; v_subject jsonb; v_name text; v_phone text;
begin
  select * into a from public.conv_automations
  where source='finance_charge' and definition->>'stage'='member_pendency_paid' and status='active'
  order by created_at limit 1;
  if not found then return null; end if;
  v_subject:=conv_private.pendency_paid_subject(p_submission);
  if v_subject is null then return null; end if;
  select name,phone::text into v_name,v_phone from public.profiles where id=p_profile;
  if v_name is null then return null; end if;

  insert into public.conv_automation_runs(automation_id,version,kind,planned_for,status,created_at)
  values(a.id,a.version,'manual',now(),'running',now()) returning id into v_run;

  insert into public.conv_automation_recipients(
    run_id,automation_id,purpose_key,dedupe_key,profile_id,phone,display_name,subject,status,due_at
  ) values(
    v_run,a.id,conv_private.automation_purpose(a),
    'fin:member_pendency:paid:'||p_submission::text,
    p_profile,conv_private.phone_e164(v_phone),v_name,v_subject,'pending',now()
  )
  on conflict (purpose_key,dedupe_key) where status<>'canceled' do nothing
  returning id into v_rec;

  if v_rec is null then update public.conv_automation_runs set status='done',finished_at=now() where id=v_run; end if;
  return v_rec;
end $function$


CREATE OR REPLACE FUNCTION conv_private.queue_pendency_receipt_review_notice(p_profile uuid, p_submission uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.conv_automations%rowtype; v_run uuid; v_rec uuid; v_name text; v_phone text;
begin
  select * into a from public.conv_automations
  where source='finance_charge' and definition->>'stage'='member_pendency_receipt_review' and status='active'
  order by created_at limit 1;
  if not found then return null; end if;
  select name,phone::text into v_name,v_phone from public.profiles where id=p_profile;
  if v_name is null then return null; end if;

  insert into public.conv_automation_runs(automation_id,version,kind,planned_for,status,created_at)
  values(a.id,a.version,'manual',now(),'running',now()) returning id into v_run;

  insert into public.conv_automation_recipients(
    run_id,automation_id,purpose_key,dedupe_key,profile_id,phone,display_name,subject,status,due_at
  ) values(
    v_run,a.id,conv_private.automation_purpose(a),
    'fin:member_pendency:receipt_review:'||p_submission::text,
    p_profile,conv_private.phone_e164(v_phone),v_name,
    jsonb_build_object('submission_id',p_submission),'pending',now()
  )
  on conflict (purpose_key,dedupe_key) where status<>'canceled' do nothing
  returning id into v_rec;

  if v_rec is null then update public.conv_automation_runs set status='done',finished_at=now() where id=v_run; end if;
  return v_rec;
end $function$


CREATE OR REPLACE FUNCTION fin_private.auto_approve_pendency_receipt(p_submission uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.fin_receipt_submissions%rowtype; fs public.fin_settings%rowtype; v_ids uuid[]; v_count integer; v_pend_count integer;
  v_amount bigint; v_paid_on date; v_ocr_amount bigint; v_ocr_date date; v_payee text; v_payee_ok boolean:=false;
  v_conf_amount text; v_conf_date text; v_conf_payee text; v_identifier text; v_account uuid;
  v_remaining bigint; v_alloc bigint; r record; v_res jsonb; v_pay_ids uuid[]:='{}'; 
  v_duplicate boolean; v_norm_payee text; v_expected text; v_total_paid bigint:=0;
begin
  select * into s from public.fin_receipt_submissions where id=p_submission for update;
  if not found then return jsonb_build_object('approved',false,'reason','RECEIPT_NOT_FOUND'); end if;
  if s.status not in ('submitted','in_review') then return jsonb_build_object('approved',false,'reason','RECEIPT_NOT_PENDING'); end if;
  if s.ocr_status<>'ok' or s.ocr is null then return jsonb_build_object('approved',false,'reason','OCR_NOT_OK'); end if;
  if s.possible_duplicate then return jsonb_build_object('approved',false,'reason','POSSIBLE_DUPLICATE'); end if;

  v_amount:=s.declared_amount_cents; v_paid_on:=s.declared_paid_on;
  v_ocr_amount:=nullif(s.ocr->>'amount_cents','')::bigint;
  v_ocr_date:=nullif(s.ocr->>'paid_on','')::date;
  v_conf_amount:=s.ocr->'confidence'->>'amount';
  v_conf_date:=s.ocr->'confidence'->>'date';
  v_conf_payee:=s.ocr->'confidence'->>'payee';
  v_payee:=nullif(trim(s.ocr->>'payee'),'');
  v_identifier:=nullif(trim(s.ocr->>'identifier'),'');

  if v_amount is null or v_paid_on is null or v_ocr_amount is null or v_ocr_date is null then
    return jsonb_build_object('approved',false,'reason','FIELDS_MISSING');
  end if;
  if v_paid_on>fin_private.today() then return jsonb_build_object('approved',false,'reason','DATE_FUTURE'); end if;
  if v_conf_amount<>'high' or v_conf_date<>'high' then return jsonb_build_object('approved',false,'reason','LOW_CONFIDENCE'); end if;
  if v_amount<>v_ocr_amount then return jsonb_build_object('approved',false,'reason','AMOUNT_MISMATCH'); end if;
  if v_paid_on<>v_ocr_date then return jsonb_build_object('approved',false,'reason','DATE_MISMATCH'); end if;

  select * into fs from public.fin_settings where id;
  if cardinality(fs.payee_names)>0 then
    if v_payee is null or v_conf_payee<>'high' then return jsonb_build_object('approved',false,'reason','PAYEE_NOT_CONFIRMED'); end if;
    v_norm_payee:=fin_private.fold_text(v_payee);
    foreach v_expected in array fs.payee_names loop
      if v_norm_payee like '%'||fin_private.fold_text(v_expected)||'%'
         or fin_private.fold_text(v_expected) like '%'||v_norm_payee||'%' then
        v_payee_ok:=true; exit;
      end if;
    end loop;
    if not v_payee_ok then return jsonb_build_object('approved',false,'reason','PAYEE_MISMATCH'); end if;
  end if;

  select coalesce(array_agg(rc.charge_id),'{}'),count(*)
    into v_ids,v_count from public.fin_receipt_charges rc where rc.submission_id=p_submission;
  if v_count=0 then return jsonb_build_object('approved',false,'reason','NO_CHARGES_SELECTED'); end if;

  select count(*) into v_pend_count
  from public.fin_member_charges c
  where c.id=any(v_ids) and c.profile_id=s.profile_id and c.charge_type='member_pendency'
    and c.status in ('open','partial');
  if v_pend_count<>v_count then return jsonb_build_object('approved',false,'reason','NOT_ONLY_OPEN_PENDENCIES'); end if;

  select exists(
    select 1 from public.fin_receipt_submissions o
    where o.id<>s.id and o.profile_id=s.profile_id and o.status in ('submitted','in_review','approved')
      and (
        (v_identifier is not null and nullif(trim(o.ocr->>'identifier'),'')=v_identifier)
        or (o.declared_amount_cents=v_amount and o.declared_paid_on=v_paid_on)
      )
  ) into v_duplicate;
  if v_duplicate then return jsonb_build_object('approved',false,'reason','DUPLICATE_FIELDS'); end if;

  select id into v_account from public.fin_accounts where is_default_receipts and active order by position,id limit 1;
  if v_account is null then return jsonb_build_object('approved',false,'reason','DEFAULT_ACCOUNT_MISSING'); end if;

  v_remaining:=v_amount;
  for r in
    select z.*
    from (
      select cr.*,
        row_number() over(order by (cr.due_date>=v_paid_on),cr.due_date,cr.charge_id) rn,
        count(*) over() n
      from fin_private.charge_rows(s.profile_id,v_ids,'{}'::jsonb,v_paid_on,1000,0) cr
      join public.fin_member_charges c on c.id=cr.charge_id
      where c.charge_type='member_pendency' and cr.stored_status in ('open','partial') and cr.total_due_cents>0
    ) z
    order by z.rn
  loop
    exit when v_remaining<=0;
    v_alloc:=case when r.rn=r.n then v_remaining else least(v_remaining,r.total_due_cents) end;
    v_res:=fin_private.apply_payment(r.charge_id,v_alloc,v_paid_on,'pix',v_account,p_submission,null,
      'Baixa automática por comprovante OCR',gen_random_uuid());
    v_pay_ids:=v_pay_ids||(v_res->>'payment_id')::uuid;
    v_total_paid:=v_total_paid+v_alloc;
    v_remaining:=v_remaining-v_alloc;
  end loop;

  if cardinality(v_pay_ids)=0 then return jsonb_build_object('approved',false,'reason','NO_OPEN_BALANCE'); end if;

  update public.fin_receipt_submissions
  set status='approved',reviewed_by=null,reviewed_at=now(),
      decision_reason='Baixa automática: OCR com alta confiança e dados conferidos',
      approved_payment_ids=v_pay_ids,version=version+1,updated_at=now()
  where id=p_submission;

  return jsonb_build_object('approved',true,'status','approved','payment_ids',to_jsonb(v_pay_ids),'total_cents',v_total_paid);
end $function$


CREATE OR REPLACE FUNCTION fin_private.cash_rows(p_from date, p_to date)
 RETURNS TABLE(source_type text, source_id text, leg text, occurred_on date, flow text, description text, category_id uuid, account_id uuid, amount_cents bigint, is_transfer boolean, origin text, profile_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.fin_settings%rowtype; v_default uuid;
begin
  select * into s from public.fin_settings;
  select id into v_default from public.fin_accounts where is_default_receipts and active limit 1;
  return query
  with u as (
    -- Mensalidade: principal / encargos / excedente, no dia do pagamento, na conta escolhida.
    -- Pagamento por crédito do sócio NÃO é entrada de dinheiro (o dinheiro entrou antes).
    select 'member_payment'::text st, p.id::text sid, 'principal'::text leg, p.paid_on d, 'receipt'::text flow,
      case when c.charge_type='member_pendency' then c.description else 'Mensalidade' end::text descr,
      coalesce(c.category_id, fin_private.category_id('member_fees')) cat,
      p.account_id acct, p.principal_cents amt, false tr, 'auto'::text org, c.profile_id prof
    from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
    where p.kind = 'payment' and p.method <> 'credit' and p.principal_cents > 0 and p.paid_on between p_from and p_to
    union all
    select 'member_payment', p.id::text, 'fees', p.paid_on, 'fee', 'Multa e juros de mora', fin_private.category_id('late_fees'), p.account_id,
      (p.fine_cents + p.interest_cents), false, 'auto', c.profile_id
    from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
    where p.kind = 'payment' and p.method <> 'credit' and p.fine_cents + p.interest_cents > 0 and p.paid_on between p_from and p_to
    union all
    select 'member_payment', p.id::text, 'excess', p.paid_on, 'credit', 'Crédito do sócio (excedente/duplicado)', null::uuid, p.account_id,
      p.excess_cents, false, 'auto', c.profile_id
    from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
    where p.kind = 'payment' and p.method <> 'credit' and p.excess_cents > 0 and p.paid_on between p_from and p_to
    union all
    -- Estorno de pagamento: sai o mesmo dinheiro, no dia do estorno.
    select 'member_reversal', p.id::text, 'reversal', p.paid_on, 'refund',
      case when c.charge_type='member_pendency' then 'Estorno — '||c.description else 'Estorno de pagamento de mensalidade' end,
      fin_private.category_id('refunds'),
      p.account_id, -(p.principal_cents + p.fine_cents + p.interest_cents + p.excess_cents), false, 'auto', c.profile_id
    from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
    where p.kind = 'reversal' and p.method <> 'credit' and p.paid_on between p_from and p_to
    union all
    -- Card Mensal / Aula avulsa dos alunos (student_payments ativos) — conta padrão de recebimentos.
    select 'student_payment', sp.id::text, 'main', (sp.payment_date at time zone 'America/Fortaleza')::date, 'receipt',
      case when (sp.valid_until at time zone 'America/Fortaleza')::date > (sp.payment_date at time zone 'America/Fortaleza')::date then 'Card Mensal' else 'Aula avulsa' end
        || ' — ' || coalesce(st.name, 'aluno'),
      fin_private.category_id(case when (sp.valid_until at time zone 'America/Fortaleza')::date > (sp.payment_date at time zone 'America/Fortaleza')::date then 'card_mensal' else 'aula_avulsa' end),
      v_default, round(sp.amount * 100)::bigint, false, 'auto', null::uuid
    from public.student_payments sp left join public.non_socio_students st on st.id = sp.student_id
    where sp.status = 'active' and (sp.payment_date at time zone 'America/Fortaleza')::date between p_from and p_to
    union all
    -- Day Card do convidado (derivado da reserva): só entra no caixa se o clube disser que recebe na hora (padrão: não).
    select 'day_card', d.reservation_id::text, 'main', d.occurred_on, 'day_card',
      'Day Card — ' || d.guest_name, fin_private.category_id('day_card'), v_default, d.charged_cents, false, 'derived', null::uuid
    from fin_private.day_card_rows(p_from, p_to) d where s.day_card_in_cash and d.charged_cents > 0
    union all
    -- Lançamentos (pagamentos/recebimentos de contas, aportes, retiradas, devoluções).
    select 'entry_payment', x.id::text, case when e.kind = 'transfer' then 'out' else 'main' end, x.paid_on,
      case e.kind when 'expense' then 'expense' when 'revenue' then 'revenue' when 'contribution' then 'contribution'
        when 'withdrawal' then 'withdrawal' when 'transfer' then 'transfer' else 'member_refund' end,
      e.description, e.category_id, x.account_id,
      (case when e.kind in ('expense', 'withdrawal', 'transfer', 'member_refund') then -1 else 1 end * case when x.kind = 'payment' then 1 else -1 end * x.amount_cents)::bigint,
      e.kind = 'transfer', 'manual', null::uuid
    from public.fin_entry_payments x join public.fin_entries e on e.id = x.entry_id where x.paid_on between p_from and p_to
    union all
    select 'entry_payment', x.id::text, 'in', x.paid_on, 'transfer', e.description, null::uuid, e.counter_account_id,
      (case when x.kind = 'payment' then 1 else -1 end * x.amount_cents)::bigint, true, 'manual', null::uuid
    from public.fin_entry_payments x join public.fin_entries e on e.id = x.entry_id
    where e.kind = 'transfer' and x.paid_on between p_from and p_to
    union all
    select 'opening', a.id::text, 'main', a.opening_date, 'opening', 'Saldo inicial — ' || a.name, null::uuid, a.id, a.opening_balance_cents,
      false, 'manual', null::uuid
    from public.fin_accounts a where a.opening_balance_cents <> 0 and a.opening_date between p_from and p_to
  )
  -- Antes da data de saldo inicial de uma conta o movimento já está dentro do saldo informado.
  select u.st, u.sid, u.leg, u.d, u.flow, u.descr, u.cat, u.acct, u.amt, u.tr, u.org, u.prof
  from u left join public.fin_accounts a on a.id = u.acct
  where a.id is null or u.d >= a.opening_date;
end $function$


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
    where (p_profile is null or c.profile_id = p_profile)
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
end $function$


CREATE OR REPLACE FUNCTION fin_private.charge_statement(p_charge uuid, p_as_of date)
 RETURNS TABLE(principal_base bigint, principal_paid bigint, principal_remaining bigint, grace_until date, days_late integer, fine_accrued bigint, interest_accrued bigint, fees_paid bigint, fees_waived bigint, fine_due bigint, interest_due bigint, fees_due bigint, total_due bigint, fees_configured boolean, overdue boolean, settled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.fin_member_charges%rowtype; s public.fin_settings%rowtype;
  v_disc bigint; v_inc bigint; v_waived bigint; v_base bigint; v_paid bigint; v_feespaid bigint;
  v_grace date; v_days integer; v_fine bigint := 0; v_int bigint := 0; v_first date; v_cursor date; v_b bigint; v_seg integer;
  pd date[]; pp bigint[]; i integer; n integer; v_red bigint; v_fine_due bigint; v_int_due bigint; v_principal_rem bigint;
  v_fee_configured boolean; v_grace_days integer; v_fine_fixed bigint; v_fine_bps integer; v_int_fixed bigint; v_int_bps integer;
begin
  select * into c from public.fin_member_charges where id = p_charge;
  if not found then raise exception 'CHARGE_NOT_FOUND'; end if;
  select * into s from public.fin_settings;

  if c.charge_type = 'member_pendency' then
    v_fee_configured := true;
    v_grace_days := greatest(s.pendency_grace_days, 0);
    v_fine_fixed := coalesce(s.pendency_fine_fixed_cents, 0);
    v_fine_bps := coalesce(s.pendency_fine_percent_bps, 0);
    v_int_fixed := coalesce(s.pendency_interest_daily_fixed_cents, 0);
    v_int_bps := coalesce(s.pendency_interest_daily_percent_bps, 0);
  else
    v_fee_configured := s.late_fee_confirmed_at is not null;
    v_grace_days := greatest(s.grace_days, 0);
    v_fine_fixed := coalesce(s.fine_fixed_cents, 0);
    v_fine_bps := coalesce(s.fine_percent_bps, 0);
    v_int_fixed := coalesce(s.interest_daily_fixed_cents, 0);
    v_int_bps := coalesce(s.interest_daily_percent_bps, 0);
  end if;

  select coalesce(sum(amount_cents) filter (where kind = 'discount'), 0),
         coalesce(sum(amount_cents) filter (where kind = 'increase'), 0),
         coalesce(sum(amount_cents) filter (where kind = 'fee_waiver'), 0)
    into v_disc, v_inc, v_waived
  from public.fin_charge_adjustments where charge_id = p_charge;

  select coalesce(array_agg(paid_on order by paid_on, created_at, id), '{}'),
         coalesce(array_agg(principal_cents order by paid_on, created_at, id), '{}'),
         coalesce(sum(principal_cents), 0),
         coalesce(sum(fine_cents + interest_cents), 0)
    into pd, pp, v_paid, v_feespaid
  from fin_private.charge_payments_effective
  where charge_id = p_charge and paid_on <= p_as_of;

  v_base := greatest(c.original_amount_cents - v_disc + v_inc, 0);
  v_principal_rem := case when c.status = 'canceled' then 0 else greatest(v_base - v_paid, 0) end;
  v_grace := c.due_date + v_grace_days;
  v_days := greatest(p_as_of - v_grace, 0);
  n := coalesce(array_length(pd, 1), 0);

  if v_fee_configured and c.status <> 'canceled' and v_days > 0 then
    v_first := v_grace + 1;
    v_b := v_base;
    for i in 1..n loop if pd[i] < v_first then v_b := v_b - pp[i]; end if; end loop;
    v_b := greatest(v_b, 0);
    if v_b > 0 then
      v_fine := v_fine_fixed + round(v_b::numeric * v_fine_bps / 10000)::bigint;
    end if;
    v_cursor := v_first;
    for i in 1..n loop
      if pd[i] >= v_first and pd[i] < p_as_of then
        v_seg := pd[i] - v_cursor + 1;
        if v_seg > 0 and v_b > 0 then
          v_int := v_int + v_int_fixed * v_seg
            + round(v_b::numeric * v_seg * v_int_bps / 10000)::bigint;
        end if;
        v_b := greatest(v_b - pp[i], 0);
        v_cursor := pd[i] + 1;
      end if;
    end loop;
    v_seg := p_as_of - v_cursor + 1;
    if v_seg > 0 and v_b > 0 then
      v_int := v_int + v_int_fixed * v_seg
        + round(v_b::numeric * v_seg * v_int_bps / 10000)::bigint;
    end if;
  end if;

  v_red := v_feespaid + v_waived;
  v_fine_due := greatest(v_fine - v_red, 0);
  v_int_due := greatest(v_fine + v_int - v_red - v_fine_due, 0);

  return query select v_base, v_paid, v_principal_rem, v_grace, v_days, v_fine, v_int, v_feespaid, v_waived,
    v_fine_due, v_int_due, v_fine_due + v_int_due, v_principal_rem + v_fine_due + v_int_due,
    v_fee_configured,
    (c.status <> 'canceled' and v_principal_rem + v_fine_due + v_int_due > 0 and p_as_of > c.due_date),
    (c.status = 'canceled' or v_principal_rem + v_fine_due + v_int_due = 0);
end $function$


CREATE OR REPLACE FUNCTION fin_private.dre_rows(p_from date, p_to date)
 RETURNS TABLE(category_id uuid, amount_cents bigint, source_type text, source_id text, occurred_on date, description text, profile_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.fin_settings%rowtype;
begin
  select * into s from public.fin_settings;
  return query
  -- 1. Mensalidades de sócios: o valor do período é rateado nos meses de competência
  --    (resto dos centavos no primeiro mês); entra o mês cujo dia 1 está no período.
  with m as (
    select c.id, c.profile_id, c.period_months n, c.original_amount_cents o, gs.i,
      (c.competence_month + make_interval(months => gs.i))::date as month_start
    from public.fin_member_charges c cross join lateral generate_series(0, c.period_months - 1) as gs(i)
    where c.status <> 'canceled' and c.charge_type = 'membership'
  ), adj as (
    select a.charge_id,
      coalesce(sum(a.amount_cents) filter (where a.kind = 'discount'), 0)::bigint disc,
      coalesce(sum(a.amount_cents) filter (where a.kind = 'increase'), 0)::bigint inc
    from public.fin_charge_adjustments a group by a.charge_id
  )
  select fin_private.category_id('member_fees'),
    (((m.o + coalesce(adj.inc, 0)) / m.n) + case when m.i = 0 then (m.o + coalesce(adj.inc, 0)) - ((m.o + coalesce(adj.inc, 0)) / m.n) * m.n else 0 end)::bigint,
    'member_charge', m.id::text, m.month_start, 'Mensalidade ' || to_char(m.month_start, 'MM/YYYY'), m.profile_id
  from m left join adj on adj.charge_id = m.id where m.month_start between p_from and p_to
  union all
  select fin_private.category_id('discounts'),
    -(((coalesce(adj.disc, 0)) / m.n) + case when m.i = 0 then coalesce(adj.disc, 0) - (coalesce(adj.disc, 0) / m.n) * m.n else 0 end)::bigint,
    'member_discount', m.id::text, m.month_start, 'Desconto na mensalidade ' || to_char(m.month_start, 'MM/YYYY'), m.profile_id
  from m join adj on adj.charge_id = m.id where adj.disc > 0 and m.month_start between p_from and p_to
  union all
  -- Pendências manuais do sócio entram na competência escolhida e na categoria de receita escolhida.
  select c.category_id, (c.original_amount_cents + coalesce(adj.inc,0))::bigint,
    'member_pendency', c.id::text, c.competence_month, c.description, c.profile_id
  from public.fin_member_charges c
  left join adj on adj.charge_id=c.id
  where c.charge_type='member_pendency' and c.status<>'canceled'
    and c.competence_month between p_from and p_to
  union all
  select fin_private.category_id('discounts'), -coalesce(adj.disc,0)::bigint,
    'member_pendency_discount', c.id::text, c.competence_month, 'Desconto — '||c.description, c.profile_id
  from public.fin_member_charges c
  join adj on adj.charge_id=c.id
  where c.charge_type='member_pendency' and c.status<>'canceled' and adj.disc>0
    and c.competence_month between p_from and p_to
  union all
  -- 2. Multas e juros recebidos: reconhecidos no dia do pagamento; o estorno devolve na data do estorno.
  select fin_private.category_id('late_fees'), (p.fine_cents + p.interest_cents)::bigint, 'member_fee_payment', p.id::text, p.paid_on,
    'Multa e juros de mora', c.profile_id
  from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
  where p.kind = 'payment' and p.fine_cents + p.interest_cents > 0 and p.paid_on between p_from and p_to
  union all
  select fin_private.category_id('refunds'), -(p.fine_cents + p.interest_cents)::bigint, 'member_fee_reversal', p.id::text, p.paid_on,
    'Estorno de multa e juros', c.profile_id
  from public.fin_charge_payments p join public.fin_member_charges c on c.id = p.charge_id
  where p.kind = 'reversal' and p.fine_cents + p.interest_cents > 0 and p.paid_on between p_from and p_to
  union all
  -- 3. Card Mensal e Aula avulsa dos alunos não-sócios: o que foi PAGO e registrado em `student_payments`
  --    (ATIVOS, pela data do pagamento). Validade além do dia = Card Mensal; no próprio dia = Aula avulsa
  --    (no app, o plano "Day Card" do aluno). Cancelados/estornados não são receita. A aula em si não gera
  --    receita derivada: o dinheiro já está no pagamento (ou coberto pelo Card Mensal).
  select fin_private.category_id(case when (sp.valid_until at time zone 'America/Fortaleza')::date > (sp.payment_date at time zone 'America/Fortaleza')::date
      then 'card_mensal' else 'aula_avulsa' end),
    round(sp.amount * 100)::bigint, 'student_payment', sp.id::text, (sp.payment_date at time zone 'America/Fortaleza')::date,
    case when (sp.valid_until at time zone 'America/Fortaleza')::date > (sp.payment_date at time zone 'America/Fortaleza')::date then 'Card Mensal' else 'Aula avulsa' end
      || ' — ' || coalesce(st.name, 'aluno'), null::uuid
  from public.student_payments sp left join public.non_socio_students st on st.id = sp.student_id
  where sp.status = 'active' and (sp.payment_date at time zone 'America/Fortaleza')::date between p_from and p_to
  union all
  -- 4. Day Card do convidado, derivado da reserva com convidado (isentas valem R$ 0 e ficam de fora).
  select fin_private.category_id('day_card'), d.charged_cents, 'day_card', d.reservation_id::text,
    d.occurred_on, 'Day Card — ' || d.guest_name, null::uuid
  from fin_private.day_card_rows(p_from, p_to) d where d.charged_cents > 0
  union all
  -- 5. Contas e receitas manuais pela competência (pagas ou não — regime de competência).
  select e.category_id, case when e.kind = 'expense' then -e.amount_cents else e.amount_cents end, 'entry', e.id::text, e.competence_date,
    e.description, null::uuid
  from public.fin_entries e where e.status <> 'canceled' and e.kind in ('expense', 'revenue') and e.competence_date between p_from and p_to
  union all
  -- 6. Pagou diferente do documento: a diferença é juros/multa (ou desconto obtido) na data da quitação.
  select fin_private.category_id('interest'), case when e.kind = 'expense' then -e.adjustment_cents else e.adjustment_cents end, 'entry_adjustment',
    e.id::text, e.settled_on, 'Diferença no pagamento — ' || e.description, null::uuid
  from public.fin_entries e where e.status = 'paid' and e.kind in ('expense', 'revenue') and e.adjustment_cents <> 0 and e.settled_on between p_from and p_to;
end $function$


CREATE OR REPLACE FUNCTION fin_private.fold_text(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select translate(
    lower(coalesce(p_text,'')),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  )
$function$


CREATE OR REPLACE FUNCTION fin_private.receipt_auto_paid_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status='approved'
     and old.status is distinct from 'approved'
     and (new.source='whatsapp' or coalesce(new.decision_reason,'') like 'Baixa automática:%') then
    perform conv_private.queue_pendency_paid_notice(new.profile_id,new.id);
  end if;
  return new;
end $function$


CREATE OR REPLACE FUNCTION public.fin_active_members()
 RETURNS TABLE(id uuid, name text, phone text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform fin_private.require_admin();
  return query
    select p.id, p.name, p.phone::text
    from public.profiles p
    where coalesce(p.is_active,true)
      and coalesce(p.role::text,'') not in ('visitor')
    order by p.name;
end $function$


CREATE OR REPLACE FUNCTION public.fin_create_member_pendency(p_request_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid; v_replay jsonb; v_profile uuid; v_description text; v_amount bigint;
  v_comp date; v_due date; v_kind text; v_category uuid; v_guest text; v_guest_date date;
  v_collect boolean; v_send boolean; v_paid boolean; v_paid_on date; v_method text; v_account uuid;
  v_charge uuid; v_pay jsonb; v_rec uuid; v_raw_comp text; v_cat public.fin_categories%rowtype;
begin
  v_actor:=fin_private.require_admin();
  v_replay:=fin_private.begin_op(p_request_id,'member_pendency_create',p_data->>'description');
  if v_replay is not null then return v_replay; end if;

  v_profile:=(p_data->>'profile_id')::uuid;
  if not fin_private.is_active_member(v_profile) then raise exception 'MEMBER_NOT_ACTIVE'; end if;

  v_description:=trim(coalesce(p_data->>'description',''));
  if length(v_description) not between 3 and 300 then raise exception 'INVALID_DESCRIPTION'; end if;
  v_amount:=(p_data->>'amount_cents')::bigint;
  if v_amount is null or v_amount<=0 or v_amount>1000000000 then raise exception 'INVALID_AMOUNT'; end if;

  v_raw_comp:=coalesce(p_data->>'competence_month',p_data->>'competence');
  if v_raw_comp ~ '^\d{4}-\d{2}$' then v_comp:=to_date(v_raw_comp||'-01','YYYY-MM-DD');
  else v_comp:=date_trunc('month',v_raw_comp::date)::date; end if;
  v_due:=(p_data->>'due_date')::date;
  if v_comp is null or v_due is null then raise exception 'INVALID_DATE'; end if;

  v_kind:=coalesce(nullif(p_data->>'pendency_kind',''),'outros');
  if v_kind not in ('day_card','consumo','evento','multa','dano_reposicao','outros') then raise exception 'INVALID_PENDENCY_KIND'; end if;

  if nullif(p_data->>'category_id','') is not null then
    select * into v_cat from public.fin_categories where id=(p_data->>'category_id')::uuid and active and kind='revenue';
    if not found then raise exception 'INVALID_CATEGORY'; end if;
    v_category:=v_cat.id;
  elsif v_kind='day_card' then
    v_category:=fin_private.category_id('day_card');
  else
    v_category:=fin_private.category_id('member_pendency');
  end if;

  v_guest:=nullif(trim(coalesce(p_data->>'guest_name','')),'');
  v_guest_date:=nullif(p_data->>'guest_date','')::date;
  v_collect:=coalesce((p_data->>'collection_enabled')::boolean,true);
  v_send:=coalesce((p_data->>'send_now')::boolean,false);
  v_paid:=coalesce((p_data->>'already_paid')::boolean,false);

  insert into public.fin_member_charges(
    plan_id,profile_id,competence_month,period_months,due_date,original_amount_cents,status,source,notes,
    charge_type,description,pendency_kind,category_id,guest_name,guest_date,collection_enabled,created_by,updated_by
  ) values(
    null,v_profile,v_comp,1,v_due,v_amount,'open','manual',nullif(trim(coalesce(p_data->>'notes','')),''),
    'member_pendency',v_description,v_kind,v_category,v_guest,v_guest_date,v_collect,v_actor,v_actor
  ) returning id into v_charge;

  if v_paid then
    v_paid_on:=coalesce(nullif(p_data->>'paid_on','')::date,fin_private.today());
    v_method:=coalesce(nullif(p_data->>'method',''),'pix');
    v_account:=nullif(p_data->>'account_id','')::uuid;
    if v_method='credit' then raise exception 'INVALID_METHOD'; end if;
    if v_account is null then raise exception 'ACCOUNT_REQUIRED'; end if;
    v_pay:=fin_private.apply_payment(v_charge,v_amount,v_paid_on,v_method,v_account,null,null,
      'Pendência lançada como já paga',gen_random_uuid());
  elsif v_send and v_collect then
    v_rec:=conv_private.queue_member_pendency_now(v_profile,v_charge);
  end if;

  return fin_private.finish_op(p_request_id,jsonb_strip_nulls(jsonb_build_object(
    'id',v_charge,
    'status',case when v_paid then 'paid' else 'open' end,
    'payment',v_pay,
    'automation_recipient_id',v_rec
  )));
end $function$


CREATE OR REPLACE FUNCTION public.fin_member_payment_settings()
 RETURNS TABLE(pix_key text, pendency_automation_enabled boolean, pendency_reminder_days integer[], pendency_grace_days smallint, pendency_fine_fixed_cents bigint, pendency_fine_percent_bps integer, pendency_interest_daily_fixed_cents bigint, pendency_interest_daily_percent_bps integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.pix_key, s.pendency_automation_enabled, s.pendency_reminder_days,
    s.pendency_grace_days, s.pendency_fine_fixed_cents, s.pendency_fine_percent_bps,
    s.pendency_interest_daily_fixed_cents, s.pendency_interest_daily_percent_bps
  from public.fin_settings s
  where auth.uid() is not null
$function$


CREATE OR REPLACE FUNCTION public.fin_save_settings(p_request_id uuid, p_expected_version integer, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid; v_replay jsonb; s public.fin_settings%rowtype; n public.fin_settings%rowtype; v_confirm boolean;
  v_days integer[]; v_x integer;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'settings_save', p_data->>'reason');
  if v_replay is not null then return v_replay; end if;
  select * into s from public.fin_settings for update;
  if s.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  n := s;

  if p_data ? 'due_day' then n.due_day := (p_data->>'due_day')::smallint; end if;
  if p_data ? 'due_month_offset' then n.due_month_offset := (p_data->>'due_month_offset')::smallint; end if;
  if p_data ? 'non_business_rule' then n.non_business_rule := p_data->>'non_business_rule'; end if;
  if p_data ? 'saturday_is_business' then n.saturday_is_business := (p_data->>'saturday_is_business')::boolean; end if;
  if p_data ? 'horizon_months' then n.horizon_months := (p_data->>'horizon_months')::smallint; end if;
  if p_data ? 'grace_days' then n.grace_days := (p_data->>'grace_days')::smallint; end if;
  if p_data ? 'fine_fixed_cents' then n.fine_fixed_cents := (p_data->>'fine_fixed_cents')::bigint; end if;
  if p_data ? 'fine_percent_bps' then n.fine_percent_bps := (p_data->>'fine_percent_bps')::integer; end if;
  if p_data ? 'interest_daily_fixed_cents' then n.interest_daily_fixed_cents := (p_data->>'interest_daily_fixed_cents')::bigint; end if;
  if p_data ? 'interest_daily_percent_bps' then n.interest_daily_percent_bps := (p_data->>'interest_daily_percent_bps')::integer; end if;
  if p_data ? 'day_card_price_cents' then n.day_card_price_cents := (p_data->>'day_card_price_cents')::bigint; end if;
  if p_data ? 'day_card_in_cash' then n.day_card_in_cash := (p_data->>'day_card_in_cash')::boolean; end if;
  if p_data ? 'payee_names' then
    n.payee_names := coalesce(array(select trim(x) from jsonb_array_elements_text(p_data->'payee_names') x where length(trim(x)) > 0), '{}');
  end if;

  if p_data ? 'pix_key' then
    n.pix_key := trim(coalesce(p_data->>'pix_key',''));
    if length(n.pix_key) < 3 or length(n.pix_key) > 120 then raise exception 'INVALID_PIX_KEY'; end if;
  end if;
  if p_data ? 'pendency_automation_enabled' then n.pendency_automation_enabled := (p_data->>'pendency_automation_enabled')::boolean; end if;
  if p_data ? 'pendency_reminder_days' then
    select coalesce(array_agg(distinct x order by x), '{}') into v_days
    from (select value::integer x from jsonb_array_elements_text(p_data->'pendency_reminder_days')) q;
    if cardinality(v_days) < 1 or cardinality(v_days) > 20 then raise exception 'INVALID_REMINDER_DAYS'; end if;
    foreach v_x in array v_days loop
      if v_x < 0 or v_x > 365 then raise exception 'INVALID_REMINDER_DAYS'; end if;
    end loop;
    n.pendency_reminder_days := v_days;
  end if;
  if p_data ? 'pendency_grace_days' then n.pendency_grace_days := (p_data->>'pendency_grace_days')::smallint; end if;
  if p_data ? 'pendency_fine_fixed_cents' then n.pendency_fine_fixed_cents := (p_data->>'pendency_fine_fixed_cents')::bigint; end if;
  if p_data ? 'pendency_fine_percent_bps' then n.pendency_fine_percent_bps := (p_data->>'pendency_fine_percent_bps')::integer; end if;
  if p_data ? 'pendency_interest_daily_fixed_cents' then n.pendency_interest_daily_fixed_cents := (p_data->>'pendency_interest_daily_fixed_cents')::bigint; end if;
  if p_data ? 'pendency_interest_daily_percent_bps' then n.pendency_interest_daily_percent_bps := (p_data->>'pendency_interest_daily_percent_bps')::integer; end if;

  if p_data ? 'late_fee_confirmed' then
    v_confirm := (p_data->>'late_fee_confirmed')::boolean;
    if v_confirm and s.late_fee_confirmed_at is null then n.late_fee_confirmed_at := now(); n.late_fee_confirmed_by := v_actor;
    elsif not v_confirm then n.late_fee_confirmed_at := null; n.late_fee_confirmed_by := null; end if;
  end if;

  if s.late_fee_confirmed_at is not null and (
      n.grace_days is distinct from s.grace_days or n.fine_fixed_cents is distinct from s.fine_fixed_cents
      or n.fine_percent_bps is distinct from s.fine_percent_bps
      or n.interest_daily_fixed_cents is distinct from s.interest_daily_fixed_cents
      or n.interest_daily_percent_bps is distinct from s.interest_daily_percent_bps)
     and (p_data->>'reason' is null or length(trim(p_data->>'reason')) < 5) then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.fin_settings set
    due_day=n.due_day, due_month_offset=n.due_month_offset, non_business_rule=n.non_business_rule,
    saturday_is_business=n.saturday_is_business, horizon_months=n.horizon_months,
    grace_days=n.grace_days, fine_fixed_cents=n.fine_fixed_cents, fine_percent_bps=n.fine_percent_bps,
    interest_daily_fixed_cents=n.interest_daily_fixed_cents, interest_daily_percent_bps=n.interest_daily_percent_bps,
    day_card_price_cents=n.day_card_price_cents, day_card_in_cash=n.day_card_in_cash,
    payee_names=n.payee_names, late_fee_confirmed_at=n.late_fee_confirmed_at, late_fee_confirmed_by=n.late_fee_confirmed_by,
    pix_key=n.pix_key, pendency_automation_enabled=n.pendency_automation_enabled, pendency_reminder_days=n.pendency_reminder_days,
    pendency_grace_days=n.pendency_grace_days, pendency_fine_fixed_cents=n.pendency_fine_fixed_cents,
    pendency_fine_percent_bps=n.pendency_fine_percent_bps,
    pendency_interest_daily_fixed_cents=n.pendency_interest_daily_fixed_cents,
    pendency_interest_daily_percent_bps=n.pendency_interest_daily_percent_bps,
    version=version+1, updated_at=now(), updated_by=v_actor
  where id;

  return fin_private.finish_op(p_request_id, jsonb_build_object('version', s.version+1));
end $function$


CREATE OR REPLACE FUNCTION public.fin_send_pendency_now(p_request_id uuid, p_charge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid; v_replay jsonb; c public.fin_member_charges%rowtype; v_rec uuid;
begin
  v_actor:=fin_private.require_admin();
  v_replay:=fin_private.begin_op(p_request_id,'member_pendency_send_now','Cobrança manual');
  if v_replay is not null then return v_replay; end if;
  select * into c from public.fin_member_charges where id=p_charge for update;
  if not found or c.charge_type<>'member_pendency' then raise exception 'PENDENCY_NOT_FOUND'; end if;
  if c.status not in ('open','partial') then raise exception 'PENDENCY_NOT_OPEN'; end if;
  if not c.collection_enabled then raise exception 'COLLECTION_PAUSED'; end if;
  v_rec:=conv_private.queue_member_pendency_now(c.profile_id,c.id);
  return fin_private.finish_op(p_request_id,jsonb_build_object('id',c.id,'automation_recipient_id',v_rec));
end $function$


CREATE OR REPLACE FUNCTION public.fin_set_pendency_collection(p_request_id uuid, p_charge uuid, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid; v_replay jsonb; c public.fin_member_charges%rowtype;
begin
  v_actor:=fin_private.require_admin();
  v_replay:=fin_private.begin_op(p_request_id,'member_pendency_collection',case when p_enabled then 'ativar cobrança' else 'pausar cobrança' end);
  if v_replay is not null then return v_replay; end if;
  select * into c from public.fin_member_charges where id=p_charge for update;
  if not found or c.charge_type<>'member_pendency' then raise exception 'PENDENCY_NOT_FOUND'; end if;
  update public.fin_member_charges set collection_enabled=p_enabled,version=version+1,updated_at=now(),updated_by=v_actor where id=p_charge;
  if not p_enabled then
    update public.conv_automation_recipients
      set status='canceled',skip_reason='COBRANCA_PAUSADA'
      where profile_id=c.profile_id and status in ('pending','review')
        and automation_id in (select id from public.conv_automations where source='finance_charge' and definition->>'stage'='member_pendency');
  end if;
  return fin_private.finish_op(p_request_id,jsonb_build_object('id',p_charge,'collection_enabled',p_enabled));
end $function$


CREATE OR REPLACE FUNCTION public.fin_submit_receipt(p_request_id uuid, p_submission_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_replay jsonb; v_path text := p_data->>'storage_path'; v_hash text := lower(p_data->>'content_sha256');
  v_charges uuid[]; v_dup uuid; v_old public.fin_receipt_submissions%rowtype; v_replaces uuid := (p_data->>'replaces')::uuid;
  v_declared bigint := (p_data->>'declared_amount_cents')::bigint; v_ocr jsonb := p_data->'ocr'; v_auto jsonb;
begin
  if v_uid is null then raise exception 'FINANCE_FORBIDDEN' using errcode = '42501'; end if;
  if not fin_private.is_active_member(v_uid) then raise exception 'NOT_A_MEMBER'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'receipt_submit');
  if v_replay is not null then return v_replay; end if;
  -- O arquivo precisa estar na pasta do próprio sócio, na pasta deste envio.
  if v_path is null or v_path !~ ('^' || v_uid::text || '/' || p_submission_id::text || '/[^/]+$') then raise exception 'INVALID_ATTACHMENT'; end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_ATTACHMENT'; end if;
  if v_declared is not null and (v_declared <= 0 or v_declared > 1000000000) then raise exception 'INVALID_AMOUNT'; end if;
  if (p_data->>'declared_paid_on') is not null and (p_data->>'declared_paid_on')::date > fin_private.today() then raise exception 'INVALID_DATE'; end if;

  select coalesce(array_agg(x::uuid), '{}') into v_charges from jsonb_array_elements_text(coalesce(p_data->'charge_ids', '[]'::jsonb)) x;
  if cardinality(v_charges) = 0 then raise exception 'NO_CHARGES_SELECTED'; end if;
  -- Só cobranças do próprio sócio, ainda em aberto.
  if (select count(*) from public.fin_member_charges c where c.id = any(v_charges) and c.profile_id = v_uid and c.status in ('open', 'partial'))
     <> cardinality(v_charges) then raise exception 'INVALID_CHARGES'; end if;

  -- Possível duplicidade: mesmo arquivo (hash) já enviado e não substituído/rejeitado.
  -- Devolve só o aviso — nunca dados de outro sócio.
  select s.id into v_dup from public.fin_receipt_submissions s
  where s.content_sha256 = v_hash and s.status in ('submitted', 'in_review', 'approved') and s.id is distinct from v_replaces
  order by s.created_at limit 1;

  if v_replaces is not null then
    select * into v_old from public.fin_receipt_submissions where id = v_replaces for update;
    if not found or v_old.profile_id <> v_uid then raise exception 'FINANCE_FORBIDDEN' using errcode = '42501'; end if;
    if v_old.status not in ('submitted', 'in_review', 'rejected') then raise exception 'RECEIPT_NOT_REPLACEABLE'; end if;
  end if;

  insert into public.fin_receipt_submissions(id, profile_id, storage_path, file_name, content_type, size_bytes, content_sha256,
    declared_amount_cents, declared_paid_on, declared_reference, member_note, ocr_status, ocr, possible_duplicate, duplicate_of, request_id)
  values (p_submission_id, v_uid, v_path, p_data->>'file_name', p_data->>'content_type', (p_data->>'size_bytes')::integer, v_hash,
    v_declared, (p_data->>'declared_paid_on')::date, nullif(left(trim(coalesce(p_data->>'declared_reference', '')), 120), ''),
    nullif(left(trim(coalesce(p_data->>'member_note', '')), 500), ''), coalesce(p_data->>'ocr_status', 'not_run'),
    case when v_ocr is null then null else v_ocr - 'raw_text' - 'text' end, v_dup is not null, v_dup, p_request_id);
  insert into public.fin_receipt_charges(submission_id, charge_id) select p_submission_id, unnest(v_charges);

  if v_replaces is not null then
    update public.fin_receipt_submissions set status = 'superseded', superseded_by = p_submission_id, version = version + 1, updated_at = now()
    where id = v_replaces;
  end if;
  -- Pendências de sócio podem ser baixadas automaticamente, mas somente se o OCR
  -- estruturado tiver alta confiança e todas as validações financeiras passarem.
  v_auto := fin_private.auto_approve_pendency_receipt(p_submission_id);
  return fin_private.finish_op(p_request_id, jsonb_build_object(
    'id', p_submission_id,
    'status', case when coalesce((v_auto->>'approved')::boolean, false) then 'approved' else 'submitted' end,
    'possible_duplicate', v_dup is not null,
    'auto_approved', coalesce((v_auto->>'approved')::boolean, false),
    'auto_reason', v_auto->>'reason',
    'payment_ids', coalesce(v_auto->'payment_ids', '[]'::jsonb)
  ));
end $function$


CREATE OR REPLACE FUNCTION public.fin_submit_whatsapp_pendency_receipt(p_message uuid, p_submission uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text:=coalesce(auth.role(),'');
  v_profile uuid; v_media text; v_mime text; v_name text; v_existing uuid; v_ids uuid[];
  v_amount bigint; v_paid_on date; v_ocr jsonb; v_auto jsonb; v_hash text; v_size bigint; v_review_notice uuid;
begin
  if v_role <> 'service_role' then raise exception 'FORBIDDEN'; end if;

  select ct.profile_id,m.media_path,m.media_mime,coalesce(m.media_name,'comprovante')
    into v_profile,v_media,v_mime,v_name
  from public.conv_messages m
  join public.conv_conversations cv on cv.id=m.conversation_id and cv.kind='direct'
  join public.conv_contacts ct on ct.id=cv.contact_id
  where m.id=p_message and m.direction='inbound'
    and m.media_path is not null
    and ct.profile_id is not null
    and ct.link_status in ('linked','manual');
  if not found then raise exception 'WHATSAPP_RECEIPT_NOT_ELIGIBLE'; end if;

  select id into v_existing from public.fin_receipt_submissions where source_message_id=p_message;
  if v_existing is not null then
    return jsonb_build_object('id',v_existing,'duplicate',true,
      'status',(select status from public.fin_receipt_submissions where id=v_existing));
  end if;

  select coalesce(array_agg(c.id order by (c.due_date>=fin_private.today()),c.due_date,c.id),'{}')
    into v_ids
  from public.fin_member_charges c
  cross join lateral fin_private.charge_statement(c.id,fin_private.today()) st
  where c.profile_id=v_profile and c.charge_type='member_pendency'
    and c.status in ('open','partial') and st.total_due>0;
  if cardinality(v_ids)=0 then
    return jsonb_build_object('skipped',true,'reason','NO_OPEN_PENDENCIES');
  end if;

  v_amount:=nullif(p_data->>'declared_amount_cents','')::bigint;
  v_paid_on:=nullif(p_data->>'declared_paid_on','')::date;
  v_ocr:=p_data->'ocr';
  v_hash:=lower(coalesce(p_data->>'content_sha256',''));
  v_size:=coalesce(nullif(p_data->>'size_bytes','')::bigint,0);

  if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_HASH'; end if;
  if v_size<=0 or v_size>10485760 then raise exception 'INVALID_SIZE'; end if;
  if coalesce(p_data->>'storage_path','')='' then raise exception 'INVALID_STORAGE_PATH'; end if;

  insert into public.fin_receipt_submissions(
    id,profile_id,status,storage_path,file_name,content_type,size_bytes,content_sha256,
    declared_amount_cents,declared_paid_on,declared_reference,member_note,
    ocr_status,ocr,possible_duplicate,request_id,source,source_message_id,created_at,updated_at
  ) values(
    p_submission,v_profile,'submitted',p_data->>'storage_path',
    coalesce(nullif(p_data->>'file_name',''),v_name),
    coalesce(nullif(p_data->>'content_type',''),v_mime,'application/octet-stream'),
    v_size,v_hash,v_amount,v_paid_on,nullif(p_data->>'declared_reference',''),
    'Comprovante recebido pelo WhatsApp institucional',
    coalesce(nullif(p_data->>'ocr_status',''),'not_run'),v_ocr,false,p_submission,'whatsapp',p_message,now(),now()
  );

  insert into public.fin_receipt_charges(submission_id,charge_id)
  select p_submission,unnest(v_ids);

  update public.fin_receipt_submissions s set possible_duplicate=exists(
    select 1 from public.fin_receipt_submissions o
    where o.id<>s.id and o.profile_id=s.profile_id and o.content_sha256=s.content_sha256
  ) where s.id=p_submission;

  v_auto:=fin_private.auto_approve_pendency_receipt(p_submission);

  if not coalesce((v_auto->>'approved')::boolean,false) then
    v_review_notice:=conv_private.queue_pendency_receipt_review_notice(v_profile,p_submission);
  end if;

  return jsonb_build_object(
    'id',p_submission,
    'duplicate',false,
    'status',(select status from public.fin_receipt_submissions where id=p_submission),
    'auto_approved',coalesce((v_auto->>'approved')::boolean,false),
    'auto_reason',v_auto->>'reason',
    'profile_id',v_profile,
    'charge_ids',to_jsonb(v_ids),
    'payment_ids',coalesce(v_auto->'payment_ids','[]'::jsonb),
    'review_notice_recipient_id',v_review_notice
  );
end $function$



revoke all on function public.fin_member_payment_settings() from public,anon;
grant execute on function public.fin_member_payment_settings() to authenticated,service_role;
revoke all on function public.fin_active_members() from public,anon;
grant execute on function public.fin_active_members() to authenticated,service_role;
revoke all on function public.fin_create_member_pendency(uuid,jsonb) from public,anon;
grant execute on function public.fin_create_member_pendency(uuid,jsonb) to authenticated,service_role;
revoke all on function public.fin_set_pendency_collection(uuid,uuid,boolean) from public,anon;
grant execute on function public.fin_set_pendency_collection(uuid,uuid,boolean) to authenticated,service_role;
revoke all on function public.fin_send_pendency_now(uuid,uuid) from public,anon;
grant execute on function public.fin_send_pendency_now(uuid,uuid) to authenticated,service_role;
revoke all on function public.fin_submit_whatsapp_pendency_receipt(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fin_submit_whatsapp_pendency_receipt(uuid,uuid,jsonb) to service_role;
revoke all on function fin_private.fold_text(text) from public,anon,authenticated;
revoke all on function fin_private.auto_approve_pendency_receipt(uuid) from public,anon,authenticated;

drop trigger if exists fin_receipt_auto_paid_notice on public.fin_receipt_submissions;
create trigger fin_receipt_auto_paid_notice
after update of status on public.fin_receipt_submissions
for each row execute function fin_private.receipt_auto_paid_notice();

insert into public.conv_automations(
  name,description,objective,source,trigger_type,definition,schedule,message_body,status,version,created_at,updated_at,activated_at
)
select 'Cobrança de pendências de sócios',
  'Régua configurável para pendências financeiras manuais dos sócios.',
  'Cobrar pendências em aberto, consolidando os itens e interrompendo automaticamente quando quitados.',
  'finance_charge','conditional','{"stage":"member_pendency","exclude_in_review":true}'::jsonb,'{}'::jsonb,
  E'Olá, {{nome}}! O Sobral Tênis Clube informa que há pendência(s) em aberto:\n\n{{itens}}\n\nTotal atualizado: {{total}}\nPIX: {{pix}}\n\nSe já realizou o pagamento, envie o comprovante por aqui.',
  'active',1,now(),now(),now()
where not exists (
  select 1 from public.conv_automations where source='finance_charge' and definition->>'stage'='member_pendency' and status<>'ended'
);

insert into public.conv_automations(
  name,description,objective,source,trigger_type,definition,schedule,message_body,status,version,created_at,updated_at,activated_at
)
select 'Confirmação de pagamento de pendência',
  'Confirma ao sócio quando um comprovante de pendência é validado automaticamente.',
  'Informar a baixa feita pelo motor financeiro após conferência do comprovante.',
  'finance_charge','manual','{"stage":"member_pendency_paid"}'::jsonb,'{}'::jsonb,
  'Pagamento identificado, {{nome}}! Recebemos {{pago}} e atualizamos suas pendências. Saldo em aberto: {{saldo}}. ✅',
  'active',1,now(),now(),now()
where not exists (
  select 1 from public.conv_automations where source='finance_charge' and definition->>'stage'='member_pendency_paid' and status<>'ended'
);

insert into public.conv_automations(
  name,description,objective,source,trigger_type,definition,schedule,message_body,status,version,created_at,updated_at,activated_at
)
select 'Comprovante de pendência em análise',
  'Confirma ao sócio que o comprovante recebido pelo WhatsApp foi registrado e aguarda conferência.',
  'Evitar silêncio quando o OCR não puder baixar automaticamente.',
  'finance_charge','manual','{"stage":"member_pendency_receipt_review"}'::jsonb,'{}'::jsonb,
  'Recebi seu comprovante, {{nome}}. Ele ficou em análise porque não consegui confirmar todos os dados com segurança. Assim que for conferido, o financeiro é atualizado.',
  'active',1,now(),now(),now()
where not exists (
  select 1 from public.conv_automations where source='finance_charge' and definition->>'stage'='member_pendency_receipt_review' and status<>'ended'
);

insert into public.conv_automation_versions(automation_id,version,definition,schedule,message_body,trigger_type,created_at)
select a.id,a.version,a.definition,a.schedule,a.message_body,a.trigger_type,now()
from public.conv_automations a
where a.source='finance_charge' and a.definition->>'stage' like 'member_pendency%'
  and not exists(select 1 from public.conv_automation_versions v where v.automation_id=a.id and v.version=a.version);
