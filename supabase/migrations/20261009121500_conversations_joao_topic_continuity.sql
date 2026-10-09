-- João · continuidade por assunto (três camadas que não dependem umas das outras para sobreviver)
--
-- 1. SESSÃO TÉCNICA (conv_ai_sessions): transporte e processamento. Continua expirando (24h no privado, janela do grupo).
-- 2. ASSUNTO OPERACIONAL (conv_ai_topics, NOVA): uma tarefa do solicitante naquela conversa. Sobrevive a quantas sessões
--    forem precisas e só sai das pendências quando é concluída, cancelada ou arquivada por regra explícita.
--    Em grupo o isolamento é por participante (conversa + solicitante).
-- 3. MEMÓRIA CONSOLIDADA: resultado resumido dos assuntos encerrados (outcome + fatos) e o resumo da conversa.
--
-- O turno (turn.ts) continua escrevendo SÓ conv_ai_sessions.memory via ai_save_turn; um gatilho espelha memory.topics
-- nesta tabela, na mesma transação. Escrita atrasada (updated_at mais antigo) não sobrescreve estado mais novo e assunto
-- encerrado não reabre. O contexto do turno (conv_svc_ai_context) passa a trazer os assuntos abertos da tabela.
--
-- Segurança: o assunto guarda só a REFERÊNCIA da proposta vigente, nunca uma autorização. Confirmar continua exigindo
-- a proposta aberta da sessão atual, a mensagem posterior do solicitante (ou admin) e a revalidação de ai_confirm.
-- Cancelar um assunto cancela a proposta aberta que pertence a ele.
--
-- Rollback: drop trigger conv_ai_sessions_sync_topics; drop function conv_private.ai_sync_topics, conv_private.ai_context_continuity;
-- recriar public.conv_svc_ai_context chamando conv_private.ai_context; drop table public.conv_ai_topics; voltar
-- conv_private.is_semantic_acceptance ao corpo de 20261007100700.

create table public.conv_ai_topics (
  id uuid primary key,
  conversation_id uuid not null references public.conv_conversations(id),
  requester_contact_id uuid not null references public.conv_contacts(id),
  session_id uuid references public.conv_ai_sessions(id),
  intent text not null check (length(intent) between 1 and 40),
  domain text not null default 'outro' check (domain in ('agenda', 'admin', 'outro')),
  status text not null check (status in ('awaiting_data', 'awaiting_confirmation', 'suspended', 'completed', 'canceled', 'archived')),
  slots jsonb not null default '{}'::jsonb,
  summary text not null default '',
  last_question text,
  next_step text,
  decisions jsonb not null default '[]'::jsonb,
  outcome text,
  proposal_id uuid references public.conv_booking_proposals(id) on delete set null,
  close_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index conv_ai_topics_owner_idx on public.conv_ai_topics(conversation_id, requester_contact_id, status, updated_at desc);
alter table public.conv_ai_topics enable row level security;
-- Sem política: só o service role e as funções definer leem e escrevem.
revoke all on table public.conv_ai_topics from public, anon, authenticated;

-- Espelha memory.topics da sessão na tabela durável. Nunca derruba o turno: item inválido é ignorado.
create function conv_private.ai_sync_topics() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t jsonb;
  v_id uuid; v_status text; v_updated timestamptz; v_created timestamptz; v_proposal uuid; v_closed boolean;
begin
  if jsonb_typeof(new.memory -> 'topics') is distinct from 'array' then return new; end if;
  for t in select x from jsonb_array_elements(new.memory -> 'topics') x loop
    begin
      v_id := (t ->> 'id')::uuid;
      v_status := t ->> 'status';
      v_updated := least(coalesce((t ->> 'updated_at')::timestamptz, now()), now() + interval '1 minute');
      v_created := least(coalesce((t ->> 'created_at')::timestamptz, v_updated), v_updated);
      v_closed := v_status in ('completed', 'canceled', 'archived');
      v_proposal := null;
      if v_status = 'awaiting_confirmation' then
        -- A proposta aberta desta sessão, criada neste turno ou antes: só referência, nunca autorização.
        select bp.id into v_proposal from public.conv_booking_proposals bp
         where bp.session_id = new.id and bp.status = 'open' order by bp.created_at desc limit 1;
      end if;

      insert into public.conv_ai_topics as cur (id, conversation_id, requester_contact_id, session_id, intent, domain, status, slots,
        summary, last_question, next_step, decisions, outcome, proposal_id, close_reason, created_at, updated_at, closed_at)
      values (v_id, new.conversation_id, new.requester_contact_id, new.id, left(t ->> 'intent', 40),
        case when t ->> 'domain' in ('agenda', 'admin') then t ->> 'domain' else 'outro' end, v_status,
        case when jsonb_typeof(t -> 'slots') = 'object' then t -> 'slots' else '{}'::jsonb end,
        left(coalesce(t ->> 'summary', ''), 600), left(t ->> 'last_question', 400), left(t ->> 'next_step', 200),
        case when jsonb_typeof(t -> 'decisions') = 'array' then t -> 'decisions' else '[]'::jsonb end,
        left(t ->> 'outcome', 200), v_proposal, left(t ->> 'close_reason', 200), v_created, v_updated,
        case when v_closed then v_updated end)
      on conflict (id) do update set
        session_id = excluded.session_id, intent = excluded.intent, domain = excluded.domain, status = excluded.status,
        slots = excluded.slots, summary = excluded.summary, last_question = excluded.last_question, next_step = excluded.next_step,
        decisions = excluded.decisions, outcome = excluded.outcome,
        proposal_id = case when excluded.status = 'awaiting_confirmation' then coalesce(excluded.proposal_id, cur.proposal_id) else cur.proposal_id end,
        close_reason = excluded.close_reason, updated_at = excluded.updated_at, closed_at = excluded.closed_at
      where cur.conversation_id = excluded.conversation_id
        and cur.requester_contact_id = excluded.requester_contact_id
        and cur.status not in ('completed', 'canceled', 'archived')
        and excluded.updated_at >= cur.updated_at;

      -- Assunto cancelado: a proposta dele não pode mais ser confirmada.
      if v_status = 'canceled' then
        update public.conv_booking_proposals bp set status = 'canceled'
          from public.conv_ai_topics tp
         where tp.id = v_id and tp.status = 'canceled' and bp.id = tp.proposal_id and bp.status = 'open';
      end if;
    exception when others then
      raise warning 'ai_sync_topics: assunto ignorado (%)', sqlerrm;
    end;
  end loop;
  return new;
end $$;
revoke all on function conv_private.ai_sync_topics() from public, anon, authenticated;

create trigger conv_ai_sessions_sync_topics
  after insert or update of memory on public.conv_ai_sessions
  for each row execute function conv_private.ai_sync_topics();

-- Contexto do turno + assuntos duráveis do MESMO solicitante na MESMA conversa (sem janela de dias para os abertos).
create function conv_private.ai_context_continuity(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select conversation_id, requester_contact_id from public.conv_ai_sessions where id = p_session)
  select conv_private.ai_context(p_session) || jsonb_build_object(
    'durable_topics', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.updated_at)
      from (select t.id, t.intent, t.domain, t.status, t.slots, t.summary, t.last_question, t.next_step, t.decisions,
                   t.outcome, t.proposal_id, t.created_at, t.updated_at
              from public.conv_ai_topics t join s on s.conversation_id = t.conversation_id and s.requester_contact_id = t.requester_contact_id
             where t.status in ('awaiting_data', 'awaiting_confirmation', 'suspended')
             order by t.updated_at desc limit 30) x), '[]'::jsonb),
    'topic_outcomes', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.closed_at)
      from (select t.id, t.intent, t.status, t.summary, t.outcome, t.close_reason, t.closed_at
              from public.conv_ai_topics t join s on s.conversation_id = t.conversation_id and s.requester_contact_id = t.requester_contact_id
             where t.status in ('completed', 'canceled') and t.closed_at > now() - interval '30 days'
             order by t.closed_at desc limit 5) x), '[]'::jsonb))
$$;
revoke all on function conv_private.ai_context_continuity(uuid) from public, anon, authenticated;

-- Mesmo wrapper (assinatura, dono e grants preservados pelo create or replace).
create or replace function public.conv_svc_ai_context(p_session uuid) returns jsonb
language sql security definer set search_path = '' as $f$ select conv_private.ai_context_continuity(p_session) $f$;

-- Guarda de aceite no BANCO, independente do modelo. Chamada só quando o modelo diz que a pessoa aceitou a PROPOSTA;
-- aqui se barra o que não pode ser aceite. Precisa de ao menos um termo de concordância ou de execução e de NENHUM termo
-- de recusa, dúvida, adiamento, condição ou mudança. Não é lista de frases: é vocabulário por palavra, com bloqueio que vence.
create or replace function conv_private.is_semantic_acceptance(p text, p_allow_cancel boolean default false) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  t text;
  words text[];
  accept text[] := array[
    'sim','s','isso','exato','exatamente','certo','certinho','correto','perfeito','confirmo','confirma','confirmar','confirmado','confirmada',
    'pode','claro','ok','okay','oks','fechado','fechou','combinado','beleza','blz','positivo','aham','uhum','bora','vamos','topo','aceito',
    'autorizo','autorizado','autorizada','aprovado','aprovada','aprovo','aprova','manda','mande','prossiga','prossegue','segue','siga',
    'lanca','lance','lancar','registra','registre','registrar','faz','faca','fazer','executa','execute','envia','envie','enviar','posta','poste',
    'marca','marque','reserva','reserve','entro','cadastra','cadastre','baixa','essa','esse','show','dale','partiu','top','massa'];
  blockers text[] := array[
    'nao','n','nunca','jamais','negativo','nem','nada','nope','recuso','recusado','desisto','desisti','errado','errada','incorreto',
    'talvez','depois','ver','pensar','acho','duvida','mas','porem','contudo','entretanto','ou','se','espera','espere','aguarda','aguarde',
    'perai','calma','antes','ainda','so','apenas','tambem','alem','menos','outro','outra','outros','outras','troca','trocar','muda','mudar',
    'altera','alterar','corrige','corrigir','deixa','deixe','deixar','esquece','esqueca','ignora','ignore','ignorar','pare','parar',
    'segura','segure','reconsidera','reconsiderar'];
begin
  if p is null or length(p) > 160 or position('?' in p) > 0 then return false; end if;
  t := btrim(regexp_replace(regexp_replace(conv_private.fold(p), '[^a-z ]', ' ', 'g'), '\s+', ' ', 'g'));
  if t = '' then return false; end if;
  words := string_to_array(t, ' ');
  if cardinality(words) > 12 then return false; end if;
  -- "cancela/cancelar" só é aceite quando a proposta É de cancelamento ("sim, pode cancelar").
  if not p_allow_cancel then blockers := blockers || array['cancela','cancelar','cancelei','cancelado','cancelada','cancele']; end if;
  if words && blockers then return false; end if;
  return words && accept;
end $$;
revoke all on function conv_private.is_semantic_acceptance(text, boolean) from public, anon, authenticated;

-- Falha a migration se uma recusa virar aceite (a suíte PGlite cobre o resto).
do $test$
begin
  if conv_private.is_semantic_acceptance('negativo') or conv_private.is_semantic_acceptance('não quero')
     or conv_private.is_semantic_acceptance('Não, pode deixar') or conv_private.is_semantic_acceptance('sim, mas espera')
     or conv_private.is_semantic_acceptance('agora não') or conv_private.is_semantic_acceptance('talvez')
     or not conv_private.is_semantic_acceptance('isso') or not conv_private.is_semantic_acceptance('pode lançar') then
    raise exception 'JOAO_CONFIRMATION_REGRESSION';
  end if;
end $test$;
