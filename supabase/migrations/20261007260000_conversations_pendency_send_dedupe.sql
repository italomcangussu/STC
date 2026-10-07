-- Cobrança de pendência de sócio sem envio duplicado. Antes, cada "cobrar agora" (painel ou João) criava uma execução
-- nova sem olhar o que já estava na fila: o Lucas teve 4 execuções em 4 minutos (1 enviada, 3 na fila).
-- Agora existe UM ponto de decisão: se o sócio já tem cobrança de pendência na fila (pendente, em revisão ou sendo
-- enviada) ou enviada nos últimos 30 minutos, nenhuma execução nova é criada e quem pediu recebe o que já existe.

create or replace function conv_private.pendency_send_existing(p_profile uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'status', r.status, 'sent_at', r.sent_at,
    'hhmm', to_char(coalesce(r.sent_at, r.due_at) at time zone 'America/Fortaleza', 'HH24:MI'))
  from public.conv_automation_recipients r
  join public.conv_automations a on a.id = r.automation_id and a.source = 'finance_charge' and a.definition->>'stage' = 'member_pendency'
  where r.profile_id = p_profile
    and (r.status in ('pending', 'review', 'processing') or (r.status = 'sent' and r.sent_at > now() - interval '30 minutes'))
  order by coalesce(r.sent_at, r.due_at) desc
  limit 1
$$;

CREATE OR REPLACE FUNCTION conv_private.queue_member_pendency_now(p_profile uuid, p_charge uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.conv_automations%rowtype;
  v_run uuid;
  v_rec uuid;
  v_subject jsonb;
  v_name text;
  v_phone text;
  v_existing jsonb;
  v_at timestamptz:=clock_timestamp();
begin
  select * into a from public.conv_automations
  where source='finance_charge' and definition->>'stage'='member_pendency' and status='active'
  order by created_at limit 1;
  if not found then return null; end if;

  -- Duas chamadas simultâneas para o mesmo sócio esperam uma pela outra e a segunda enxerga a primeira.
  perform pg_advisory_xact_lock(hashtextextended('pendency_send:'||p_profile::text,7));
  v_existing:=conv_private.pendency_send_existing(p_profile);
  if v_existing is not null then return (v_existing->>'id')::uuid; end if;

  v_subject:=conv_private.member_pendency_subject(p_profile,conv_private.today(),true);
  if v_subject is null then return null; end if;
  select name,phone::text into v_name,v_phone from public.profiles where id=p_profile;
  if v_name is null then return null; end if;

  insert into public.conv_automation_runs(automation_id,version,kind,planned_for,status,created_at)
  values(a.id,a.version,'manual',v_at,'running',v_at)
  returning id into v_run;

  insert into public.conv_automation_recipients(
    run_id,automation_id,purpose_key,dedupe_key,profile_id,phone,display_name,subject,status,due_at
  ) values(
    v_run,a.id,conv_private.automation_purpose(a),
    'fin:member_pendency:manual:'||v_run::text,
    p_profile,conv_private.phone_e164(v_phone),v_name,
    v_subject||jsonb_build_object('scope','manual'),'pending',v_at
  )
  returning id into v_rec;

  return v_rec;
end $function$
;

CREATE OR REPLACE FUNCTION public.fin_send_pendency_now(p_request_id uuid, p_charge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid; v_replay jsonb; c public.fin_member_charges%rowtype; v_rec uuid; v_existing jsonb;
begin
  v_actor:=fin_private.require_admin();
  v_replay:=fin_private.begin_op(p_request_id,'member_pendency_send_now','Cobrança manual');
  if v_replay is not null then return v_replay; end if;
  select * into c from public.fin_member_charges where id=p_charge for update;
  if not found or c.charge_type<>'member_pendency' then raise exception 'PENDENCY_NOT_FOUND'; end if;
  if c.status not in ('open','partial') then raise exception 'PENDENCY_NOT_OPEN'; end if;
  if not c.collection_enabled then raise exception 'COLLECTION_PAUSED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pendency_send:'||c.profile_id::text,7));
  v_existing:=conv_private.pendency_send_existing(c.profile_id);
  if v_existing is not null then
    return fin_private.finish_op(p_request_id,jsonb_build_object('id',c.id,'automation_recipient_id',(v_existing->>'id')::uuid,
      'already',v_existing->>'status','already_hhmm',v_existing->>'hhmm'));
  end if;
  v_rec:=conv_private.queue_member_pendency_now(c.profile_id,c.id);
  return fin_private.finish_op(p_request_id,jsonb_build_object('id',c.id,'automation_recipient_id',v_rec));
end $function$
;

revoke all on function conv_private.pendency_send_existing(uuid) from public, anon, authenticated;
revoke all on function public.fin_send_pendency_now(uuid,uuid) from public,anon;
grant execute on function public.fin_send_pendency_now(uuid,uuid) to authenticated,service_role;
