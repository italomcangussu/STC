-- O João entra na brincadeira do grupo do campeonato (Italo, 30/10). Na noite de 30/10 a turma do AUGE OPEN fez a
-- resenha do "golpe de estado" (Hermeson "assumiu o posto" do Rafael, "nova administração trazendo melhorias") e o João
-- ficou de fora: a única deixa espontânea era kkk/haha/rs/😂/🤣, e o "😆😆" do golpe não contava. Ele entrou uma vez,
-- no "Kkkkk", só com uma reação, e o intervalo de 20 min segurou o resto.
-- Agora, só no grupo de campeonato, também são deixa: 😆 😅 🤪 🤭 😹, "kakaka", "hue" e o nome dele solto ("João",
-- sem @). E o intervalo da janela espontânea desse grupo cai para 10 min (a trava de 8 min sem fala dele continua).

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
          -- Grupo de campeonato: a turma rindo (kkk, haha, 😂, 😆…) ou chamando o João pelo nome também é deixa para ele entrar na resenha.
          or (g.championship_id is not null and m.body ~* '(k{3,}|(ha){2,}|(rs){2,}|(ka){2,}|hue|😂|🤣|😆|😅|🤪|🤭|😹|\mjo[aã]o\M)'))
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

update conv_private.joao_spontaneous_window w set cooldown_minutes = 10
from public.conv_groups g where g.id = w.group_id and g.championship_id is not null and w.cooldown_minutes > 10;

-- Rollback: reaplicar conv_private.ai_trigger de 20261030170000 e voltar cooldown_minutes para 20 no grupo do AUGE OPEN.
