-- Grupo do campeonato (Italo, 30/10): o João foi adicionado ao "AUGE OPEN - 3ª Etapa Serra & Sertão". Ali estão os
-- inscritos do Serra e Sertão, sócios e convidados de fora. Um grupo pode ser ligado a um campeonato
-- (conv_groups.championship_id) e, nesse caso:
--   • o João conhece a turma pela lista de inscritos (classe, sócio ou convidado, cidade), sem pagamento nem telefone;
--   • o financeiro de cards e pendências NÃO entra no turno (o código corta; ver turnContext.ts);
--   • a "conversa do grupo de sócios" (resenha pedida pela diretoria) e as boas-vindas a sócio novo ignoram o grupo:
--     antes, liberar um segundo grupo mandaria a resenha para o grupo com mensagem mais recente;
--   • a turma rindo (kkk, 😂) também é deixa para ele entrar sozinho, dentro da janela espontânea (limite e intervalo);
--   • a apresentação sai uma vez só (joao-group-intro), marcada em conv_groups.intro_sent_at.

alter table public.conv_groups
  add column if not exists championship_id uuid references public.championships(id) on delete set null,
  add column if not exists intro_sent_at timestamptz;

-- Resenha da diretoria: só o grupo de sócios (sem campeonato).
create or replace function conv_private.members_group_conversation() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.conv_conversations c join public.conv_groups g on g.id = c.group_id
  where c.kind = 'group' and c.status = 'open' and g.status = 'allowed' and g.ai_enabled and g.championship_id is null
  order by g.last_seen_at desc nulls last limit 1 $$;

-- Boas-vindas a sócio novo: grupos do clube, não os de campeonato (lá há convidados de fora).
create or replace function public.conv_svc_welcome_groups() returns table(conversation_id uuid, group_name text)
language sql security definer set search_path = '' as $$
  select conv_private.open_group(g.id), g.name from public.conv_groups g
  where g.status = 'allowed' and g.ai_enabled and g.championship_id is null order by g.name $$;

-- A turma do campeonato: quem está na chave (painel) e quem se inscreveu pelo WhatsApp e ainda não foi para o painel.
-- Lista de espera fica fora. Sócio = tem cadastro no clube. Nada de pagamento, telefone ou id.
create or replace function conv_private.group_championship_pack(p_championship uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with atletas as (
    select r.class, coalesce(r.guest_name, p.name) as name,
           (r.user_id is not null or s.profile_id is not null) as socio, s.city
    from public.championship_registrations r
    left join public.profiles p on p.id = r.user_id
    left join lateral (select x.profile_id, x.city from public.championship_signups x
                       where x.registration_id = r.id and x.status <> 'canceled' order by x.created_at desc limit 1) s on true
    where r.championship_id = p_championship
    union all
    select s.class, s.full_name, s.profile_id is not null, s.city
    from public.championship_signups s
    where s.championship_id = p_championship and s.registration_id is null and s.status in ('pre', 'confirmed')
  ), por_classe as (
    select a.class, jsonb_agg(jsonb_build_object('name', a.name, 'socio', a.socio, 'city', nullif(trim(a.city), ''))
                              order by a.socio desc, a.name) as athletes
    from atletas a where a.name is not null group by a.class
  )
  select jsonb_build_object(
    'name', c.name, 'title', coalesce(c.joao_info->'title', '[]'::jsonb), 'start_date', c.start_date, 'end_date', c.end_date,
    'status', c.status, 'info', c.joao_info->>'info',
    'classes', coalesce((select jsonb_agg(jsonb_build_object('class', pc.class, 'athletes', pc.athletes) order by pc.class) from por_classe pc), '[]'::jsonb),
    'total', (select count(*) from atletas a where a.name is not null),
    'socios', (select count(*) from atletas a where a.name is not null and a.socio))
  from public.championships c where c.id = p_championship $$;
revoke all on function conv_private.group_championship_pack(uuid) from public, anon, authenticated;

-- Turno: o campeonato do grupo onde o João está falando (null fora de grupo de campeonato).
create or replace function public.conv_svc_ai_group_championship(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_champ uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select g.championship_id into v_champ
  from public.conv_ai_sessions s
  join public.conv_conversations c on c.id = s.conversation_id and c.kind = 'group'
  join public.conv_groups g on g.id = c.group_id
  where s.id = p_session;
  if v_champ is null then return null; end if;
  return conv_private.group_championship_pack(v_champ);
end $$;
revoke all on function public.conv_svc_ai_group_championship(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_ai_group_championship(uuid) to service_role;

-- Apresentação: o grupo (liberado, com IA), a conversa dele, o campeonato e o papo recente que já foi gravado.
create or replace function public.conv_svc_group_intro_context(p_group uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.conv_groups%rowtype; v_conv uuid; v_persona text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  select * into g from public.conv_groups where id = p_group;
  if not found or g.status <> 'allowed' or not g.ai_enabled then return jsonb_build_object('ok', false, 'code', 'GROUP_NOT_ALLOWED'); end if;
  v_conv := conv_private.open_group(g.id);
  select coalesce(a.persona_name, 'João Fonseca') into v_persona from public.conv_ai_settings a where a.active order by a.version desc limit 1;
  return jsonb_build_object('ok', true, 'group_id', g.id, 'group_name', g.name, 'group_jid', g.group_jid, 'conversation_id', v_conv,
    'intro_sent_at', g.intro_sent_at, 'persona', coalesce(v_persona, 'João Fonseca'),
    'championship', case when g.championship_id is not null then conv_private.group_championship_pack(g.championship_id) end,
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('sender', x.sender, 'body', x.body) order by x.created_at), '[]'::jsonb) from (
      select m.created_at, coalesce(p.name, cc.name, 'Participante') as sender, left(m.body, 280) as body
      from public.conv_messages m
      left join public.conv_contacts cc on cc.id = m.sender_contact_id
      left join public.profiles p on p.id = cc.profile_id
      where m.conversation_id = v_conv and m.direction = 'inbound' and m.kind = 'text' and m.deleted_at is null and coalesce(m.body, '') <> ''
      order by m.created_at desc limit 30) x));
end $$;
revoke all on function public.conv_svc_group_intro_context(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_group_intro_context(uuid) to service_role;

create or replace function public.conv_svc_group_intro_done(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  update public.conv_groups set intro_sent_at = coalesce(intro_sent_at, now()) where id = p_group;
end $$;
revoke all on function public.conv_svc_group_intro_done(uuid) from public, anon, authenticated;
grant execute on function public.conv_svc_group_intro_done(uuid) to service_role;

-- Gatilho da IA: igual ao de produção, com a deixa da risada no grupo de campeonato.
CREATE OR REPLACE FUNCTION conv_private.ai_trigger(p_message uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.conv_messages%rowtype; cv public.conv_conversations%rowtype; ch public.conv_channel%rowtype;
  s public.conv_ai_settings%rowtype; g public.conv_groups%rowtype; v_sess public.conv_ai_sessions%rowtype;
  v_reason text; v_admin boolean := false; v_ai_msg public.conv_messages%rowtype; v_requester uuid; v_budget integer;
begin
  select * into m from public.conv_messages where id = p_message and direction = 'inbound';
  if not found then return jsonb_build_object('run', false, 'reason', 'not_inbound'); end if;
  select * into cv from public.conv_conversations where id = m.conversation_id;
  if cv.status <> 'open' then return jsonb_build_object('run', false, 'reason', 'conversation_closed'); end if;
  select * into s from public.conv_ai_settings where active order by version desc limit 1;
  if not found then return jsonb_build_object('run', false, 'reason', 'ai_inactive'); end if;
  select * into ch from public.conv_channel where id;
  if cv.ai_status <> 'ai' then return jsonb_build_object('run', false, 'reason', 'not_ai_conversation'); end if;
  -- Pedido de descadastro não é conversa com a IA.
  if cv.kind = 'direct' and m.kind = 'text' and conv_private.is_opt_out(m.body) then return jsonb_build_object('run', false, 'reason', 'opt_out'); end if;
  select count(*) into v_budget from public.conv_ai_decisions where created_at >= date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza';
  if v_budget >= s.daily_turn_budget then return jsonb_build_object('run', false, 'reason', 'budget_exhausted'); end if;

  if cv.kind = 'direct' then
    if not ch.ai_direct_enabled then return jsonb_build_object('run', false, 'reason', 'direct_ai_off'); end if;
    v_requester := cv.contact_id; v_reason := 'direct_message';
    select * into v_sess from public.conv_ai_sessions where conversation_id = cv.id and requester_contact_id = v_requester and status = 'open' for update;
    if found and v_sess.expires_at <= now() then
      update public.conv_ai_sessions set status = 'expired' where id = v_sess.id;
      v_sess := null;
    end if;
    if v_sess.id is null then
      insert into public.conv_ai_sessions(conversation_id, requester_contact_id, trigger_message_id, expires_at)
      values (cv.id, v_requester, m.id, now() + interval '24 hours') returning * into v_sess;
    else
      update public.conv_ai_sessions set expires_at = now() + interval '24 hours' where id = v_sess.id;
    end if;
  else
    select * into g from public.conv_groups where id = cv.group_id;
    if not (ch.ai_group_enabled and ch.mention_verified_at is not null and g.ai_enabled and g.status = 'allowed') then
      return jsonb_build_object('run', false, 'reason', 'group_ai_off');
    end if;
    if m.sender_contact_id is null then return jsonb_build_object('run', false, 'reason', 'no_sender'); end if;
    v_requester := m.sender_contact_id;
    if m.mention_direct then
      v_reason := 'direct_mention';
      select * into v_sess from public.conv_ai_sessions where conversation_id = cv.id and requester_contact_id = v_requester and status = 'open' for update;
      if found and v_sess.expires_at <= now() then
        update public.conv_ai_sessions set status = 'expired' where id = v_sess.id; v_sess := null;
      end if;
      if v_sess.id is null then
        insert into public.conv_ai_sessions(conversation_id, requester_contact_id, trigger_message_id, expires_at)
        values (cv.id, v_requester, m.id, now() + make_interval(mins => ch.group_session_minutes)) returning * into v_sess;
      else
        update public.conv_ai_sessions set expires_at = now() + make_interval(mins => ch.group_session_minutes) where id = v_sess.id;
      end if;
    else
      -- (b) continuação: mesmo solicitante, sessão aberta, a IA estava esperando resposta.
      select * into v_sess from public.conv_ai_sessions where conversation_id = cv.id and requester_contact_id = v_requester
        and status = 'open' and awaiting and expires_at > now() for update;
      if found then
        v_reason := 'session_followup';
        update public.conv_ai_sessions set expires_at = now() + make_interval(mins => ch.group_session_minutes) where id = v_sess.id;
      else
        -- (b') rajada: o solicitante manda o pedido em duas mensagens seguidas (a 2ª sem menção) antes de a IA falar.
        select * into v_sess from public.conv_ai_sessions where conversation_id = cv.id and requester_contact_id = v_requester
          and status = 'open' and turns = 0 and started_at > now() - interval '90 seconds' and expires_at > now() for update;
        if found then v_reason := 'burst'; end if;
      end if;
      if v_reason is not null then
        null;   -- continuação já decidida acima
      elsif m.reply_to_provider_id is not null then
        -- (c) Reply no grupo é uma forma explícita de falar com o João.
        -- A mensagem citada pode ser de uma sessão conversacional OU uma fala
        -- proativa do João (ex.: bom dia diário), que não possui ai_session_id.
        select * into v_ai_msg
        from public.conv_messages
        where provider_message_id = m.reply_to_provider_id
          and origin = 'ai'
          and conversation_id = cv.id;

        if not found then
          return jsonb_build_object('run', false, 'reason', 'no_trigger');
        end if;

        -- Se a fala citada já pertence à sessão deste mesmo membro, continua nela.
        if v_ai_msg.ai_session_id is not null then
          select * into v_sess
          from public.conv_ai_sessions
          where id = v_ai_msg.ai_session_id
            and status = 'open'
            and expires_at > now()
          for update;

          if found and v_sess.requester_contact_id = v_requester then
            update public.conv_ai_sessions
            set expires_at = now() + make_interval(mins => ch.group_session_minutes)
            where id = v_sess.id;
            v_reason := 'reply_to_ai';
          end if;
        end if;

        -- Reply de outro membro, ou reply a uma fala proativa sem sessão:
        -- abre/continua uma sessão PRÓPRIA para quem respondeu. Assim qualquer
        -- participante pode responder ao João sem @ e sem herdar a sessão alheia.
        if v_reason is null then
          select * into v_sess
          from public.conv_ai_sessions
          where conversation_id = cv.id
            and requester_contact_id = v_requester
            and status = 'open'
            and expires_at > now()
          order by started_at desc
          limit 1
          for update;

          if not found then
            insert into public.conv_ai_sessions(conversation_id, requester_contact_id, trigger_message_id, expires_at)
            values (cv.id, v_requester, m.id, now() + make_interval(mins => ch.group_session_minutes))
            returning * into v_sess;
          else
            update public.conv_ai_sessions
            set expires_at = now() + make_interval(mins => ch.group_session_minutes)
            where id = v_sess.id;
          end if;

          v_reason := 'reply_to_ai';
        end if;
      elsif m.kind = 'text' and m.body is not null
        and length(btrim(m.body)) >= 4
        and (m.body ~* '(set|placar|partida|jogando|jogar|jogou|ganhando|perdendo|ganhou|perdeu|venceu|vencendo|resultado|semifinal|final|super[ -]?tie|tie[ -]?break|campeonato|circuito|torneio|ponto|parcial|[0-9]+[[:space:]]*[x×-][[:space:]]*[0-9]+)'
          -- Grupo de campeonato: a turma rindo (kkk, haha, 😂) também é deixa para o João entrar na resenha.
          or (g.championship_id is not null and m.body ~* '(k{3,}|(ha){2,}|(rs){2,}|😂|🤣)'))
        and m.body !~* '(reservar|reserva|agendar|cancelar|reagendar|marcar um jogo|marcar uma aula|hor[aá]rio da aula|pagamento|mensalidade)'
      then
        -- Janela de 24h, isolada ao grupo permitido e sem dependência de cron.
        -- UPDATE com predicado garante limite/cooldown atômicos mesmo com webhook concorrente.
        update conv_private.joao_spontaneous_window w
          set last_trigger_at = now(), trigger_count = w.trigger_count + 1
          where w.group_id = g.id
            and w.active_until > now()
            and w.trigger_count < w.max_triggers
            and (w.last_trigger_at is null or w.last_trigger_at <= now() - make_interval(mins => w.cooldown_minutes))
            and not exists (
              select 1 from public.conv_messages own
              where own.conversation_id = cv.id and own.origin = 'ai'
                and own.sent_at > now() - interval '8 minutes'
            );
        if not found then
          return jsonb_build_object('run', false, 'reason', 'no_trigger');
        end if;
        v_reason := 'spontaneous_tennis';
        select * into v_sess from public.conv_ai_sessions
          where conversation_id = cv.id and requester_contact_id = v_requester
            and status = 'open' and expires_at > now()
          order by started_at desc limit 1 for update;
        if not found then
          -- Encerra sessões antigas expiradas antes de abrir a nova.
          update public.conv_ai_sessions set status = 'expired'
            where conversation_id = cv.id and requester_contact_id = v_requester
              and status = 'open' and expires_at <= now();
          insert into public.conv_ai_sessions(conversation_id, requester_contact_id, trigger_message_id, expires_at)
            values (cv.id, v_requester, m.id, now() + make_interval(mins => ch.group_session_minutes))
            returning * into v_sess;
        else
          update public.conv_ai_sessions set expires_at = now() + make_interval(mins => ch.group_session_minutes)
            where id = v_sess.id;
        end if;
      else
        return jsonb_build_object('run', false, 'reason', 'no_trigger');
      end if;
    end if;
  end if;

  update public.conv_messages set ai_session_id = v_sess.id where id = m.id;
  return jsonb_build_object('run', true, 'reason', v_reason, 'session_id', v_sess.id, 'conversation_id', cv.id,
    'sender_contact_id', m.sender_contact_id, 'is_group', cv.kind = 'group', 'acting_admin', v_admin);
end $function$;

-- O grupo do AUGE OPEN: liberado, com o João, ligado ao Serra e Sertão e com a janela espontânea até o fim do evento.
update public.conv_groups g set status = 'allowed', ai_enabled = true, allowed_at = coalesce(g.allowed_at, now()),
  championship_id = (select c.id from public.championships c where c.name = 'Serra e Sertão 2026' order by c.created_at desc limit 1)
where g.name = 'AUGE OPEN - 3ª Etapa Serra & Sertão';

insert into conv_private.joao_spontaneous_window (group_id, active_until, max_triggers, cooldown_minutes)
select g.id, coalesce((select c.end_date from public.championships c where c.id = g.championship_id), current_date + 30) + interval '1 day', 100, 20
from public.conv_groups g where g.name = 'AUGE OPEN - 3ª Etapa Serra & Sertão' and g.championship_id is not null
on conflict (group_id) do update set active_until = excluded.active_until, started_at = now(), trigger_count = 0,
  last_trigger_at = null, max_triggers = excluded.max_triggers, cooldown_minutes = excluded.cooldown_minutes;

-- Rollback: championship_id/intro_sent_at podem ficar; reaplicar members_group_conversation e conv_svc_welcome_groups de
-- 20261008143837, ai_trigger da versão anterior (sem a linha da risada), e conv_set_group(<grupo>, 'detected', false).
