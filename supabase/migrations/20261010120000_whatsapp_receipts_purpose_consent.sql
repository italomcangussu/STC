-- STC: comprovante pelo WhatsApp NUNCA vira cobrança/receita por OCR.
-- Estado privado da conversa; o arquivo permanece disponível, mas não entra no livro-caixa sem consentimento.
create table if not exists fin_private.whatsapp_receipt_intents (
  id uuid primary key,
  source_message_id uuid not null unique references public.conv_messages(id),
  conversation_id uuid not null references public.conv_conversations(id),
  profile_id uuid references public.profiles(id),
  contact_id uuid not null references public.conv_contacts(id),
  original_data jsonb not null,
  status text not null default 'awaiting_purpose' check (status in ('awaiting_purpose','awaiting_confirmation','confirmed','needs_review','canceled')),
  purpose_kind text check (purpose_kind in ('donation','membership','member_pendency','student_card','day_card','other')),
  purpose_detail text,
  purpose_message_id uuid references public.conv_messages(id),
  confirmation_message_id uuid references public.conv_messages(id),
  finance_entry_id uuid references public.fin_entries(id),
  finance_submission_id uuid references public.fin_receipt_submissions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_receipt_intents_pending_idx
  on fin_private.whatsapp_receipt_intents(conversation_id,created_at)
  where status in ('awaiting_purpose','awaiting_confirmation');
revoke all on fin_private.whatsapp_receipt_intents from public,anon,authenticated;

-- Este RPC anteriormente vinculava TODOS os comprovantes a mensalidades e podia dar baixa.
-- Agora somente guarda uma intenção a esclarecer, sem criar fin_receipt_submissions, fin_charge_payments ou fin_entries.
create or replace function public.fin_submit_whatsapp_pendency_receipt(p_message uuid,p_submission uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_conv uuid; v_contact uuid; v_profile uuid; v_existing uuid; v_status text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'FORBIDDEN'; end if;
  select m.conversation_id,cv.contact_id,ct.profile_id
    into v_conv,v_contact,v_profile
  from public.conv_messages m
  join public.conv_conversations cv on cv.id=m.conversation_id and cv.kind='direct'
  join public.conv_contacts ct on ct.id=cv.contact_id
  where m.id=p_message and m.direction='inbound' and m.kind in ('image','document')
    and m.media_path is not null;
  if v_conv is null then return jsonb_build_object('skipped',true,'reason','NOT_ELIGIBLE_DIRECT_RECEIPT'); end if;
  if coalesce(p_data->>'storage_path','')='' or
     coalesce(p_data->>'content_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(nullif(p_data->>'size_bytes','')::bigint,0) not between 1 and 10485760 then
    raise exception 'INVALID_STAGED_RECEIPT';
  end if;
  insert into fin_private.whatsapp_receipt_intents
    (id,source_message_id,conversation_id,profile_id,contact_id,original_data)
  values(p_submission,p_message,v_conv,v_profile,v_contact,p_data)
  on conflict(source_message_id) do nothing;
  select id,status into v_existing,v_status
    from fin_private.whatsapp_receipt_intents where source_message_id=p_message;
  return jsonb_build_object('staged',true,'id',v_existing,'status',v_status,'requires_user_confirmation',true,
    'auto_approved',false,'payment_ids','[]'::jsonb);
end $$;
revoke all on function public.fin_submit_whatsapp_pendency_receipt(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fin_submit_whatsapp_pendency_receipt(uuid,uuid,jsonb) to service_role;

-- O João só consulta intenções de chats diretos, nunca de outro grupo ou sócio.
create or replace function public.conv_svc_receipt_stage(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s fin_private.whatsapp_receipt_intents%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents
  where conversation_id=p_conversation and status in ('awaiting_purpose','awaiting_confirmation')
  order by created_at,id limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',s.id,'source_message_id',s.source_message_id,'status',s.status,
    'purpose_kind',s.purpose_kind,'purpose_detail',s.purpose_detail,
    'amount_cents',s.original_data->>'declared_amount_cents',
    'paid_on',s.original_data->>'declared_paid_on',
    'ocr_status',s.original_data->>'ocr_status','payee',s.original_data->'ocr'->>'payee',
    'created_at',s.created_at);
end $$;
revoke all on function public.conv_svc_receipt_stage(uuid) from public,anon,authenticated;
grant execute on function public.conv_svc_receipt_stage(uuid) to service_role;

create or replace function public.conv_svc_receipt_purpose(
  p_stage uuid,p_message uuid,p_kind text,p_detail text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s fin_private.whatsapp_receipt_intents%rowtype; m public.conv_messages%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents where id=p_stage for update;
  select * into m from public.conv_messages where id=p_message;
  if s.id is null or s.status<>'awaiting_purpose'
    or m.id is null or m.conversation_id<>s.conversation_id or m.direction<>'inbound'
    or m.kind<>'text' or m.created_at<(select created_at from public.conv_messages where id=s.source_message_id) then
    return jsonb_build_object('ok',false,'code','INTENT_NOT_ELIGIBLE');
  end if;
  if p_kind not in ('donation','membership','member_pendency','student_card','day_card','other')
    or length(trim(coalesce(p_detail,'')))<3 then
    return jsonb_build_object('ok',false,'code','PURPOSE_UNCLEAR');
  end if;
  update fin_private.whatsapp_receipt_intents
    set purpose_kind=p_kind,purpose_detail=left(trim(p_detail),240),purpose_message_id=p_message,
      status='awaiting_confirmation',updated_at=now()
  where id=p_stage;
  return jsonb_build_object('ok',true,'status','awaiting_confirmation');
end $$;
revoke all on function public.conv_svc_receipt_purpose(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.conv_svc_receipt_purpose(uuid,uuid,text,text) to service_role;

create or replace function public.conv_svc_receipt_revise(p_stage uuid,p_message uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s fin_private.whatsapp_receipt_intents%rowtype; m public.conv_messages%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents where id=p_stage for update;
  select * into m from public.conv_messages where id=p_message;
  if s.id is null or s.status<>'awaiting_confirmation' or m.id is null
    or m.conversation_id<>s.conversation_id or m.direction<>'inbound'
    or m.created_at<=(select created_at from public.conv_messages where id=s.purpose_message_id) then
    return jsonb_build_object('ok',false,'code','REVISION_NOT_ELIGIBLE');
  end if;
  update fin_private.whatsapp_receipt_intents
    set status='awaiting_purpose',purpose_kind=null,purpose_detail=null,purpose_message_id=null,updated_at=now()
  where id=p_stage;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.conv_svc_receipt_revise(uuid,uuid) from public,anon,authenticated;
grant execute on function public.conv_svc_receipt_revise(uuid,uuid) to service_role;

-- Recebimento comprovado: registra somente depois de descrição da finalidade + "sim" do MESMO chat
-- em uma mensagem posterior. Nenhum pagamento é quitado só pela imagem/consentimento.
create or replace function public.conv_svc_receipt_confirm(p_stage uuid,p_message uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s fin_private.whatsapp_receipt_intents%rowtype; m public.conv_messages%rowtype;
  d jsonb; v_amount bigint; v_date date; v_cat uuid; v_entry uuid; v_submission uuid;
  v_hash text; v_dupe boolean; v_count integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into s from fin_private.whatsapp_receipt_intents where id=p_stage for update;
  select * into m from public.conv_messages where id=p_message;
  if s.id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if s.status='confirmed' or s.status='needs_review' then
    return jsonb_build_object('ok',true,'replayed',true,'status',s.status,'finance_entry_id',s.finance_entry_id,'finance_submission_id',s.finance_submission_id);
  end if;
  if s.status<>'awaiting_confirmation' or m.id is null or m.direction<>'inbound'
    or m.conversation_id<>s.conversation_id or m.kind<>'text'
    or m.created_at<=(select created_at from public.conv_messages where id=s.purpose_message_id)
    or trim(coalesce(m.body,'')) !~* '^(sim|confirmo|confirmado|pode registrar|pode lancar|pode lançar|isso mesmo|correto|exatamente|certo|ok)[[:punct:][:space:]]*$'
  then return jsonb_build_object('ok',false,'code','EXPLICIT_CONFIRMATION_REQUIRED');
  end if;
  d:=s.original_data;
  v_amount:=nullif(d->>'declared_amount_cents','')::bigint;
  v_date:=nullif(d->>'declared_paid_on','')::date;
  v_hash:=lower(coalesce(d->>'content_sha256',''));
  if v_amount is null or v_amount<=0 or v_date is null or v_date>(now() at time zone 'America/Fortaleza')::date
    or v_hash !~ '^[0-9a-f]{64}$' then
    update fin_private.whatsapp_receipt_intents set status='needs_review',
      confirmation_message_id=p_message,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'status','needs_review','reason','PAYMENT_DATA_MISSING');
  end if;
  -- Hash + valor + data não podem contar duas vezes nem em mensalidade nem em doação.
  select exists(
    select 1 from fin_private.whatsapp_receipt_intents other
    where other.id<>s.id and other.original_data->>'content_sha256'=v_hash
      and other.status in ('confirmed','needs_review')
  ) into v_dupe;
  if v_dupe then
    update fin_private.whatsapp_receipt_intents set status='needs_review',confirmation_message_id=p_message,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'status','needs_review','reason','POSSIBLE_DUPLICATE');
  end if;
  if s.purpose_kind='donation' then
    select id into v_cat from public.fin_categories where kind='revenue' and system_key='donations_campaigns' limit 1;
    if v_cat is null then
      insert into public.fin_categories(name,kind,dre_line,system_key,active)
      values('Doações e campanhas','revenue','revenue','donations_campaigns',true)
      returning id into v_cat;
    end if;
    insert into public.fin_entries(kind,status,description,category_id,amount_cents,competence_date,due_date,notes,request_id)
    values('revenue','pending',left('Doação - '||s.purpose_detail,140),v_cat,v_amount,v_date,v_date,
      left('Recebida pelo João, confirmada pelo remetente. PENDENTE DE CONFERÊNCIA BANCÁRIA. Comprovante: '||
           coalesce(d->>'storage_path',''),1000),s.id)
    returning id into v_entry;
    -- Saldo do caixa só muda quando o administrador marcar a receita como paga.
    update fin_private.whatsapp_receipt_intents set status='confirmed',confirmation_message_id=p_message,
      finance_entry_id=v_entry,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'status','confirmed','kind','donation',
      'finance_entry_id',v_entry,'paid',false);
  elsif s.purpose_kind in ('membership','member_pendency') and s.profile_id is not null then
    select exists(select 1 from public.fin_receipt_submissions r where r.content_sha256=v_hash and r.status in ('submitted','in_review','approved'))
      into v_dupe;
    if v_dupe then
      update fin_private.whatsapp_receipt_intents set status='needs_review',
        confirmation_message_id=p_message,updated_at=now() where id=s.id;
      return jsonb_build_object('ok',true,'status','needs_review','reason','POSSIBLE_DUPLICATE');
    end if;
    insert into public.fin_receipt_submissions(
      id,profile_id,status,storage_path,file_name,content_type,size_bytes,content_sha256,
      declared_amount_cents,declared_paid_on,declared_reference,member_note,ocr_status,ocr,
      possible_duplicate,request_id,source,source_message_id
    ) values (
      s.id,s.profile_id,'submitted',d->>'storage_path',d->>'file_name',d->>'content_type',
      (d->>'size_bytes')::integer,v_hash,v_amount,v_date,d->>'declared_reference',
      left('Confirmado por WhatsApp: '||s.purpose_detail,500),
      coalesce(d->>'ocr_status','not_run'),d->'ocr',false,s.id,'whatsapp',s.source_message_id
    ) returning id into v_submission;
    -- Não vincular automaticamente competência nem cobrança: o envio pode ser de outro mês ou de terceiro.
    -- O administrador escolhe a cobrança correta na revisão, e a quitação só ocorre após conferência.
    update fin_private.whatsapp_receipt_intents set status='confirmed',confirmation_message_id=p_message,
      finance_submission_id=v_submission,updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'status','confirmed','kind',s.purpose_kind,
      'finance_submission_id',v_submission,'paid',false);
  else
    -- Card Mensal/Day Card e outros pagamentos exigem motor de domínio, sem forçar mensalidade de sócio.
    update fin_private.whatsapp_receipt_intents set status='needs_review',confirmation_message_id=p_message,
      updated_at=now() where id=s.id;
    return jsonb_build_object('ok',true,'status','needs_review','kind',s.purpose_kind,
      'reason','SPECIAL_PAYMENT_REQUIRES_REVIEW');
  end if;
end $$;
revoke all on function public.conv_svc_receipt_confirm(uuid,uuid) from public,anon,authenticated;
grant execute on function public.conv_svc_receipt_confirm(uuid,uuid) to service_role;
