-- Comprovante do sócio que paga em dia (ou adiantado) também tem baixa automática e sempre tem resposta.
--
-- * As mensalidades eram geradas só quando o administrador clicava em "gerar": um sócio pagando em dia
--   podia não ter a cobrança do mês criada ainda. Agora:
--     - todo dia, as mensalidades dos planos ativos são geradas até o horizonte configurado (pg_cron);
--     - ao chegar um comprovante pelo WhatsApp, as do próprio sócio são geradas na hora;
--     - se mesmo assim não houver nada em aberto (sócio já pagou tudo o que existe), é gerada a PRÓXIMA
--       mensalidade do plano, para receber o pagamento adiantado.
-- * Sem cobrança nenhuma (sócio sem plano e sem pendência), o comprovante legível é registrado para
--   análise e o sócio recebe o aviso — não fica mais sem resposta.
-- * Proteção extra contra pagar duas vezes: se já existe pagamento do sócio com o mesmo valor e a mesma
--   data (inclusive lançado à mão pelo administrador), não há baixa automática.

-- Gera as mensalidades do sócio até o horizonte; com p_extend e nada em aberto, gera a próxima.
CREATE OR REPLACE FUNCTION fin_private.ensure_member_charges(p_profile uuid, p_extend boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pl public.fin_member_plans%rowtype; fs public.fin_settings%rowtype; v_next date; v_before integer; v_after integer;
begin
  select count(*) into v_before from public.fin_member_charges where profile_id=p_profile;
  for pl in select * from public.fin_member_plans where profile_id=p_profile and status='active' order by created_at loop
    perform fin_private.generate_charges(pl.id,fin_private.today());
  end loop;

  if p_extend and not exists(
    select 1 from public.fin_member_charges c
    cross join lateral fin_private.charge_statement(c.id,fin_private.today()) st
    where c.profile_id=p_profile and c.status in ('open','partial') and st.total_due>0
  ) then
    select * into fs from public.fin_settings where id;
    for pl in select * from public.fin_member_plans where profile_id=p_profile and status='active' order by created_at loop
      select coalesce((max(c.competence_month)+make_interval(months=>pl.period_months))::date,
                      date_trunc('month',pl.start_on::timestamp)::date)
        into v_next from public.fin_member_charges c where c.plan_id=pl.id;
      if pl.ended_on is null or v_next<=pl.ended_on then
        -- generate_charges vai até mês(p_today)+horizonte: este p_today faz o limite cair na próxima competência.
        perform fin_private.generate_charges(pl.id,(v_next-make_interval(months=>fs.horizon_months))::date);
      end if;
    end loop;
  end if;

  select count(*) into v_after from public.fin_member_charges where profile_id=p_profile;
  return v_after-v_before;
end $function$;

-- Pagamento já registrado (comprovante ou lançamento manual) com o mesmo valor e data.
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
  v_duplicate boolean; v_total_paid bigint:=0;
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
  if cardinality(coalesce(fs.payee_names,'{}'))=0 then return jsonb_build_object('approved',false,'reason','PAYEE_NOT_CONFIGURED'); end if;
  if v_payee is null or v_conf_payee is distinct from 'high' then return jsonb_build_object('approved',false,'reason','PAYEE_NOT_CONFIRMED'); end if;
  if not fin_private.payee_matches(v_payee,fs.payee_names) then return jsonb_build_object('approved',false,'reason','PAYEE_MISMATCH'); end if;

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

CREATE OR REPLACE FUNCTION public.fin_submit_whatsapp_pendency_receipt(p_message uuid, p_submission uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text:=coalesce(auth.role(),'');
  v_profile uuid; v_media text; v_mime text; v_name text; v_existing uuid; v_ids uuid[];
  v_amount bigint; v_paid_on date; v_ocr jsonb; v_auto jsonb; v_hash text; v_size bigint; v_review_notice uuid;
  v_ocr_status text; v_generated integer;
begin
  if v_role <> 'service_role' then raise exception 'FORBIDDEN'; end if;

  select ct.profile_id,m.media_path,m.media_mime,coalesce(m.media_name,'comprovante')
    into v_profile,v_media,v_mime,v_name
  from public.conv_messages m
  join public.conv_conversations cv on cv.id=m.conversation_id and cv.kind='direct'
  join public.conv_contacts ct on ct.id=cv.contact_id
  where m.id=p_message and m.direction='inbound'
    and m.media_path is not null
    and ct.profile_id is not null
    and ct.link_status in ('linked','manual');
  if not found then raise exception 'WHATSAPP_RECEIPT_NOT_ELIGIBLE'; end if;

  select id into v_existing from public.fin_receipt_submissions where source_message_id=p_message;
  if v_existing is not null then
    return jsonb_build_object('id',v_existing,'duplicate',true,
      'status',(select status from public.fin_receipt_submissions where id=v_existing));
  end if;

  v_ocr_status:=coalesce(nullif(p_data->>'ocr_status',''),'not_run');
  -- Só gera mensalidade (inclusive a próxima, para pagamento adiantado) se o arquivo parece mesmo um comprovante.
  v_generated:=fin_private.ensure_member_charges(v_profile,v_ocr_status='ok');

  -- Mensalidades e pendências em aberto, da mais antiga para a mais nova.
  select coalesce(array_agg(c.id order by (c.due_date>=fin_private.today()),c.due_date,c.id),'{}')
    into v_ids
  from public.fin_member_charges c
  cross join lateral fin_private.charge_statement(c.id,fin_private.today()) st
  where c.profile_id=v_profile and c.charge_type in ('membership','member_pendency')
    and c.status in ('open','partial') and st.total_due>0;
  -- Nada em aberto e nada legível: provavelmente não é comprovante (foto qualquer).
  if cardinality(v_ids)=0 and v_ocr_status<>'ok' then
    return jsonb_build_object('skipped',true,'reason','NO_OPEN_CHARGES');
  end if;

  v_amount:=nullif(p_data->>'declared_amount_cents','')::bigint;
  v_paid_on:=nullif(p_data->>'declared_paid_on','')::date;
  v_ocr:=p_data->'ocr';
  v_hash:=lower(coalesce(p_data->>'content_sha256',''));
  v_size:=coalesce(nullif(p_data->>'size_bytes','')::bigint,0);

  if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_HASH'; end if;
  if v_size<=0 or v_size>10485760 then raise exception 'INVALID_SIZE'; end if;
  if coalesce(p_data->>'storage_path','')='' then raise exception 'INVALID_STORAGE_PATH'; end if;

  insert into public.fin_receipt_submissions(
    id,profile_id,status,storage_path,file_name,content_type,size_bytes,content_sha256,
    declared_amount_cents,declared_paid_on,declared_reference,member_note,
    ocr_status,ocr,possible_duplicate,request_id,source,source_message_id,created_at,updated_at
  ) values(
    p_submission,v_profile,'submitted',p_data->>'storage_path',
    coalesce(nullif(p_data->>'file_name',''),v_name),
    coalesce(nullif(p_data->>'content_type',''),v_mime,'application/octet-stream'),
    v_size,v_hash,v_amount,v_paid_on,nullif(p_data->>'declared_reference',''),
    'Comprovante recebido pelo WhatsApp institucional',
    v_ocr_status,v_ocr,false,p_submission,'whatsapp',p_message,now(),now()
  );

  insert into public.fin_receipt_charges(submission_id,charge_id)
  select p_submission,unnest(v_ids);

  update public.fin_receipt_submissions s set possible_duplicate=exists(
    select 1 from public.fin_receipt_submissions o
    where o.id<>s.id and o.profile_id=s.profile_id and o.content_sha256=s.content_sha256
  ) where s.id=p_submission;

  v_auto:=fin_private.auto_approve_pendency_receipt(p_submission);

  if not coalesce((v_auto->>'approved')::boolean,false) then
    v_review_notice:=conv_private.queue_pendency_receipt_review_notice(v_profile,p_submission);
  end if;

  return jsonb_build_object(
    'id',p_submission,
    'duplicate',false,
    'status',(select status from public.fin_receipt_submissions where id=p_submission),
    'auto_approved',coalesce((v_auto->>'approved')::boolean,false),
    'auto_reason',v_auto->>'reason',
    'profile_id',v_profile,
    'charge_ids',to_jsonb(v_ids),
    'generated_charges',v_generated,
    'payment_ids',coalesce(v_auto->'payment_ids','[]'::jsonb),
    'review_notice_recipient_id',v_review_notice
  );
end $function$;

revoke all on function fin_private.ensure_member_charges(uuid,boolean) from public,anon,authenticated;
revoke all on function fin_private.auto_approve_pendency_receipt(uuid) from public,anon,authenticated;
revoke all on function public.fin_submit_whatsapp_pendency_receipt(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fin_submit_whatsapp_pendency_receipt(uuid,uuid,jsonb) to service_role;

-- Geração diária das mensalidades (06:00 em Fortaleza). Idempotente: o que já existe não muda.
do $$
begin
  if exists (select 1 from pg_namespace where nspname='cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='fin-generate-member-charges';
    perform cron.schedule('fin-generate-member-charges','0 9 * * *',
      'select fin_private.generate_charges(null, fin_private.today())');
  end if;
end $$;
