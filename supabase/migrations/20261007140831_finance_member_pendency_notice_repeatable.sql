create or replace function conv_private.queue_pendency_paid_notice(p_profile uuid,p_submission uuid)
returns uuid
language plpgsql security definer set search_path='' as $$
declare
  a public.conv_automations%rowtype;
  v_run uuid;
  v_rec uuid;
  v_subject jsonb;
  v_name text;
  v_phone text;
  v_at timestamptz:=clock_timestamp();
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
  values(a.id,a.version,'manual',v_at,'running',v_at) returning id into v_run;

  insert into public.conv_automation_recipients(
    run_id,automation_id,purpose_key,dedupe_key,profile_id,phone,display_name,subject,status,due_at
  ) values(
    v_run,a.id,conv_private.automation_purpose(a),
    'fin:member_pendency:paid:'||p_submission::text,
    p_profile,conv_private.phone_e164(v_phone),v_name,v_subject,'pending',v_at
  )
  on conflict (purpose_key,dedupe_key) where status<>'canceled' do nothing
  returning id into v_rec;

  if v_rec is null then update public.conv_automation_runs set status='done',finished_at=clock_timestamp() where id=v_run; end if;
  return v_rec;
end $$;

create or replace function conv_private.queue_pendency_receipt_review_notice(p_profile uuid,p_submission uuid)
returns uuid
language plpgsql security definer set search_path='' as $$
declare
  a public.conv_automations%rowtype;
  v_run uuid;
  v_rec uuid;
  v_name text;
  v_phone text;
  v_at timestamptz:=clock_timestamp();
begin
  select * into a from public.conv_automations
  where source='finance_charge' and definition->>'stage'='member_pendency_receipt_review' and status='active'
  order by created_at limit 1;
  if not found then return null; end if;
  select name,phone::text into v_name,v_phone from public.profiles where id=p_profile;
  if v_name is null then return null; end if;

  insert into public.conv_automation_runs(automation_id,version,kind,planned_for,status,created_at)
  values(a.id,a.version,'manual',v_at,'running',v_at) returning id into v_run;

  insert into public.conv_automation_recipients(
    run_id,automation_id,purpose_key,dedupe_key,profile_id,phone,display_name,subject,status,due_at
  ) values(
    v_run,a.id,conv_private.automation_purpose(a),
    'fin:member_pendency:receipt_review:'||p_submission::text,
    p_profile,conv_private.phone_e164(v_phone),v_name,
    jsonb_build_object('submission_id',p_submission),'pending',v_at
  )
  on conflict (purpose_key,dedupe_key) where status<>'canceled' do nothing
  returning id into v_rec;

  if v_rec is null then update public.conv_automation_runs set status='done',finished_at=clock_timestamp() where id=v_run; end if;
  return v_rec;
end $$;

revoke all on function conv_private.queue_pendency_paid_notice(uuid,uuid) from public,anon,authenticated;
revoke all on function conv_private.queue_pendency_receipt_review_notice(uuid,uuid) from public,anon,authenticated;
