-- Assessor: formulários do clube (club_forms) pela conversa privada do administrador com o João.
--  · Consultas (N0): lista de formulários, quem respondeu e quem falta (por nome) e o resultado de cada pergunta.
--  · Ações (N1, resumo + "sim"): criar formulário, encerrar/reabrir e lembrar por WhatsApp quem ainda não respondeu (com o link).
-- A participação vem de `club_form_voter_receipts` (o recibo existe também na votação secreta: diz QUEM participou, nunca o que votou).
-- Apagar formulário continua só no painel.

do $$
declare v_name text; v_def text; v_list text[];
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def from pg_constraint
  where conrelid = 'public.conv_booking_proposals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%action%';
  select array_agg(distinct m[1]) into v_list from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_list := coalesce(v_list, '{}') || array['adm_form_create', 'adm_form_toggle', 'adm_form_nudge'];
  if v_name is not null then execute format('alter table public.conv_booking_proposals drop constraint %I', v_name); end if;
  execute format('alter table public.conv_booking_proposals add constraint conv_booking_proposals_action_check check (action = any (array[%s]))',
    (select string_agg(quote_literal(x), ', ') from (select distinct unnest(v_list) x) u));
end $$;

-- ---------------------------------------------------------------------------------------------- apoio
create function conv_private.ai_form_state(f public.club_forms) returns text
language sql stable set search_path = '' as $$
  select case when not f.is_active then 'encerrado'
              when f.starts_at is not null and f.starts_at > now() then 'agendado'
              when f.expires_at is not null and f.expires_at <= now() then 'vencido'
              else 'aberto' end
$$;

create function conv_private.ai_form_link(p_slug text) returns text
language sql immutable set search_path = '' as $$ select 'https://stcplay.com.br/votacao/' || p_slug $$;

-- Quem deveria responder: sócios e diretoria ativos, com o recibo de participação (se houver) e se dá para alcançar por WhatsApp.
create function conv_private.ai_form_audience(p_form uuid)
returns table(profile_id uuid, name text, phone text, responded boolean, responded_at timestamptz, opted_out boolean)
language sql stable security definer set search_path = '' as $$
  select x.id, x.name, x.ph, x.rat is not null, x.rat,
    (x.ph is not null and exists (select 1 from public.conv_contacts c where c.phone = x.ph and c.opt_out))
  from (select pr.id, pr.name, conv_private.phone_e164(pr.phone) ph, r.created_at rat
        from public.profiles pr
        left join public.club_form_voter_receipts r on r.form_id = p_form and r.user_id = pr.id
        where coalesce(pr.is_active, true) and pr.role::text in ('socio', 'admin')) x
$$;

-- Acha UM formulário pelo nome/apelido; sem nome, o único aberto. Ambíguo ou ausente vira pergunta (nunca escolha por aproximação).
create function conv_private.ai_form_pick(p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := nullif(trim(coalesce(p_ref, '')), '');
  v_ids uuid[]; v_exact uuid[]; v_open uuid[]; v_list text;
begin
  if v_ref is null then
    select array_agg(id order by created_at desc) into v_ids from public.club_forms f where conv_private.ai_form_state(f) = 'aberto';
  else
    v_ref := fin_private.fold_text(v_ref);
    select array_agg(id order by created_at desc) into v_ids from public.club_forms
     where fin_private.fold_text(title) like '%' || v_ref || '%' or fin_private.fold_text(slug) like '%' || replace(v_ref, ' ', '-') || '%';
    if cardinality(v_ids) > 1 then
      select array_agg(id) into v_exact from public.club_forms where id = any(v_ids) and fin_private.fold_text(title) = v_ref;
      if cardinality(v_exact) = 1 then v_ids := v_exact; end if;
    end if;
    if cardinality(v_ids) > 1 then
      select array_agg(id) into v_open from public.club_forms f where f.id = any(v_ids) and conv_private.ai_form_state(f) = 'aberto';
      if cardinality(v_open) = 1 then v_ids := v_open; end if;
    end if;
  end if;
  if cardinality(v_ids) = 1 then return jsonb_build_object('ok', true, 'form_id', v_ids[1]); end if;
  select string_agg('«' || t.title || '»', ', ' order by t.created_at desc) into v_list
  from (select title, created_at from public.club_forms where v_ids is null or id = any(v_ids) order by created_at desc limit 6) t;
  if v_list is null then return conv_private.vfail('FORM_NOT_FOUND', 'Ainda não há formulário cadastrado.'); end if;
  if cardinality(v_ids) > 1 then
    return conv_private.vfail('FORM_AMBIGUOUS', 'Achei mais de um formulário: ' || v_list || '. De qual você fala?');
  end if;
  return conv_private.vfail('FORM_NOT_FOUND', case when v_ref is null then 'Não há formulário aberto agora. ' else 'Não achei formulário com esse nome. ' end
    || 'Os mais recentes: ' || v_list || '. Qual deles?');
end $$;

-- ---------------------------------------------------------------------------------------------- consultas
create function conv_private.ai_admin_forms_read(p_session uuid, p_domain text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid; v_out jsonb; v_pick jsonb; f public.club_forms%rowtype;
begin
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador consulta, e só na conversa privada comigo.');
  end if;

  if p_domain = 'formularios' then
    select jsonb_build_object(
      'audience', (select count(*) from public.profiles pr where coalesce(pr.is_active, true) and pr.role::text in ('socio', 'admin')),
      'items', coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'slug', x.slug, 'state', conv_private.ai_form_state(x), 'secret', x.is_secret_vote,
        'expires_at', x.expires_at, 'link', conv_private.ai_form_link(x.slug),
        'questions', (select count(*) from public.club_form_questions q where q.form_id = x.id),
        'participants', (select count(*) from public.club_form_voter_receipts r where r.form_id = x.id)) order by x.created_at desc), '[]'::jsonb))
    into v_out from (select * from public.club_forms order by created_at desc limit 15) x;
  else
    v_pick := conv_private.ai_form_pick(p_args->>'form_ref');
    if not (v_pick->>'ok')::boolean then return v_pick; end if;
    select * into f from public.club_forms where id = (v_pick->>'form_id')::uuid;
    if p_domain = 'formulario' then
      select jsonb_build_object('title', f.title, 'slug', f.slug, 'link', conv_private.ai_form_link(f.slug), 'state', conv_private.ai_form_state(f),
        'requires_auth', f.requires_auth, 'secret', f.is_secret_vote, 'expires_at', f.expires_at,
        'participants', (select count(*) from public.club_form_voter_receipts r where r.form_id = f.id),
        'audience', count(*),
        'responded', coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'at', a.responded_at) order by a.responded_at) filter (where a.responded), '[]'::jsonb),
        'pending', coalesce(jsonb_agg(jsonb_build_object('name', a.name,
          'reachable', a.phone is not null and length(a.phone) >= 12 and not a.opted_out) order by a.name) filter (where not a.responded), '[]'::jsonb))
      into v_out from conv_private.ai_form_audience(f.id) a;
    elsif p_domain = 'formulario_resultado' then
      select jsonb_build_object('title', f.title, 'slug', f.slug, 'secret', f.is_secret_vote,
        'participants', (select count(*) from public.club_form_voter_receipts r where r.form_id = f.id),
        'questions', coalesce((select jsonb_agg(jsonb_build_object('title', q.title, 'type', q.question_type,
          'options', coalesce((select jsonb_agg(jsonb_build_object('label', o.label,
              'votes', (select count(*) from public.club_form_responses res where res.option_id = o.id)) order by o.display_order)
            from public.club_form_options o where o.question_id = q.id), '[]'::jsonb),
          'texts_total', (select count(*) from public.club_form_responses res where res.question_id = q.id and trim(coalesce(res.text_response, '')) <> ''),
          'texts', coalesce((select jsonb_agg(jsonb_build_object('text', t.text_response, 'author', case when f.is_secret_vote then null else pr.name end) order by t.created_at desc)
            from (select * from public.club_form_responses res where res.question_id = q.id and trim(coalesce(res.text_response, '')) <> ''
                  order by res.created_at desc limit 15) t
            left join public.profiles pr on pr.id = t.user_id), '[]'::jsonb)) order by q.display_order)
          from public.club_form_questions q where q.form_id = f.id), '[]'::jsonb))
      into v_out;
    else
      return conv_private.vfail('INVALID_DOMAIN', 'Essa consulta eu ainda não sei fazer.');
    end if;
  end if;
  perform conv_private.audit('ai_admin_read', 'conv_ai_sessions', p_session::text, null,
    jsonb_build_object('domain', p_domain), jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'requester_profile_id', v_admin), v_admin);
  return jsonb_build_object('ok', true, 'domain', p_domain, 'data', v_out);
end $$;

create function public.conv_svc_ai_admin_forms_read(p_session uuid, p_domain text, p_args jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_forms_read(p_session, p_domain, coalesce(p_args, '{}'::jsonb)) $$;

-- ---------------------------------------------------------------------------------------------- propostas
create function conv_private.ai_admin_forms_propose(p_session uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  sess public.conv_ai_sessions%rowtype; s public.conv_ai_settings%rowtype; f public.club_forms%rowtype;
  v_admin uuid; v_action text := p->>'action'; v_payload jsonb; v_id uuid; v_pick jsonb;
  v_today date := (now() at time zone 'America/Fortaleza')::date;
  v_title text; v_desc text; v_slug text; v_base text; v_i int := 1; v_qs jsonb := '[]'::jsonb; v_q jsonb; v_qt text; v_type text; v_opts jsonb;
  v_expires timestamptz; v_active boolean; v_rec jsonb; v_n int; v_pending int; v_already int; v_body text; v_at timestamptz; v_note text; v_link text;
begin
  select * into sess from public.conv_ai_sessions where id = p_session and status = 'open' for update;
  if not found then return conv_private.vfail('SESSION_CLOSED', 'Atendimento encerrado.'); end if;
  v_admin := conv_private.ai_admin_requester(p_session);
  if v_admin is null then
    return conv_private.vfail('ADMIN_ONLY_PRIVATE', 'Isso só um administrador faz, e só na conversa privada comigo.');
  end if;

  if v_action = 'adm_form_create' then
    v_title := trim(coalesce(p->>'title', '')); v_desc := nullif(trim(coalesce(p->>'description', '')), '');
    if length(v_title) not between 3 and 120 then return conv_private.vfail('INVALID_TITLE', 'Qual o título do formulário? (de 3 a 120 caracteres)'); end if;
    if exists (select 1 from public.club_forms x where fin_private.fold_text(x.title) = fin_private.fold_text(v_title)) then
      return conv_private.vfail('FORM_EXISTS', 'Já existe um formulário com o título «' || v_title || '». Quer outro título?');
    end if;
    for v_q in select value from jsonb_array_elements(coalesce(p->'questions', '[]'::jsonb)) loop
      v_qt := trim(coalesce(v_q->>'title', '')); v_type := coalesce(v_q->>'type', 'open_text');
      if length(v_qt) not between 3 and 200 then return conv_private.vfail('INVALID_QUESTION', 'Cada pergunta precisa de um texto (de 3 a 200 caracteres).'); end if;
      if v_type not in ('single_choice', 'multiple_choice', 'open_text') then
        return conv_private.vfail('INVALID_QUESTION', 'A pergunta «' || v_qt || '» precisa ser de escolha única, de múltipla escolha ou de texto livre.');
      end if;
      if v_type = 'open_text' then v_opts := '[]'::jsonb;
      else
        select coalesce(jsonb_agg(trim(o.val)), '[]'::jsonb) into v_opts
        from jsonb_array_elements_text(coalesce(v_q->'options', '[]'::jsonb)) as o(val) where length(trim(o.val)) between 1 and 120;
        if jsonb_array_length(v_opts) not between 2 and 12 then
          return conv_private.vfail('INVALID_QUESTION', 'A pergunta «' || v_qt || '» precisa de 2 a 12 alternativas. Quais são?');
        end if;
      end if;
      v_qs := v_qs || jsonb_build_array(jsonb_build_object('title', v_qt, 'type', v_type,
        'required', coalesce((v_q->>'required')::boolean, true), 'options', v_opts));
    end loop;
    if jsonb_array_length(v_qs) not between 1 and 20 then
      return conv_private.vfail('NO_QUESTIONS', 'Quais são as perguntas do formulário? (de 1 a 20; para as de escolha, me diga as alternativas)');
    end if;
    if nullif(p->>'expires_on', '') is not null then
      if (p->>'expires_on')::date < v_today then return conv_private.vfail('INVALID_DATE', 'O prazo não pode ser no passado.'); end if;
      v_expires := ((p->>'expires_on') || ' 23:59:59-03')::timestamptz;
    end if;
    v_base := left(trim(both '-' from regexp_replace(lower(fin_private.fold_text(v_title)), '[^a-z0-9]+', '-', 'g')), 60);
    if v_base = '' then v_base := 'formulario'; end if;
    v_slug := v_base;
    while exists (select 1 from public.club_forms x where x.slug = v_slug) loop v_i := v_i + 1; v_slug := v_base || '-' || v_i; end loop;
    v_payload := jsonb_strip_nulls(jsonb_build_object('title', v_title, 'description', v_desc, 'slug', v_slug, 'questions', v_qs,
      'secret', coalesce((p->>'secret')::boolean, false), 'multiple', coalesce((p->>'multiple')::boolean, false),
      'requires_auth', coalesce((p->>'requires_auth')::boolean, true), 'expires_at', v_expires, 'link', conv_private.ai_form_link(v_slug)));

  elsif v_action = 'adm_form_toggle' then
    v_active := (p->>'active')::boolean;
    if v_active is null then return conv_private.vfail('INVALID_DATA', 'É para encerrar ou reabrir o formulário?'); end if;
    v_pick := conv_private.ai_form_pick(p->>'form_ref');
    if not (v_pick->>'ok')::boolean then return v_pick; end if;
    select * into f from public.club_forms where id = (v_pick->>'form_id')::uuid;
    if nullif(p->>'expires_on', '') is not null then
      if (p->>'expires_on')::date < v_today then return conv_private.vfail('INVALID_DATE', 'O prazo não pode ser no passado.'); end if;
      v_expires := ((p->>'expires_on') || ' 23:59:59-03')::timestamptz;
    end if;
    if not v_active then
      if not f.is_active then return conv_private.vfail('ALREADY_SET', 'O formulário «' || f.title || '» já está encerrado.'); end if;
    else
      if conv_private.ai_form_state(f) = 'aberto' and v_expires is null then
        return conv_private.vfail('ALREADY_SET', 'O formulário «' || f.title || '» já está aberto.');
      end if;
      if f.expires_at is not null and f.expires_at <= now() and v_expires is null then
        return conv_private.vfail('DEADLINE_PASSED', 'O prazo do «' || f.title || '» acabou em ' || to_char(f.expires_at at time zone 'America/Fortaleza', 'DD/MM')
          || '. Até quando você quer deixar aberto?');
      end if;
    end if;
    v_payload := jsonb_strip_nulls(jsonb_build_object('form_id', f.id, 'title', f.title, 'slug', f.slug, 'active', v_active, 'expires_at', v_expires));

  elsif v_action = 'adm_form_nudge' then
    v_pick := conv_private.ai_form_pick(p->>'form_ref');
    if not (v_pick->>'ok')::boolean then return v_pick; end if;
    select * into f from public.club_forms where id = (v_pick->>'form_id')::uuid;
    if conv_private.ai_form_state(f) <> 'aberto' then
      return conv_private.vfail('FORM_NOT_OPEN', 'O formulário «' || f.title || '» está ' || conv_private.ai_form_state(f) || ': não dá para pedir resposta agora. Posso reabrir primeiro.');
    end if;
    v_link := conv_private.ai_form_link(f.slug);
    v_note := 'Lembrete: formulário ' || f.slug;
    v_body := trim(coalesce(p->>'body', ''));
    if v_body = '' then
      v_body := 'Olá, {nome}! Aqui é o João, do STC. A diretoria ainda não recebeu a sua resposta no formulário «' || f.title || '». Leva só alguns minutos: ' || v_link;
    elsif position(v_link in v_body) = 0 then
      v_body := v_body || E'\n' || v_link;
    end if;
    if length(v_body) > 3500 then return conv_private.vfail('INVALID_BODY', 'O texto ficou grande demais.'); end if;
    v_at := coalesce(nullif(p->>'send_at', '')::timestamptz, now());
    if v_at < now() then v_at := now(); end if;
    if v_at > now() + interval '7 days' then return conv_private.vfail('INVALID_DATE', 'Só consigo agendar até 7 dias à frente.'); end if;
    select count(*) into v_pending from conv_private.ai_form_audience(f.id) a where not a.responded and a.profile_id <> v_admin;
    if v_pending = 0 then
      return conv_private.vfail('NO_PENDING', 'Todos já responderam o «' || f.title || '». Não há ninguém para lembrar.');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('profile_id', t.profile_id, 'name', t.name, 'phone', t.phone) order by t.name), '[]'::jsonb), count(*)
      into v_rec, v_n
    from (select a.* from conv_private.ai_form_audience(f.id) a
          where not a.responded and a.profile_id <> v_admin and a.phone is not null and length(a.phone) >= 12 and not a.opted_out
            and not exists (select 1 from public.conv_followups fu
                            join public.conv_conversations cv on cv.id = fu.conversation_id
                            join public.conv_contacts ct on ct.id = cv.contact_id
                            where ct.phone = a.phone and fu.note = v_note and fu.status in ('pending', 'sending', 'sent')
                              and fu.created_at > now() - interval '24 hours')) t;
    select count(*) into v_already from conv_private.ai_form_audience(f.id) a
    where not a.responded and a.profile_id <> v_admin and a.phone is not null and length(a.phone) >= 12 and not a.opted_out
      and exists (select 1 from public.conv_followups fu join public.conv_conversations cv on cv.id = fu.conversation_id
                  join public.conv_contacts ct on ct.id = cv.contact_id
                  where ct.phone = a.phone and fu.note = v_note and fu.status in ('pending', 'sending', 'sent') and fu.created_at > now() - interval '24 hours');
    if v_n = 0 then
      return conv_private.vfail('NO_RECIPIENTS', case when v_already > 0
        then 'Quem falta já recebeu o lembrete nas últimas 24 horas (' || v_already || '). Não mando de novo para não incomodar.'
        else 'Quem falta responder está sem telefone válido ou pediu para não receber mensagens.' end);
    end if;
    v_payload := jsonb_build_object('form_id', f.id, 'form_title', f.title, 'slug', f.slug, 'link', v_link, 'body', v_body, 'send_at', v_at,
      'count', v_n, 'already', v_already, 'skipped', v_pending - v_n - v_already,
      'names', (select jsonb_agg(r->>'name') from jsonb_array_elements(v_rec) r), 'recipients', v_rec);
  else
    return conv_private.vfail('INVALID_ACTION', 'Essa ação de formulário eu não conheço.');
  end if;

  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  update public.conv_booking_proposals set status = 'canceled' where session_id = p_session and status = 'open';
  insert into public.conv_booking_proposals(conversation_id, session_id, requester_contact_id, requester_profile_id, action, payload, expires_at)
  values (sess.conversation_id, p_session, sess.requester_contact_id, v_admin, v_action, v_payload,
    now() + make_interval(mins => greatest(coalesce(s.proposal_ttl_minutes, 20), 30)))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'proposal_id', v_id, 'action', v_action, 'summary', v_payload - 'recipients');
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then
  return conv_private.vfail('INVALID_DATA', 'Algum dado veio num formato que não entendi (data ou opção).');
end $$;

create function public.conv_svc_ai_admin_forms_propose(p_session uuid, p jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select conv_private.ai_admin_forms_propose(p_session, p) $$;

-- ---------------------------------------------------------------------------------------------- execução
-- Porta comum da confirmação (mesmas travas das outras ações do assessor): devolve NULL quando pode executar.
create function conv_private.ai_forms_gate(bp public.conv_booking_proposals, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.conv_messages%rowtype; v_admin uuid;
begin
  if bp.status = 'confirmed' then return jsonb_build_object('ok', true, 'replayed', true, 'action', bp.action, 'summary', bp.payload - 'recipients'); end if;
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
  return null;
end $$;

alter function conv_private.ai_confirm_single_step(uuid, uuid) rename to ai_confirm_pre_forms_step;

create function conv_private.ai_confirm_single_step(p_proposal uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bp public.conv_booking_proposals%rowtype; v_gate jsonb; v_admin uuid; v_res jsonb; v_err text; v_code text;
  v_form uuid; v_qid uuid; v_n int := 0; r record; v_contact uuid; v_conv uuid; v_at timestamptz; v_note text;
  f public.club_forms%rowtype;
begin
  select * into bp from public.conv_booking_proposals where id = p_proposal for update;
  if not found or bp.action not in ('adm_form_create', 'adm_form_toggle', 'adm_form_nudge') then
    return conv_private.ai_confirm_pre_forms_step(p_proposal, p_message);
  end if;
  v_gate := conv_private.ai_forms_gate(bp, p_message);
  if v_gate is not null then return v_gate; end if;
  v_admin := bp.requester_profile_id;
  begin
    if bp.action = 'adm_form_create' then
      insert into public.club_forms(title, description, slug, is_active, is_secret_vote, requires_auth, allow_multiple_submissions, show_live_results, expires_at, created_by)
      values (bp.payload->>'title', bp.payload->>'description', bp.payload->>'slug', true, coalesce((bp.payload->>'secret')::boolean, false),
        coalesce((bp.payload->>'requires_auth')::boolean, true), coalesce((bp.payload->>'multiple')::boolean, false), false,
        nullif(bp.payload->>'expires_at', '')::timestamptz, v_admin)
      returning id into v_form;
      for r in select e.value as q, e.ordinality as i from jsonb_array_elements(bp.payload->'questions') with ordinality as e(value, ordinality) loop
        insert into public.club_form_questions(form_id, title, question_type, is_required, display_order)
        values (v_form, r.q->>'title', r.q->>'type', coalesce((r.q->>'required')::boolean, true), (r.i - 1)::int) returning id into v_qid;
        insert into public.club_form_options(question_id, label, display_order)
        select v_qid, o.val, (o.ordinality - 1)::int from jsonb_array_elements_text(coalesce(r.q->'options', '[]'::jsonb)) with ordinality as o(val, ordinality);
      end loop;
      v_res := jsonb_build_object('form_id', v_form, 'link', bp.payload->>'link');

    elsif bp.action = 'adm_form_toggle' then
      update public.club_forms set is_active = (bp.payload->>'active')::boolean,
        expires_at = coalesce(nullif(bp.payload->>'expires_at', '')::timestamptz, expires_at), updated_at = now()
       where id = (bp.payload->>'form_id')::uuid;
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'FORM_NOT_FOUND'; end if;
      v_res := jsonb_build_object('form_id', bp.payload->>'form_id');

    else
      select * into f from public.club_forms where id = (bp.payload->>'form_id')::uuid;
      if not found or conv_private.ai_form_state(f) <> 'aberto' then raise exception 'FORM_NOT_OPEN'; end if;
      v_note := 'Lembrete: formulário ' || f.slug;
      v_at := greatest((bp.payload->>'send_at')::timestamptz, now());
      for r in select e.value as rec from jsonb_array_elements(bp.payload->'recipients') as e loop
        -- Quem respondeu entre o resumo e o "sim" não recebe; opt-out vale até o último instante.
        if exists (select 1 from public.club_form_voter_receipts rc where rc.form_id = f.id and rc.user_id = (r.rec->>'profile_id')::uuid) then continue; end if;
        if exists (select 1 from public.conv_contacts c where c.phone = r.rec->>'phone' and c.opt_out) then continue; end if;
        v_contact := conv_private.upsert_contact(r.rec->>'phone', null, r.rec->>'name', true);
        v_conv := conv_private.open_direct(v_contact);
        insert into public.conv_followups(conversation_id, due_at, note, send_body, created_by)
        values (v_conv, v_at, v_note, bp.payload->>'body', v_admin);
        v_n := v_n + 1;
      end loop;
      v_res := jsonb_build_object('queued', v_n);
    end if;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is not null then
    v_code := case when v_err ~ '^[A-Z][A-Z_]+$' then v_err else 'ADMIN_ACTION_FAILED' end;
    update public.conv_booking_proposals set status = 'failed', failure_code = v_code where id = bp.id;
    return conv_private.vfail(v_code, case v_code when 'FORM_NOT_OPEN' then 'O formulário não está mais aberto.' else 'Não consegui concluir: ' || v_code || '.' end);
  end if;
  update public.conv_booking_proposals set status = 'confirmed', confirmed_at = now(), confirmed_message_id = p_message,
    confirmed_by_contact_id = bp.requester_contact_id, payload = (bp.payload - 'recipients') || v_res where id = bp.id;
  perform conv_private.audit('ai_admin_action', 'conv_booking_proposals', bp.id::text, null,
    jsonb_build_object('action', bp.action) || v_res - 'link',
    jsonb_build_object('actor', 'ai', 'source', 'whatsapp', 'conversation_id', bp.conversation_id, 'proposal_id', bp.id,
      'requester_profile_id', bp.requester_profile_id), bp.requester_profile_id);
  return jsonb_build_object('ok', true, 'action', bp.action, 'summary', (bp.payload - 'recipients') || v_res);
end $$;

revoke all on function conv_private.ai_form_state(public.club_forms) from public, anon, authenticated;
revoke all on function conv_private.ai_form_link(text) from public, anon, authenticated;
revoke all on function conv_private.ai_form_audience(uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_form_pick(text) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_forms_read(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_admin_forms_propose(uuid, jsonb) from public, anon, authenticated;
revoke all on function conv_private.ai_forms_gate(public.conv_booking_proposals, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_pre_forms_step(uuid, uuid) from public, anon, authenticated;
revoke all on function conv_private.ai_confirm_single_step(uuid, uuid) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_forms_read(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.conv_svc_ai_admin_forms_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_admin_forms_read(uuid, text, jsonb) to service_role;
grant execute on function public.conv_svc_ai_admin_forms_propose(uuid, jsonb) to service_role;
