-- Admin que também é sócio manda só a imagem do Pix da própria mensalidade: o João perguntava "de qual aluno é o Card".
-- A leitura do comprovante passa a dizer qual mensalidade em aberto dele bate com o valor (cheio ou com o abatimento),
-- para o João perguntar "É a sua mensalidade de 11/2026?". Só pergunta: a baixa continua exigindo que ele confirme.

create or replace function conv_private.ai_admin_own_membership_hint(p_admin uuid, p_amount bigint, p_paid_on date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then jsonb_build_object('competence_month', min(c.competence_month), 'total_due_cents', min(st.total_due),
    'offset_cents', min(fin_private.member_offset_cents(c.id))) end
  from public.fin_member_charges c cross join lateral fin_private.charge_statement(c.id, p_paid_on) st
  where c.profile_id = p_admin and c.charge_type = 'membership' and c.status in ('open', 'partial')
    and c.competence_month <= date_trunc('month', p_paid_on)::date
    and (st.total_due = p_amount or st.total_due - fin_private.member_offset_cents(c.id) = p_amount)
$$;
revoke all on function conv_private.ai_admin_own_membership_hint(uuid, bigint, date) from public, anon, authenticated;

create or replace function public.conv_svc_ai_admin_receipt(p_session uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_admin uuid; v_intent uuid; v_amount bigint; v_paid_on date; v_n int; v_entry uuid; v_desc text; v_on date; v_own jsonb;
begin
  r := conv_private.ai_admin_receipt(p_session, p_message);
  if not coalesce((r->>'found')::boolean, false) or r->>'status' <> 'staged' or coalesce((r->>'duplicate')::boolean, false) then
    return r;
  end if;
  v_amount := nullif(r->>'amount_cents', '')::bigint;
  v_paid_on := nullif(r->>'paid_on', '')::date;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_amount is null or v_paid_on is null or v_admin is null then return r; end if;
  if (r->>'payee_ok')::boolean is distinct from false then
    v_own := conv_private.ai_admin_own_membership_hint(v_admin, v_amount, v_paid_on);
    return case when v_own is null then r else r || jsonb_build_object('own_membership', v_own) end;
  end if;
  select i.id into v_intent from fin_private.whatsapp_receipt_intents i
   where i.source_message_id = p_message and i.profile_id = v_admin and i.status = 'awaiting_purpose' and i.finance_entry_id is null;
  if v_intent is null then return r; end if;
  select count(*), min(e.id::text)::uuid into v_n, v_entry
  from public.fin_entries e join public.fin_entry_payments x on x.entry_id = e.id and x.kind = 'payment'
  where e.kind = 'expense' and e.status = 'paid' and e.amount_cents = v_amount
    and x.paid_on between v_paid_on - 3 and v_paid_on + 3
    and not exists (select 1 from public.fin_attachments f where f.entry_id = e.id)
    and not exists (select 1 from fin_private.cash_removed d where d.source_type = 'entry_payment' and d.source_id = x.id::text);
  if v_n <> 1 then return r; end if;
  if not conv_private.attach_receipt_to_entry(v_intent, v_entry, v_admin) then return r; end if;
  select e.description, max(x.paid_on) into v_desc, v_on from public.fin_entries e join public.fin_entry_payments x on x.entry_id = e.id
   where e.id = v_entry group by e.description;
  return r || jsonb_build_object('attached_entry', jsonb_build_object('id', v_entry, 'description', v_desc, 'paid_on', v_on));
end $$;
revoke all on function public.conv_svc_ai_admin_receipt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_receipt(uuid, uuid) to service_role;
