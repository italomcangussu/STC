-- Comprovante do administrador vira anexo do lançamento que o João cria (despesa ou receita).
-- Antes, a imagem mandada no WhatsApp ficava como intenção "aguardando finalidade" para sempre e o lançamento nascia
-- sem anexo (todas as despesas de 09 a 18/10 do Henrique). A intenção pendurada também capturava conversas seguintes.
-- Regra: a proposta de lançamento leva o comprovante que o MESMO administrador mandou nesta conversa nas últimas 6 h,
-- ainda sem destino e com o MESMO valor lido pelo OCR. Valor diferente ou não lido: lança sem anexo, como antes.
-- Na confirmação, um gatilho anexa o arquivo (que continua no bucket fin-receipts, sem cópia) e encerra a intenção.
-- Falha ao anexar nunca desfaz o lançamento já confirmado.

-- 1) anexo sabe em que bucket está o arquivo (os enviados pelo painel seguem em fin-docs)
alter table public.fin_attachments add column if not exists bucket text not null default 'fin-docs';
alter table public.fin_attachments add constraint fin_attachments_bucket_check check (bucket in ('fin-docs', 'fin-receipts'));

-- 2) comprovante do administrador que casa com o valor do lançamento
create or replace function conv_private.admin_entry_receipt(p_conversation uuid, p_admin uuid, p_amount bigint)
returns table(id uuid, file_name text)
language sql stable security definer set search_path = '' as $$
  select i.id, coalesce(nullif(i.original_data->>'file_name', ''), 'comprovante')
  from fin_private.whatsapp_receipt_intents i
  where i.conversation_id = p_conversation and i.profile_id = p_admin
    and i.status in ('awaiting_purpose', 'awaiting_confirmation')
    and i.finance_entry_id is null and i.finance_submission_id is null
    and i.created_at > now() - interval '6 hours'
    and nullif(i.original_data->>'declared_amount_cents', '')::bigint = p_amount
  order by i.created_at desc, i.id desc limit 1
$$;

create or replace function conv_private.ai_admin_finance_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_conversation uuid; v_receipt record;
begin
  r := conv_private.ai_admin_finance_propose_w6(p_session, p);
  if coalesce(p->>'action', '') <> 'fin_entry_create' or not coalesce((r->>'ok')::boolean, false) then return r; end if;
  select conversation_id into v_conversation from public.conv_ai_sessions where id = p_session;
  select * into v_receipt from conv_private.admin_entry_receipt(v_conversation, conv_private.ai_admin_requester(p_session),
    nullif(r->'summary'->>'amount_cents', '')::bigint);
  if v_receipt.id is null then return r; end if;
  update public.conv_booking_proposals
     set payload = payload || jsonb_build_object('receipt_id', v_receipt.id, 'receipt_file', v_receipt.file_name)
   where id = (r->>'proposal_id')::uuid;
  return r || jsonb_build_object('summary', r->'summary' || jsonb_build_object('receipt_id', v_receipt.id, 'receipt_file', v_receipt.file_name));
end $$;

-- 3) na confirmação: anexa e encerra a intenção
create or replace function conv_private.attach_receipt_to_entry(p_receipt uuid, p_entry uuid, p_admin uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s fin_private.whatsapp_receipt_intents%rowtype; d jsonb; e public.fin_entries%rowtype;
begin
  select * into s from fin_private.whatsapp_receipt_intents where id = p_receipt and profile_id = p_admin for update;
  select * into e from public.fin_entries where id = p_entry;
  if s.id is null or e.id is null or s.finance_entry_id is not null or s.status not in ('awaiting_purpose', 'awaiting_confirmation') then
    return false;
  end if;
  d := s.original_data;
  insert into public.fin_attachments(entry_id, storage_path, bucket, file_name, content_type, size_bytes, uploaded_by)
  values (e.id, d->>'storage_path', 'fin-receipts', left(coalesce(nullif(d->>'file_name', ''), 'comprovante'), 200),
    d->>'content_type', (d->>'size_bytes')::integer, p_admin)
  on conflict (storage_path) do nothing;
  update fin_private.whatsapp_receipt_intents
     set status = 'confirmed', purpose_kind = 'other', purpose_detail = left(e.description, 200),
         finance_entry_id = e.id, updated_at = now()
   where id = s.id;
  return true;
end $$;

create or replace function conv_private.trg_entry_proposal_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform conv_private.attach_receipt_to_entry((new.payload->>'receipt_id')::uuid,
      (new.payload->'result'->>'id')::uuid, new.requester_profile_id);
  exception when others then
    raise warning 'attach_receipt_to_entry falhou (proposta %): %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_entry_proposal_receipt on public.conv_booking_proposals;
create trigger trg_entry_proposal_receipt
after update of status on public.conv_booking_proposals
for each row
when (new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.action = 'fin_entry_create'
      and new.payload ? 'receipt_id')
execute function conv_private.trg_entry_proposal_receipt();

revoke all on function conv_private.admin_entry_receipt(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function conv_private.attach_receipt_to_entry(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.trg_entry_proposal_receipt() from public, anon, authenticated;
revoke all on function conv_private.ai_admin_finance_propose(uuid, jsonb) from public, anon, authenticated, service_role;
