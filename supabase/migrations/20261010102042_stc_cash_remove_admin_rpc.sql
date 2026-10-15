-- Remoção administrativa de movimentos incorretos, atômica e auditável.
create or replace function public.fin_remove_cash_movement(
  p_request_id uuid,p_source_type text,p_source_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_actor uuid;
  v_replay jsonb;
  v_reason text := trim(coalesce(p_reason,''));
  v_entry public.fin_entries%rowtype;
  v_entry_payment public.fin_entry_payments%rowtype;
  v_payment public.fin_charge_payments%rowtype;
  v_reversal public.fin_charge_payments%rowtype;
  v_student public.student_payments%rowtype;
  v_res public.reservations%rowtype;
  v_account public.fin_accounts%rowtype;
  v_count integer := 0;
begin
  v_actor:=fin_private.require_admin();
  if p_request_id is null or p_source_id is null then raise exception 'INVALID_ENTRY'; end if;
  if length(v_reason)<8 or length(v_reason)>500 then raise exception 'REASON_REQUIRED'; end if;
  if p_source_type not in ('entry_payment','member_payment','member_reversal','student_payment','day_card','opening')
  then raise exception 'INVALID_CASH_SOURCE'; end if;
  v_replay:=fin_private.begin_op(p_request_id,'cash_remove',v_reason);
  if v_replay is not null then return v_replay; end if;
  if exists(select 1 from fin_private.cash_removed
            where source_type=p_source_type and source_id=p_source_id::text)
  then raise exception 'CASH_ALREADY_REMOVED'; end if;

  if p_source_type='entry_payment' then
    select * into v_entry_payment from public.fin_entry_payments where id=p_source_id;
    if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
    select * into v_entry from public.fin_entries where id=v_entry_payment.entry_id for update;
    if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
    if v_entry.kind='member_refund' or exists (
      select 1 from public.fin_member_credits where refund_entry_id=v_entry.id
    ) then raise exception 'CASH_LINKED_CREDIT'; end if;
    if v_entry.status<>'canceled' then
      perform public.fin_void_entry(gen_random_uuid(),v_entry.id,v_entry.version,v_reason);
    end if;
    for v_entry_payment in
      select * from public.fin_entry_payments where entry_id=v_entry.id order by created_at,id
    loop
      insert into fin_private.cash_removed(source_type,source_id,reason,actor_id,request_id,snapshot)
      values('entry_payment',v_entry_payment.id::text,v_reason,v_actor,p_request_id,
        jsonb_build_object('entry',to_jsonb(v_entry),'payment',to_jsonb(v_entry_payment)))
      on conflict(source_type,source_id) do nothing;
      v_count:=v_count+1;
    end loop;

  elsif p_source_type in ('member_payment','member_reversal') then
    if p_source_type='member_reversal' then
      select * into v_reversal from public.fin_charge_payments where id=p_source_id and kind='reversal';
      if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
      select * into v_payment from public.fin_charge_payments
      where id=v_reversal.reverses_payment_id and kind='payment';
    else
      select * into v_payment from public.fin_charge_payments where id=p_source_id and kind='payment';
    end if;
    if v_payment.id is null then raise exception 'PAYMENT_NOT_FOUND'; end if;
    perform 1 from public.fin_member_charges where id=v_payment.charge_id for update;
    select * into v_reversal from public.fin_charge_payments
    where reverses_payment_id=v_payment.id;
    if v_reversal.id is null then
      -- Motor atual valida ordem dos pagamentos e possíveis créditos utilizados.
      perform public.fin_reverse_payment(gen_random_uuid(),v_payment.id,v_reason);
      select * into v_reversal from public.fin_charge_payments
      where reverses_payment_id=v_payment.id;
    end if;
    if v_reversal.id is null then raise exception 'PAYMENT_NOT_FOUND'; end if;
    insert into fin_private.cash_removed(source_type,source_id,reason,actor_id,request_id,snapshot)
    values('member_payment',v_payment.id::text,v_reason,v_actor,p_request_id,to_jsonb(v_payment))
    on conflict(source_type,source_id) do nothing;
    insert into fin_private.cash_removed(source_type,source_id,reason,actor_id,request_id,snapshot)
    values('member_reversal',v_reversal.id::text,v_reason,v_actor,p_request_id,to_jsonb(v_reversal))
    on conflict(source_type,source_id) do nothing;
    v_count:=2;

  elsif p_source_type='student_payment' then
    select * into v_student from public.student_payments where id=p_source_id for update;
    if not found or v_student.status<>'active' then raise exception 'PAYMENT_NOT_FOUND'; end if;
    update public.student_payments set status='cancelled',cancelled_reason=v_reason
    where id=v_student.id;
    insert into fin_private.cash_removed(source_type,source_id,reason,actor_id,request_id,snapshot)
    values('student_payment',v_student.id::text,v_reason,v_actor,p_request_id,to_jsonb(v_student));
    v_count:=1;

  elsif p_source_type='day_card' then
    select * into v_res from public.reservations where id=p_source_id for update;
    if not found or v_res.type<>'Play' or nullif(trim(coalesce(v_res.guest_name,'')),'') is null
       or coalesce(v_res.status,'active')='cancelled'
       or v_res.payment_status::text='exempt'
    then raise exception 'INVALID_CASH_SOURCE'; end if;
    insert into fin_private.cash_removed(source_type,source_id,reason,actor_id,request_id,snapshot)
    values('day_card',v_res.id::text,v_reason,v_actor,p_request_id,to_jsonb(v_res));
    v_count:=1;

  elsif p_source_type='opening' then
    select * into v_account from public.fin_accounts where id=p_source_id for update;
    if not found or v_account.opening_balance_cents=0 then raise exception 'INVALID_CASH_SOURCE'; end if;
    update public.fin_accounts set opening_balance_cents=0,version=version+1,
      updated_at=now(),updated_by=v_actor where id=p_source_id;
    insert into fin_private.cash_removed(source_type,source_id,reason,actor_id,request_id,snapshot)
    values('opening',v_account.id::text,v_reason,v_actor,p_request_id,to_jsonb(v_account));
    v_count:=1;
  end if;

  return fin_private.finish_op(p_request_id,jsonb_build_object(
    'removed',true,'source_type',p_source_type,'source_id',p_source_id,'affected_movements',v_count
  ));
end $function$;
revoke all on function public.fin_remove_cash_movement(uuid,text,uuid,text) from public,anon;
grant execute on function public.fin_remove_cash_movement(uuid,text,uuid,text) to authenticated;

-- Consulta ao arquivo privado para auditoria exclusiva de administradores.
create or replace function public.fin_removed_cash_history(p_limit integer default 100)
returns table(source_type text,source_id text,reason text,actor_name text,removed_at timestamptz)
language plpgsql stable security definer set search_path=''
as $function$
begin
  perform fin_private.require_admin();
  return query select d.source_type,d.source_id,d.reason,coalesce(pr.name,'Administrador'),d.occurred_at
  from fin_private.cash_removed d left join public.profiles pr on pr.id=d.actor_id
  order by d.occurred_at desc limit least(greatest(p_limit,1),300);
end $function$;
revoke all on function public.fin_removed_cash_history(integer) from public,anon;
grant execute on function public.fin_removed_cash_history(integer) to authenticated;
