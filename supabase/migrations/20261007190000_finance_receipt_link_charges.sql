-- O administrador pode ligar cobranças (mensalidade ou pendência em aberto do MESMO sócio) a um
-- comprovante ainda pendente. Serve para o comprovante que chegou sem cobrança ligada (sócio sem
-- plano/pendência na hora do envio) ou ligado às cobranças erradas. Ligar não paga nada: o pagamento
-- só acontece na aprovação. A ligação fica auditada (alteração do comprovante com a ação
-- 'receipt_link_charges') e passa a marcar as cobranças como "em análise".

create or replace function public.fin_link_receipt_charges(p_request_id uuid, p_submission_id uuid, p_charge_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; s public.fin_receipt_submissions%rowtype; v_ok integer; v_new integer; v_ids uuid[];
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'receipt_link_charges',
    'Cobranças ligadas ao comprovante pelo administrador');
  if v_replay is not null then return v_replay; end if;

  select * into s from public.fin_receipt_submissions where id = p_submission_id for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if s.status not in ('submitted', 'in_review') then raise exception 'RECEIPT_NOT_PENDING'; end if;
  if p_charge_ids is null or cardinality(p_charge_ids) = 0 or cardinality(p_charge_ids) > 50 then raise exception 'NO_CHARGES_SELECTED'; end if;

  -- Só cobranças do próprio sócio que enviou, ainda em aberto.
  select count(*) into v_ok from public.fin_member_charges c
  where c.id = any(p_charge_ids) and c.profile_id = s.profile_id and c.status in ('open', 'partial');
  if v_ok <> (select count(distinct x) from unnest(p_charge_ids) x) then raise exception 'INVALID_CHARGES'; end if;

  insert into public.fin_receipt_charges(submission_id, charge_id)
  select p_submission_id, x from (select distinct unnest(p_charge_ids) x) u
  on conflict do nothing;
  get diagnostics v_new = row_count;

  if v_new > 0 then
    update public.fin_receipt_submissions set version = version + 1, updated_at = now() where id = p_submission_id;
  end if;

  select coalesce(array_agg(rc.charge_id), '{}') into v_ids from public.fin_receipt_charges rc where rc.submission_id = p_submission_id;
  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_submission_id, 'linked', v_new, 'charge_ids', to_jsonb(v_ids)));
end $$;

revoke all on function public.fin_link_receipt_charges(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.fin_link_receipt_charges(uuid, uuid, uuid[]) to authenticated;
