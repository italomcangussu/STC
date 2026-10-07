-- Financeiro: permitir apagar uma despesa recorrente (o modelo), nunca o histórico.
--
-- Regras:
--  * Só administrador (mesma barreira das demais funções `fin_*`), com chave de idempotência e versão.
--  * Lançamentos pendentes e sem pagamento são CANCELADOS (nunca apagados), com o motivo gravado.
--  * Todos os lançamentos da recorrência (pagos, parciais e cancelados) são DESVINCULADOS e continuam
--    no caixa, nas contas a pagar e no DRE como lançamentos avulsos.
--  * A linha apagada fica na auditoria (o gatilho passa a registrar também o DELETE).
--  * O gatilho "não apagar" continua valendo para quem não vem desta função: o `delete` só passa
--    quando a própria função marca, na transação, o id exato da recorrência.

create or replace function fin_private.no_delete_recurrence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('fin.delete_recurrence', true), '') is distinct from old.id::text then
    raise exception 'FINANCE_NO_DELETE';
  end if;
  return old;
end $$;

drop trigger if exists fin_recurrences_no_delete on public.fin_recurrences;
create trigger fin_recurrences_no_delete before delete on public.fin_recurrences
  for each row execute function fin_private.no_delete_recurrence();

drop trigger if exists fin_recurrences_audit on public.fin_recurrences;
create trigger fin_recurrences_audit after insert or update or delete on public.fin_recurrences
  for each row execute function fin_private.audit_row();

create or replace function public.fin_delete_recurrence(p_request_id uuid, p_id uuid, p_expected_version integer, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_replay jsonb; r public.fin_recurrences%rowtype; v_canceled integer; v_kept integer;
begin
  v_actor := fin_private.require_admin();
  v_replay := fin_private.begin_op(p_request_id, 'recurrence_delete', p_data->>'reason');
  if v_replay is not null then return v_replay; end if;
  select * into r from public.fin_recurrences where id = p_id for update;
  if not found then raise exception 'RECURRENCE_NOT_FOUND'; end if;
  if r.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;

  -- O que ainda não foi pago deixa de existir como cobrança futura (cancelado, com rastro).
  update public.fin_entries set status = 'canceled', canceled_at = now(), canceled_by = v_actor,
    cancel_reason = 'Recorrência excluída', version = version + 1, updated_at = now(), updated_by = v_actor
  where recurrence_id = p_id and status = 'pending' and fin_private.entry_paid_cents(id) = 0;
  get diagnostics v_canceled = row_count;

  select count(*) into v_kept from public.fin_entries where recurrence_id = p_id and status <> 'canceled';

  -- O histórico fica: só perde o vínculo com o modelo que deixou de existir.
  update public.fin_entries set recurrence_id = null, version = version + 1, updated_at = now(), updated_by = v_actor
  where recurrence_id = p_id;

  perform set_config('fin.delete_recurrence', p_id::text, true);
  delete from public.fin_recurrences where id = p_id;
  perform set_config('fin.delete_recurrence', '', true);

  return fin_private.finish_op(p_request_id, jsonb_build_object('id', p_id, 'canceled', v_canceled, 'kept', v_kept));
end $$;

revoke all on function public.fin_delete_recurrence(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.fin_delete_recurrence(uuid, uuid, integer, jsonb) to authenticated;
