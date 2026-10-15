-- Anulação segura de lançamento manual incorreto a partir do Fluxo de Caixa.
-- Exclusão lógica: pagamentos são estornados hoje, documento cancelado e
-- histórico/contabilidade preservados para auditoria. Toda operação é atômica.
create or replace function public.fin_void_entry(
  p_request_id uuid,
  p_id uuid,
  p_expected_version integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_replay jsonb;
  v_entry public.fin_entries%rowtype;
  v_payment public.fin_entry_payments%rowtype;
  v_reversed integer := 0;
  v_reason text := trim(coalesce(p_reason,''));
begin
  v_actor := fin_private.require_admin();
  if length(v_reason) < 8 or length(v_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;
  if p_id is null or p_expected_version is null then raise exception 'INVALID_ENTRY'; end if;
  v_replay := fin_private.begin_op(p_request_id, 'entry_void', v_reason);
  if v_replay is not null then return v_replay; end if;

  select * into v_entry from public.fin_entries where id = p_id for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if v_entry.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if v_entry.status = 'canceled' then raise exception 'ENTRY_CANCELED'; end if;

  -- Não há pagamentos em fonte derivada nesta tabela. Para documentos pagos,
  -- nunca apagar a linha financeira original nem o comprovante.
  -- Reverter somente o que permanece efetivo, evitando duplo estorno.
  for v_payment in
    select p.* from public.fin_entry_payments p
    where p.entry_id = p_id and p.kind = 'payment'
      and not exists (
        select 1 from public.fin_entry_payments r
        where r.reverses_payment_id = p.id
      )
    order by p.created_at,p.id
  loop
    insert into public.fin_entry_payments (
      entry_id,kind,amount_cents,paid_on,account_id,
      reverses_payment_id,note,actor_id,request_id
    ) values (
      v_payment.entry_id,'reversal',v_payment.amount_cents,
      fin_private.today(),v_payment.account_id,v_payment.id,
      left('Anulação de lançamento incorreto: ' || v_reason,500),
      v_actor,gen_random_uuid()
    );
    v_reversed := v_reversed + 1;
  end loop;

  if fin_private.entry_paid_cents(p_id) <> 0 then
    raise exception 'ENTRY_HAS_PAYMENTS';
  end if;

  update public.fin_entries
  set status = 'canceled',
      canceled_at = now(), canceled_by = v_actor,
      cancel_reason = v_reason,
      settled_on = null, adjustment_cents = 0,
      version = version + 1,
      updated_at = now(), updated_by = v_actor
  where id = p_id;

  return fin_private.finish_op(p_request_id,jsonb_build_object(
    'id',p_id,'version',v_entry.version+1,
    'reversed_payments',v_reversed,'canceled',true
  ));
end
$function$;

revoke all on function public.fin_void_entry(uuid,uuid,integer,text) from public,anon;
grant execute on function public.fin_void_entry(uuid,uuid,integer,text) to authenticated;
