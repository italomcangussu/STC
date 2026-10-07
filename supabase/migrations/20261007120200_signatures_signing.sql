-- Documentos e Assinaturas — assinatura do sócio e funções do servidor (3/3).
--
-- Jornada do sócio (cada passo vira evento com data e hora do SERVIDOR):
--   1. `sig_my_documents`        lista o que ele deve assinar;
--   2. `sig_log_event`           viewed → read_started → read_completed → consent_checked
--                                 (o aceite só vale depois da leitura até o fim);
--   3. `sig_save_my_cpf`         CPF declarado, uma vez;
--   4. edge function → `sig_svc_issue_challenge` (gera o desafio com o código
--      de 6 dígitos) → envia o WhatsApp → `sig_svc_mark_code_sent`;
--   5. edge function → `sig_svc_verify_code`: confere o código e GRAVA a assinatura
--      com o dossiê completo, encadeada por hash.
--
-- As funções `sig_svc_*` só existem para o `service_role` (edge functions).
-- O que o usuário pode errar (código errado, expirado, muito cedo) volta como
-- `{ok:false, reason}` e NÃO como exceção, porque exceção desfaria o contador
-- de tentativas. Exceção fica para erro de uso (formato inválido, sem permissão).

-- ------------------------------------------------------------------
-- 1. Lado do sócio
-- ------------------------------------------------------------------
create function public.sig_my_documents()
returns table(document_id uuid, title text, description text, version integer, page_count integer, size_bytes bigint,
  content_sha256 text, storage_path text, due_at timestamptz, status text, published_at timestamptz,
  consent_text text, signed_at timestamptz, signature_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform sig_private.require_member();
  return query
  select d.id, d.title, d.description, d.version, d.page_count, d.size_bytes, d.content_sha256, d.storage_path,
    d.due_at, d.status, d.published_at, sig_private.consent_text(d.title, d.version), r.signed_at, r.signature_id
  from public.sig_recipients r join public.sig_documents d on d.id = r.document_id
  where r.profile_id = auth.uid() and (d.status = 'published' or (d.status = 'archived' and r.signed_at is not null))
  order by (r.signed_at is not null), d.due_at nulls last, d.published_at desc;
end $$;

-- Selo de pendência no menu e na aba.
create function public.sig_my_pending_count() returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  perform sig_private.require_member();
  return (select count(*)::integer from public.sig_recipients r join public.sig_documents d on d.id = r.document_id
    where r.profile_id = auth.uid() and r.signed_at is null and d.status = 'published');
end $$;

-- CPF declarado (só dígitos ou com máscara). Depois da primeira assinatura não muda pelo app.
create function public.sig_save_my_cpf(p_cpf text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := sig_private.require_member(); v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'); v_old text;
begin
  if not sig_private.cpf_valid(v_cpf) then raise exception 'SIG_CPF_INVALID'; end if;
  select cpf into v_old from public.sig_member_identities where profile_id = v_uid;
  if v_old is not null and v_old <> v_cpf and exists (select 1 from public.sig_signatures where profile_id = v_uid) then
    raise exception 'SIG_CPF_LOCKED';
  end if;
  insert into public.sig_member_identities(profile_id, cpf) values (v_uid, v_cpf)
  on conflict (profile_id) do update set cpf = excluded.cpf, updated_at = now();
end $$;

-- Eventos da leitura, com a hora do servidor. Só `meta.pages_seen` e `meta.pages_total` são aproveitados.
create function public.sig_log_event(p_document uuid, p_kind text, p_meta jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := sig_private.require_member(); d public.sig_documents%rowtype; r public.sig_recipients%rowtype;
  v_meta jsonb := '{}'::jsonb; v_seen integer; v_total integer; v_at timestamptz := clock_timestamp();
begin
  if p_kind not in ('viewed', 'read_started', 'read_completed', 'consent_checked') then
    raise exception 'SIG_EVENT_INVALID';
  end if;
  select * into r from public.sig_recipients where document_id = p_document and profile_id = v_uid;
  if not found then raise exception 'SIG_NOT_FOUND'; end if;
  select * into d from public.sig_documents where id = p_document;
  if d.status <> 'published' then raise exception 'SIG_NOT_PUBLISHED'; end if;
  if r.signed_at is not null then raise exception 'SIG_ALREADY_SIGNED'; end if;

  if p_kind = 'read_completed' then
    if not exists (select 1 from public.sig_events e where e.document_id = p_document and e.profile_id = v_uid and e.kind = 'read_started') then
      raise exception 'SIG_READ_NOT_STARTED';
    end if;
    v_seen := case when p_meta->>'pages_seen' ~ '^[0-9]{1,4}$' then (p_meta->>'pages_seen')::integer end;
    v_total := case when p_meta->>'pages_total' ~ '^[0-9]{1,4}$' then (p_meta->>'pages_total')::integer end;
    if coalesce(v_seen, 0) < d.page_count or coalesce(v_total, 0) <> d.page_count then raise exception 'SIG_READ_INCOMPLETE'; end if;
    v_meta := jsonb_build_object('pages_seen', v_seen, 'pages_total', v_total);
  elsif p_kind = 'consent_checked' then
    if not exists (select 1 from public.sig_events e where e.document_id = p_document and e.profile_id = v_uid and e.kind = 'read_completed') then
      raise exception 'SIG_READ_REQUIRED';
    end if;
  end if;

  -- Antirrepetição: o mesmo evento do mesmo sócio no mesmo documento em menos de 60 s não vira outra linha
  -- (a tabela é append-only; sem isto, um laço no app encheria o log).
  if exists (select 1 from public.sig_events e where e.document_id = p_document and e.profile_id = v_uid
             and e.kind = p_kind and e.occurred_at > v_at - interval '60 seconds') then
    return jsonb_build_object('ok', true, 'deduped', true);
  end if;
  insert into public.sig_events(occurred_at, document_id, profile_id, kind, ip, user_agent, meta)
  values (v_at, p_document, v_uid, p_kind, sig_private.request_ip(), left(sig_private.request_header('user-agent'), 400), v_meta);
  return jsonb_build_object('ok', true, 'occurred_at', v_at);
end $$;

-- ------------------------------------------------------------------
-- 2. Código de 6 dígitos (service_role)
-- ------------------------------------------------------------------
create function public.sig_svc_issue_challenge(p_profile uuid, p_document uuid, p_code text,
  p_evidence jsonb default '{}'::jsonb, p_ip text default null, p_ua text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.sig_documents%rowtype; r public.sig_recipients%rowtype; pr public.profiles%rowtype; v_phone text;
  v_read_done timestamptz; v_consent timestamptz; v_last timestamptz; v_salt text; v_id uuid; v_exp timestamptz;
  v_geo jsonb := '{}'::jsonb; v_lat numeric; v_lng numeric; v_evidence jsonb; v_device jsonb;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception 'SIG_BAD_CODE_FORMAT'; end if;
  select * into d from public.sig_documents where id = p_document;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if d.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'not_published'); end if;
  select * into r from public.sig_recipients where document_id = p_document and profile_id = p_profile for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_recipient'); end if;
  if r.signed_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_signed'); end if;
  if not sig_private.is_active_member(p_profile) then return jsonb_build_object('ok', false, 'reason', 'not_member'); end if;
  select * into pr from public.profiles where id = p_profile;
  v_phone := nullif(btrim(pr.phone), '');
  if v_phone is null then return jsonb_build_object('ok', false, 'reason', 'no_phone'); end if;
  if not exists (select 1 from public.sig_member_identities where profile_id = p_profile) then
    return jsonb_build_object('ok', false, 'reason', 'cpf_required');
  end if;

  -- A leitura até o fim e o aceite precisam existir NO SERVIDOR, nessa ordem.
  select min(occurred_at) into v_read_done from public.sig_events
    where document_id = p_document and profile_id = p_profile and kind = 'read_completed';
  if v_read_done is null then return jsonb_build_object('ok', false, 'reason', 'read_required'); end if;
  select max(occurred_at) into v_consent from public.sig_events
    where document_id = p_document and profile_id = p_profile and kind = 'consent_checked';
  if v_consent is null or v_consent < v_read_done then return jsonb_build_object('ok', false, 'reason', 'consent_required'); end if;

  select max(created_at) into v_last from sig_private.challenges where profile_id = p_profile and document_id = p_document;
  if v_last is not null and v_last > now() - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'too_soon',
      'retry_in_seconds', ceil(60 - extract(epoch from (now() - v_last)))::integer);
  end if;
  if (select count(*) from sig_private.challenges where profile_id = p_profile and document_id = p_document
      and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- GPS é opcional: só entra se for coordenada plausível.
  v_lat := case when p_evidence #>> '{geo,lat}' ~ '^-?[0-9]{1,3}(\.[0-9]{1,10})?$' then (p_evidence #>> '{geo,lat}')::numeric end;
  v_lng := case when p_evidence #>> '{geo,lng}' ~ '^-?[0-9]{1,3}(\.[0-9]{1,10})?$' then (p_evidence #>> '{geo,lng}')::numeric end;
  if v_lat between -90 and 90 and v_lng between -180 and 180 then
    v_geo := jsonb_strip_nulls(jsonb_build_object('lat', v_lat, 'lng', v_lng, 'accuracy_m',
      case when p_evidence #>> '{geo,accuracy_m}' ~ '^[0-9]{1,7}(\.[0-9]{1,4})?$' then (p_evidence #>> '{geo,accuracy_m}')::numeric end));
  end if;
  -- O aparelho é informado pelo cliente: só objeto pequeno entra.
  v_device := p_evidence->'device';
  if jsonb_typeof(v_device) is distinct from 'object' or length(v_device::text) > 2000 then v_device := '{}'::jsonb; end if;
  v_evidence := jsonb_build_object('geo', v_geo, 'device', v_device);

  update sig_private.challenges set status = 'superseded'
    where profile_id = p_profile and document_id = p_document and status in ('pending', 'sent');
  v_salt := gen_random_uuid()::text; v_exp := now() + interval '10 minutes';
  insert into sig_private.challenges(document_id, profile_id, code_hash, salt, phone, expires_at, ip, user_agent, evidence)
  values (p_document, p_profile, sig_private.sha256_hex(v_salt || ':' || p_code), v_salt, v_phone, v_exp,
    p_ip, left(p_ua, 400), v_evidence)
  returning id into v_id;
  insert into public.sig_events(document_id, profile_id, kind, ip, user_agent, meta)
    values (p_document, p_profile, 'code_requested', p_ip, left(p_ua, 400), jsonb_build_object('challenge_id', v_id));
  return jsonb_build_object('ok', true, 'challenge_id', v_id, 'phone', v_phone, 'name', pr.name,
    'title', d.title, 'expires_at', v_exp);
end $$;

-- Resultado do envio pelo WhatsApp. Sem `p_error` = enviado.
create function public.sig_svc_mark_code_sent(p_challenge uuid, p_provider_id text default null, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c sig_private.challenges%rowtype;
begin
  select * into c from sig_private.challenges where id = p_challenge for update;
  if not found or c.status <> 'pending' then return; end if;
  if p_error is null then
    update sig_private.challenges set status = 'sent', sent_at = now(), provider_message_id = p_provider_id where id = p_challenge;
    insert into public.sig_events(document_id, profile_id, kind, meta)
      values (c.document_id, c.profile_id, 'code_sent', jsonb_build_object('challenge_id', c.id, 'provider_message_id', p_provider_id));
  else
    update sig_private.challenges set status = 'failed', send_error = left(p_error, 500) where id = p_challenge;
    insert into public.sig_events(document_id, profile_id, kind, meta)
      values (c.document_id, c.profile_id, 'code_send_failed', jsonb_build_object('challenge_id', c.id, 'error', left(p_error, 200)));
  end if;
end $$;

-- Confere o código e grava a assinatura. Chamada repetida com o mesmo código certo devolve a mesma assinatura.
-- p_geo: o que o servidor descobriu pelo IP ({city, region, country}); p_device: o que o aparelho informou.
create function public.sig_svc_verify_code(p_challenge uuid, p_profile uuid, p_code text,
  p_ip text default null, p_ua text default null, p_geo jsonb default '{}'::jsonb, p_device jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c sig_private.challenges%rowtype; d public.sig_documents%rowtype; r public.sig_recipients%rowtype;
  pr public.profiles%rowtype; v_cpf text; s public.sig_signatures%rowtype; v_prev text; v_seq integer;
  v_read_started timestamptz; v_read_done timestamptz; v_consent timestamptz; v_meta jsonb; v_gps jsonb; v_left integer;
begin
  select * into c from sig_private.challenges where id = p_challenge;
  if not found or c.profile_id <> p_profile then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  -- Ordem de travas igual à de `sig_svc_issue_challenge` (destinatário e depois desafio): sem deadlock
  -- quando o sócio pede um código novo enquanto digita o anterior.
  perform 1 from public.sig_recipients where document_id = c.document_id and profile_id = p_profile for update;
  select * into c from sig_private.challenges where id = p_challenge for update;

  if c.status = 'verified' then
    select * into s from public.sig_signatures where challenge_id = c.id;
    return jsonb_build_object('ok', true, 'replayed', true, 'signature_id', s.id, 'signed_at', s.signed_at, 'seq', s.seq);
  end if;
  if c.status in ('superseded', 'failed', 'expired', 'locked') then
    return jsonb_build_object('ok', false, 'reason', c.status);
  end if;
  if c.expires_at <= now() then
    update sig_private.challenges set status = 'expired' where id = c.id;
    insert into public.sig_events(document_id, profile_id, kind, ip, user_agent, meta)
      values (c.document_id, c.profile_id, 'code_expired', p_ip, left(p_ua, 400), jsonb_build_object('challenge_id', c.id));
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if sig_private.sha256_hex(c.salt || ':' || coalesce(p_code, '')) <> c.code_hash then
    v_left := c.max_attempts - (c.attempts + 1);
    update sig_private.challenges set attempts = c.attempts + 1,
      status = case when c.attempts + 1 >= c.max_attempts then 'locked' else c.status end where id = c.id;
    insert into public.sig_events(document_id, profile_id, kind, ip, user_agent, meta)
      values (c.document_id, c.profile_id, case when v_left <= 0 then 'code_locked' else 'code_wrong' end, p_ip, left(p_ua, 400),
        jsonb_build_object('challenge_id', c.id, 'attempts', c.attempts + 1));
    return jsonb_build_object('ok', false, 'reason', case when v_left <= 0 then 'locked' else 'wrong_code' end,
      'attempts_left', greatest(v_left, 0));
  end if;

  -- Código certo: confere o resto antes de assinar.
  select * into d from public.sig_documents where id = c.document_id;
  if d.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'not_published'); end if;
  select * into r from public.sig_recipients where document_id = c.document_id and profile_id = p_profile for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_recipient'); end if;
  if r.signed_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_signed'); end if;
  if not sig_private.is_active_member(p_profile) then return jsonb_build_object('ok', false, 'reason', 'not_member'); end if;
  select * into pr from public.profiles where id = p_profile;
  select cpf into v_cpf from public.sig_member_identities where profile_id = p_profile;
  if v_cpf is null then return jsonb_build_object('ok', false, 'reason', 'cpf_required'); end if;

  select min(occurred_at) filter (where kind = 'read_started'), min(occurred_at) filter (where kind = 'read_completed'),
    max(occurred_at) filter (where kind = 'consent_checked')
    into v_read_started, v_read_done, v_consent
    from public.sig_events where document_id = c.document_id and profile_id = p_profile;
  if v_read_done is null then return jsonb_build_object('ok', false, 'reason', 'read_required'); end if;
  if v_consent is null or v_consent < v_read_done then return jsonb_build_object('ok', false, 'reason', 'consent_required'); end if;
  select meta into v_meta from public.sig_events
    where document_id = c.document_id and profile_id = p_profile and kind = 'read_completed' order by occurred_at limit 1;

  -- Um documento por vez na cadeia: a ordem (`seq`) e o elo (`prev_chain_hash`) dependem disso.
  perform pg_advisory_xact_lock(hashtextextended(c.document_id::text, 0));
  select seq, chain_hash into v_seq, v_prev from public.sig_signatures where document_id = c.document_id order by seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;

  v_gps := c.evidence->'geo';
  s.id := gen_random_uuid(); s.document_id := c.document_id; s.profile_id := p_profile; s.seq := v_seq; s.signed_at := now();
  s.document_title := d.title; s.document_version := d.version; s.document_sha256 := d.content_sha256;
  s.signer_name := pr.name; s.signer_phone := c.phone; s.signer_cpf := v_cpf;
  s.consent_text := sig_private.consent_text(d.title, d.version); s.accepted_at := v_consent;
  s.read_started_at := v_read_started; s.read_completed_at := v_read_done;
  s.read_seconds := case when v_read_started is null then null else greatest(extract(epoch from (v_read_done - v_read_started))::integer, 0) end;
  s.pages_seen := nullif(v_meta->>'pages_seen', '')::integer; s.pages_total := nullif(v_meta->>'pages_total', '')::integer;
  s.challenge_id := c.id; s.code_sent_at := coalesce(c.sent_at, c.created_at); s.code_verified_at := now();
  s.code_attempts := c.attempts + 1; s.provider_message_id := c.provider_message_id;
  s.ip := p_ip; s.user_agent := left(p_ua, 400);
  s.geo := jsonb_strip_nulls(jsonb_build_object(
    'source', case when v_gps ? 'lat' then 'gps' else 'ip' end,
    'city', left(p_geo->>'city', 120), 'region', left(p_geo->>'region', 120), 'country', left(p_geo->>'country', 120),
    'lat', v_gps->'lat', 'lng', v_gps->'lng', 'accuracy_m', v_gps->'accuracy_m'));
  s.device := coalesce(c.evidence->'device', '{}'::jsonb)
    || case when jsonb_typeof(p_device) = 'object' and length(p_device::text) <= 2000 then p_device else '{}'::jsonb end;
  s.evidence_hash := sig_private.sha256_hex(sig_private.signature_evidence(s)::text);
  s.prev_chain_hash := v_prev;
  s.chain_hash := sig_private.sha256_hex(coalesce(v_prev, '') || s.evidence_hash);

  perform sig_private.set_action('sign');
  insert into public.sig_signatures values (s.*);
  update public.sig_recipients set signed_at = s.signed_at, signature_id = s.id where document_id = c.document_id and profile_id = p_profile;
  update sig_private.challenges set status = 'verified', attempts = c.attempts + 1 where id = c.id;
  insert into public.sig_events(document_id, profile_id, kind, ip, user_agent, meta)
    values (c.document_id, p_profile, 'signed', p_ip, left(p_ua, 400), jsonb_build_object('signature_id', s.id, 'seq', s.seq));
  update public.sig_notifications set status = 'skipped', skip_reason = 'already_signed'
    where document_id = c.document_id and profile_id = p_profile and status = 'queued';
  return jsonb_build_object('ok', true, 'signature_id', s.id, 'signed_at', s.signed_at, 'seq', s.seq, 'evidence_hash', s.evidence_hash);
end $$;

-- ------------------------------------------------------------------
-- 3. Fila de avisos de WhatsApp (service_role)
-- ------------------------------------------------------------------
-- Pega até `p_limit` avisos prontos e os marca como "enviando". `skip locked`: dois
-- trabalhadores simultâneos nunca pegam o mesmo aviso. Aviso preso em "enviando"
-- por mais de 10 min volta à fila. O que perdeu o sentido (documento arquivado,
-- sócio já assinou ou foi removido, telefone apagado) é descartado aqui.
create function public.sig_svc_claim_notifications(p_limit integer default 1)
returns table(id uuid, document_id uuid, profile_id uuid, kind text, slot text, phone text, name text,
  title text, due_at timestamptz, attempts integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  update public.sig_notifications n set status = 'skipped',
    skip_reason = case
      when not exists (select 1 from public.sig_documents d where d.id = n.document_id and d.status = 'published') then 'not_published'
      when not exists (select 1 from public.sig_recipients r where r.document_id = n.document_id and r.profile_id = n.profile_id) then 'removed'
      when exists (select 1 from public.sig_recipients r where r.document_id = n.document_id and r.profile_id = n.profile_id and r.signed_at is not null) then 'already_signed'
      else 'no_phone' end
  where n.status = 'queued' and n.not_before <= now() and (
    not exists (select 1 from public.sig_documents d where d.id = n.document_id and d.status = 'published')
    or not exists (select 1 from public.sig_recipients r where r.document_id = n.document_id and r.profile_id = n.profile_id and r.signed_at is null)
    or not exists (select 1 from public.profiles p where p.id = n.profile_id and nullif(btrim(p.phone), '') is not null));

  return query
  with picked as (
    select n.id from public.sig_notifications n
    where (n.status = 'queued' and n.not_before <= now())
       or (n.status = 'sending' and n.claimed_at < now() - interval '10 minutes')
    order by n.not_before, n.created_at
    limit greatest(coalesce(p_limit, 1), 1)
    for update skip locked),
  upd as (
    update public.sig_notifications n set status = 'sending', claimed_at = now(), attempts = n.attempts + 1
    from picked where n.id = picked.id returning n.*)
  select u.id, u.document_id, u.profile_id, u.kind, u.slot, btrim(p.phone), p.name, d.title, d.due_at, u.attempts
  from upd u join public.profiles p on p.id = u.profile_id join public.sig_documents d on d.id = u.document_id
  order by u.not_before, u.created_at;
end $$;

-- Resultado do envio. Falha volta à fila com espera crescente (5, 10 min) até 3 tentativas; depois fica `failed`
-- (o admin vê e usa "Reenviar falhas").
create function public.sig_svc_finish_notification(p_id uuid, p_sent boolean, p_provider_id text default null, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare n public.sig_notifications%rowtype;
begin
  select * into n from public.sig_notifications where id = p_id for update;
  if not found or n.status <> 'sending' then return; end if;
  if p_sent then
    update public.sig_notifications set status = 'sent', sent_at = now(), provider_message_id = p_provider_id, error = null where id = p_id;
    insert into public.sig_events(document_id, profile_id, kind, meta)
      values (n.document_id, n.profile_id, 'notified', jsonb_build_object('notification_kind', n.kind, 'slot', n.slot, 'provider_message_id', p_provider_id));
  else
    update public.sig_notifications set error = left(p_error, 500), claimed_at = null,
      status = case when n.attempts >= 3 then 'failed' else 'queued' end,
      not_before = case when n.attempts >= 3 then n.not_before else now() + (n.attempts * interval '5 minutes') end
      where id = p_id;
    insert into public.sig_events(document_id, profile_id, kind, meta)
      values (n.document_id, n.profile_id, 'notification_failed',
        jsonb_build_object('notification_kind', n.kind, 'slot', n.slot, 'attempts', n.attempts, 'error', left(p_error, 200)));
  end if;
end $$;

-- Lembretes: 3 dias antes do prazo e no dia do prazo (a partir das 8h de Fortaleza), só para quem ainda não assinou.
-- Idempotente: o `slot` inclui a data do prazo, então rodar de hora em hora não repete, e mudar o prazo reabre os lembretes.
-- Um lembrete nunca cola com o aviso de publicação: só sai se a janela começa 12 h depois da publicação.
create function public.sig_svc_enqueue_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.sig_documents%rowtype; v_slot text; v_start timestamptz; v_day text; v_total integer := 0; v_p uuid; v_res text; v_kind text;
begin
  for d in select * from public.sig_documents where status = 'published' and due_at is not null and due_at > now() loop
    v_day := to_char(d.due_at at time zone 'America/Fortaleza', 'YYYY-MM-DD');
    foreach v_kind in array array['d-3', 'd0'] loop
      v_start := case v_kind
        when 'd-3' then d.due_at - interval '3 days'
        else (date_trunc('day', d.due_at at time zone 'America/Fortaleza') + interval '8 hours') at time zone 'America/Fortaleza' end;
      continue when v_start > now() or v_start <= d.published_at + interval '12 hours';
      v_slot := v_kind || '@' || v_day;
      for v_p in
        select r.profile_id from public.sig_recipients r
        where r.document_id = d.id and r.signed_at is null
          and not exists (select 1 from public.sig_notifications n where n.document_id = d.id and n.profile_id = r.profile_id
            and n.kind in ('publish', 'new_member') and n.created_at > now() - interval '12 hours')
      loop
        v_res := sig_private.enqueue_notification(d.id, v_p, 'reminder', v_slot);
        if v_res = 'queued' then v_total := v_total + 1; end if;
      end loop;
    end loop;
  end loop;
  return v_total;
end $$;

-- ------------------------------------------------------------------
-- 4. Sócio novo: documento marcado "vale para quem entrar depois"
-- ------------------------------------------------------------------
-- À prova de erro: uma falha aqui NUNCA impede criar/editar o perfil (vira aviso).
create function sig_private.on_member_active() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  begin
    if new.role::text in ('socio', 'admin') and coalesce(new.is_active, true)
       and (tg_op = 'INSERT' or not (old.role::text in ('socio', 'admin') and coalesce(old.is_active, true))) then
      for d in select id from public.sig_documents where status = 'published' and audience_mode = 'all' and applies_to_new_members loop
        insert into public.sig_recipients(document_id, profile_id, source) values (d.id, new.id, 'new_member')
        on conflict do nothing;
        if found then perform sig_private.enqueue_notification(d.id, new.id, 'new_member'); end if;
      end loop;
    end if;
  exception when others then
    raise warning 'sig_private.on_member_active: %', sqlerrm;
  end;
  return new;
end $$;
create trigger sig_profiles_new_member after insert or update of is_active, role on public.profiles
  for each row execute function sig_private.on_member_active();

-- ------------------------------------------------------------------
-- 5. Permissões
-- ------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('sig_my_documents', 'sig_my_pending_count', 'sig_save_my_cpf', 'sig_log_event')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'sig\_svc\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
