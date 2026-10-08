-- Baixa automática por comprovante: o CNPJ do favorecido igual à chave Pix (CNPJ) do clube dispensa a conferência do nome.
-- Mascarado vale com 8+ dígitos visíveis, todos batendo na mesma posição. Só CNPJ é lido (nunca CPF nem dados do pagador).

CREATE OR REPLACE FUNCTION fin_private.cnpj_matches(p_read text, p_key text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    length(t.r)=14 and length(t.k)=14 and length(replace(t.r,'*',''))>=8
    and not exists (select 1 from generate_series(1,14) i where substr(t.r,i,1)<>'*' and substr(t.r,i,1)<>substr(t.k,i,1)),
    false)
  from (select regexp_replace(coalesce(p_read,''),'[^0-9*]','','g') r, regexp_replace(coalesce(p_key,''),'\D','','g') k) t
$function$;

revoke all on function fin_private.cnpj_matches(text,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION fin_private.auto_approve_pendency_receipt(p_submission uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.fin_receipt_submissions%rowtype; fs public.fin_settings%rowtype; v_ids uuid[]; v_count integer; v_open_count integer;
  v_amount bigint; v_paid_on date; v_ocr_amount bigint; v_ocr_date date; v_payee text;
  v_conf_amount text; v_conf_date text; v_conf_payee text; v_identifier text; v_account uuid;
  v_remaining bigint; v_alloc bigint; r record; v_res jsonb; v_pay_ids uuid[]:='{}';
  v_duplicate boolean; v_doc_ok boolean; v_total_paid bigint:=0;
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
  if v_conf_amount is distinct from 'high' or v_conf_date is distinct from 'high' then return jsonb_build_object('approved',false,'reason','LOW_CONFIDENCE'); end if;
  if v_amount<>v_ocr_amount then return jsonb_build_object('approved',false,'reason','AMOUNT_MISMATCH'); end if;
  if v_paid_on<>v_ocr_date then return jsonb_build_object('approved',false,'reason','DATE_MISMATCH'); end if;

  select * into fs from public.fin_settings where id;
  -- O CNPJ do favorecido igual à chave Pix do clube basta; sem ele, vale o nome (palavras inteiras).
  v_doc_ok:=fin_private.cnpj_matches(nullif(trim(s.ocr->>'payee_document'),''),fs.pix_key);
  if not v_doc_ok then
    if cardinality(coalesce(fs.payee_names,'{}'))=0 then return jsonb_build_object('approved',false,'reason','PAYEE_NOT_CONFIGURED'); end if;
    if v_payee is null or v_conf_payee is distinct from 'high' then return jsonb_build_object('approved',false,'reason','PAYEE_NOT_CONFIRMED'); end if;
    if not fin_private.payee_matches(v_payee,fs.payee_names) then return jsonb_build_object('approved',false,'reason','PAYEE_MISMATCH'); end if;
  end if;

  select coalesce(array_agg(rc.charge_id),'{}'),count(*)
    into v_ids,v_count from public.fin_receipt_charges rc where rc.submission_id=p_submission;
  if v_count=0 then return jsonb_build_object('approved',false,'reason','NO_CHARGES_SELECTED'); end if;

  -- Mensalidade e pendência do próprio sócio, ainda em aberto.
  select count(*) into v_open_count
  from public.fin_member_charges c
  where c.id=any(v_ids) and c.profile_id=s.profile_id
    and c.charge_type in ('membership','member_pendency')
    and c.status in ('open','partial');
  if v_open_count<>v_count then return jsonb_build_object('approved',false,'reason','NOT_ONLY_OPEN_CHARGES'); end if;

  select exists(
    select 1 from public.fin_receipt_submissions o
    where o.id<>s.id and o.profile_id=s.profile_id and o.status in ('submitted','in_review','approved')
      and (
        (v_identifier is not null and nullif(trim(o.ocr->>'identifier'),'')=v_identifier)
        or (o.declared_amount_cents=v_amount and o.declared_paid_on=v_paid_on)
      )
  ) into v_duplicate;
  if v_duplicate then return jsonb_build_object('approved',false,'reason','DUPLICATE_FIELDS'); end if;

  -- Mesmo valor e data já pagos por outro caminho (ex.: baixa manual do administrador).
  if exists(
    select 1 from fin_private.charge_payments_effective p
    join public.fin_member_charges c on c.id=p.charge_id
    where c.profile_id=s.profile_id and p.method<>'credit'
      and p.amount_cents=v_amount and p.paid_on=v_paid_on
      and p.submission_id is distinct from s.id
  ) then return jsonb_build_object('approved',false,'reason','DUPLICATE_PAYMENT'); end if;

  select id into v_account from public.fin_accounts where is_default_receipts and active order by position,id limit 1;
  if v_account is null then return jsonb_build_object('approved',false,'reason','DEFAULT_ACCOUNT_MISSING'); end if;

  begin
    v_remaining:=v_amount;
    for r in
      select z.*
      from (
        select cr.*,
          row_number() over(order by (cr.due_date>=v_paid_on),cr.due_date,cr.charge_id) rn,
          count(*) over() n
        from fin_private.charge_rows(s.profile_id,v_ids,'{}'::jsonb,v_paid_on,1000,0) cr
        join public.fin_member_charges c on c.id=cr.charge_id
        where cr.stored_status in ('open','partial') and cr.total_due_cents>0
      ) z
      order by z.rn
    loop
      exit when v_remaining<=0;
      -- A última cobrança recebe o resto: o motor transforma o excedente em crédito do sócio.
      v_alloc:=case when r.rn=r.n then v_remaining else least(v_remaining,r.total_due_cents) end;
      v_res:=fin_private.apply_payment(r.charge_id,v_alloc,v_paid_on,'pix',v_account,p_submission,null,
        'Baixa automática por comprovante OCR',gen_random_uuid());
      v_pay_ids:=v_pay_ids||(v_res->>'payment_id')::uuid;
      v_total_paid:=v_total_paid+v_alloc;
      v_remaining:=v_remaining-v_alloc;
    end loop;
  exception when others then
    -- Desfaz só os pagamentos deste bloco; o comprovante fica para análise.
    return jsonb_build_object('approved',false,'reason','PAYMENT_REJECTED');
  end;

  if cardinality(v_pay_ids)=0 then return jsonb_build_object('approved',false,'reason','NO_OPEN_BALANCE'); end if;

  update public.fin_receipt_submissions
  set status='approved',reviewed_by=null,reviewed_at=now(),
      decision_reason='Baixa automática: OCR com alta confiança e dados conferidos',
      approved_payment_ids=v_pay_ids,version=version+1,updated_at=now()
  where id=p_submission;

  return jsonb_build_object('approved',true,'status','approved','payment_ids',to_jsonb(v_pay_ids),'total_cents',v_total_paid);
end $function$;
