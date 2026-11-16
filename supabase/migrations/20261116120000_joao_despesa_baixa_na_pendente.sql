-- Comprovante de conta que já está lançada como pendente vira BAIXA nela, não despesa nova.
-- Caso de 05/11: o Henrique mandou os comprovantes de aluguel, administrador, K-Lanche, contador e internet; o João
-- lançou cinco despesas novas e as cinco recorrentes de novembro ficaram "vencidas" (R$ 5.097,00), com a despesa do
-- mês contada em dobro no resumo da manhã e alerta diário falso para o Thieslley.
-- Regra: lançamento PAGO cujo valor bate com UMA ÚNICA pendente do mesmo tipo, sem pagamento, vencendo até 20 dias
-- antes ou depois da data do pagamento → a proposta passa a ser a baixa dessa pendente (conta e data do pagamento,
-- comprovante anexado a ela). Zero ou mais de uma pendente com o valor: lança como antes.

create or replace function conv_private.pending_entry_match(p_kind text, p_amount bigint, p_on date)
returns table(id uuid, description text, due_date date)
language sql stable security definer set search_path = '' as $$
  with m as (
    select e.id, e.description, e.due_date from public.fin_entries e
    where e.kind = p_kind and e.status = 'pending' and e.canceled_at is null and e.amount_cents = p_amount
      and e.due_date between p_on - 20 and p_on + 20
      and fin_private.entry_paid_cents(e.id) = 0
  )
  select m.id, m.description, m.due_date from m where (select count(*) from m) = 1
$$;
revoke all on function conv_private.pending_entry_match(text, bigint, date) from public, anon, authenticated, service_role;

-- Proposta: a camada atual (com o comprovante anexado) segue igual; só acrescenta a pendente que o pagamento quita.
alter function conv_private.ai_admin_finance_propose(uuid, jsonb) rename to ai_admin_finance_propose_w7;

create function conv_private.ai_admin_finance_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; s jsonb; v_match record; v_link jsonb;
begin
  r := conv_private.ai_admin_finance_propose_w7(p_session, p);
  s := r->'summary';
  if coalesce(p->>'action', '') <> 'fin_entry_create' or not coalesce((r->>'ok')::boolean, false)
     or coalesce(s->>'entry_status', 'paid') <> 'paid' then
    return r;
  end if;
  select * into v_match from conv_private.pending_entry_match(s->>'entry_kind', (s->>'amount_cents')::bigint,
    coalesce(nullif(s->>'paid_on', '')::date, conv_private.today()));
  if v_match.id is null then return r; end if;
  v_link := jsonb_build_object('settles_entry_id', v_match.id, 'settles_description', v_match.description, 'settles_due_date', v_match.due_date);
  update public.conv_booking_proposals set payload = payload || v_link where id = (r->>'proposal_id')::uuid;
  return r || jsonb_build_object('summary', s || v_link);
end $$;
revoke all on function conv_private.ai_admin_finance_propose(uuid, jsonb) from public, anon, authenticated, service_role;

-- Confirmação: com `settles_entry_id`, dá baixa na pendente (fin_pay_entry) em vez de criar o lançamento.
-- O resultado traz o id da pendente, então o gatilho do comprovante anexa nela. Se ela deixou de estar pendente
-- ou mudou de valor entre a proposta e o "confirmo", falha com a frase certa (nunca lança em dobro).
CREATE OR REPLACE FUNCTION conv_private.ai_confirm_wave2_step(p_proposal uuid, p_message uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  bp public.conv_booking_proposals%rowtype; m public.conv_messages%rowtype; v_admin uuid;
  v_prev_claims text; v_prev_sub text; v_res jsonb; v_err text; v_code text; v_cat text; v_champ jsonb;
  v_settle public.fin_entries%rowtype;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not in ('fin_charge_cancel', 'fin_charge_adjust', 'fin_payment_reverse', 'fin_receipt_reject', 'fin_entry_create') then
    return conv_private.ai_confirm_pendency_step(p_proposal, p_message);
  end if;
  if bp.status = 'confirmed' then return jsonb_build_object('ok', true, 'replayed', true, 'action', bp.action, 'summary', bp.payload); end if;
  if bp.status <> 'open' then return conv_private.vfail('PROPOSAL_CLOSED', 'Essa proposta não está mais aberta.'); end if;
  if bp.expires_at <= now() then
    update public.conv_booking_proposals set status = 'expired' where id = bp.id;
    return conv_private.vfail('PROPOSAL_EXPIRED', 'A proposta venceu. Posso montar outra.');
  end if;
  select * into m from public.conv_messages where id = p_message and direction = 'inbound' and conversation_id = bp.conversation_id;
  if not found or m.created_at <= bp.created_at then
    return conv_private.vfail('CONFIRMATION_NOT_AFTER_PROPOSAL', 'A confirmação precisa vir depois da proposta.');
  end if;
  if m.kind <> 'text' or not (conv_private.is_confirmation(m.body) or conv_private.is_semantic_acceptance(m.body, false)) then
    return conv_private.vfail('NOT_EXPLICIT', 'Não entendi como confirmação clara.');
  end if;
  if m.sender_contact_id is distinct from bp.requester_contact_id then
    return conv_private.vfail('NOT_AUTHORIZED_TO_CONFIRM', 'Só o administrador que pediu pode confirmar.');
  end if;
  v_admin := conv_private.ai_admin_requester(bp.session_id);
  if v_admin is null or v_admin <> bp.requester_profile_id then
    update public.conv_booking_proposals set status = 'failed', failure_code = 'ADMIN_ONLY_PRIVATE' where id = bp.id;
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;

  if bp.action = 'fin_entry_create' and bp.payload ? 'settles_entry_id' then
    select * into v_settle from public.fin_entries where id = (bp.payload->>'settles_entry_id')::uuid;
    if v_settle.id is null or v_settle.status <> 'pending' or v_settle.amount_cents <> (bp.payload->>'amount_cents')::bigint then
      update public.conv_booking_proposals set status = 'failed', failure_code = 'ENTRY_NOT_PENDING' where id = bp.id;
      return conv_private.vfail('ENTRY_NOT_PENDING', 'A conta ' || coalesce(bp.payload->>'settles_description', '')
        || ' não está mais pendente com esse valor (alguém deu baixa ou mudou). Não lancei nada para não duplicar. Quer que eu confira?');
    end if;
  end if;

  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    if bp.action = 'fin_charge_cancel' then
      v_res := public.fin_cancel_charge(bp.request_key, (bp.payload->>'charge_id')::uuid, bp.payload->>'reason');
    elsif bp.action = 'fin_charge_adjust' then
      v_res := public.fin_adjust_charge(bp.request_key, (bp.payload->>'charge_id')::uuid, bp.payload->>'adjust_kind',
        (bp.payload->>'amount_cents')::bigint, bp.payload->>'reason');
    elsif bp.action = 'fin_payment_reverse' then
      v_res := public.fin_reverse_payment(bp.request_key, (bp.payload->>'payment_id')::uuid, bp.payload->>'reason');
    elsif bp.action = 'fin_receipt_reject' then
      v_res := public.fin_reject_receipt(bp.request_key, (bp.payload->>'submission_id')::uuid, bp.payload->>'reason');
    elsif v_settle.id is not null then
      v_res := public.fin_pay_entry(bp.request_key, v_settle.id, v_settle.version, jsonb_strip_nulls(jsonb_build_object(
        'amount_cents', (bp.payload->>'amount_cents')::bigint, 'paid_on', bp.payload->>'paid_on', 'account_id', bp.payload->>'account_id',
        'settle', true, 'note', 'Comprovante pelo WhatsApp: ' || coalesce(bp.payload->>'description', ''))));
    else
      v_cat := nullif(bp.payload->>'category_id', '');
      if v_cat is null and coalesce((bp.payload->>'category_new')::boolean, false) then
        v_res := public.fin_save_category(md5(bp.id::text || 'category')::uuid, null, null, jsonb_build_object(
          'kind', bp.payload->>'entry_kind', 'parent_id', bp.payload->>'category_parent_id', 'name', bp.payload->>'category_name'));
        v_cat := v_res->>'id';
        bp.payload := bp.payload || jsonb_build_object('category_id', v_cat);
      end if;
      v_res := public.fin_create_entry(bp.request_key, jsonb_strip_nulls(jsonb_build_object(
        'kind', bp.payload->>'entry_kind', 'description', bp.payload->>'description', 'amount_cents', (bp.payload->>'amount_cents')::bigint,
        'status', bp.payload->>'entry_status', 'due_date', bp.payload->>'due_date', 'paid_on', bp.payload->>'paid_on',
        'account_id', bp.payload->>'account_id', 'category_id', v_cat, 'supplier', bp.payload->>'supplier')));
    end if;
  exception when others then
    v_err := sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'FINANCE_FAILED' end;
    update public.conv_booking_proposals set status = 'failed', failure_code = v_code where id = bp.id;
    return conv_private.vfail(v_code, 'O financeiro recusou: ' || v_code || '.');
  end if;

  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = m.id,
    confirmed_by_contact_id = m.sender_contact_id, payload = bp.payload || jsonb_build_object('result', v_res) where id = bp.id;
  perform conv_private.audit('ai_admin_finance', 'fin_member_charges', coalesce(v_res->>'id', bp.payload->>'charge_id', bp.payload->>'submission_id'), null,
    jsonb_build_object('action', bp.action, 'amount_cents', bp.payload->'amount_cents', 'reason', bp.payload->'reason',
      'settles_entry_id', bp.payload->'settles_entry_id'),
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id),
    bp.requester_profile_id);
  -- Receita de inscrição do campeonato: confirma a pré-inscrição do atleta (nunca derruba o lançamento já feito).
  if bp.action = 'fin_entry_create' and bp.payload->>'entry_kind' = 'revenue' then
    begin
      v_champ := conv_private.champ_confirm_from_entry((v_res->>'id')::uuid, v_admin);
    exception when others then
      v_champ := jsonb_build_object('reason', 'FAILED', 'error', left(sqlerrm, 120));
    end;
  end if;
  return jsonb_build_object('ok', true, 'action', bp.action,
    'summary', bp.payload || jsonb_build_object('result', v_res) || jsonb_strip_nulls(jsonb_build_object('championship', v_champ)));
end $function$;

-- Rollback: drop function conv_private.ai_admin_finance_propose(uuid, jsonb);
-- alter function conv_private.ai_admin_finance_propose_w7(uuid, jsonb) rename to ai_admin_finance_propose;
-- reaplicar conv_private.ai_confirm_wave2_step de 20261030160000_joao_inscricao_pelo_caixa.sql;
-- drop function conv_private.pending_entry_match(text, bigint, date).
