/**
 * Continuidade cognitiva do João: uma sessão técnica pode expirar, mas um assunto
 * não termina por contagem de turnos ou por timeout. Nunca transporta uma
 * autorização transacional: propostas precisam ser revalidadas pelo banco.
 */
export type TopicStatus = 'awaiting_data' | 'awaiting_confirmation' | 'suspended' | 'completed' | 'canceled';
export type TopicMode = 'continue' | 'new' | 'resume';

export type TopicSnapshot = {
  id: string;
  intent: string;
  status: TopicStatus;
  slots: Record<string, unknown>;
  summary: string;
  last_question: string | null;
  updated_at: string;
};

export type TopicMemory = {
  intent?: string;
  slots?: object;
  summary?: string;
  topics?: TopicSnapshot[];
  active_topic_id?: string | null;
  [key: string]: unknown;
};

const ACTIONS = new Set(['reservar', 'cancelar', 'remarcar', 'entrar', 'participantes', 'admin_financeiro', 'admin_acao']);
const OPEN = new Set<TopicStatus>(['awaiting_data', 'awaiting_confirmation', 'suspended']);
const MAX_CLOSED_TOPICS = 12;
const MAX_SUMMARY = 480;

function safeTopics(memory: TopicMemory): TopicSnapshot[] {
  return Array.isArray(memory.topics)
    ? memory.topics.filter((t) => t && typeof t.id === 'string' && typeof t.intent === 'string'
      && t.slots && typeof t.slots === 'object' && !Array.isArray(t.slots)) : [];
}

export function openTopics(memory: TopicMemory): TopicSnapshot[] {
  return safeTopics(memory).filter((t) => OPEN.has(t.status));
}

function compactTopics(topics: TopicSnapshot[]): TopicSnapshot[] {
  const pending = topics.filter((t) => OPEN.has(t.status));
  const closed = topics.filter((t) => !OPEN.has(t.status)).slice(-MAX_CLOSED_TOPICS);
  return [...closed, ...pending]; // nunca descartar assuntos pendentes
}

/** Nova sessão técnica: recupera trabalho não concluído do mesmo contato. */
export function restoreConversationMemory<T extends TopicMemory>(current: T, previous: TopicMemory | null | undefined): T {
  if (!previous || !Object.keys(previous).length || (current && Object.keys(current).length)) return current;
  const topics = safeTopics(previous);
  const open = topics.filter((t) => OPEN.has(t.status));
  const selected = open.find((t) => t.id === previous.active_topic_id) ?? open.at(-1);
  return {
    ...current,
    ...(typeof previous.summary === 'string' ? { summary: previous.summary } : {}),
    topics: compactTopics(topics),
    active_topic_id: selected?.id ?? null,
    ...(selected ? { intent: selected.intent, slots: { ...selected.slots } } : {}),
  } as T;
}

/** Seleciona o assunto correto sem herdar dados de uma tarefa de outro tipo. */
export function topicForIntent(memory: TopicMemory, intent: string, mode: TopicMode = 'continue'): TopicSnapshot | null {
  if (!ACTIONS.has(intent) || mode === 'new') return null;
  const open = openTopics(memory).filter((t) => t.intent === intent);
  return open.find((t) => t.id === memory.active_topic_id) ?? open.at(-1) ?? null;
}

export type TopicTurn = {
  intent: string;
  mode?: TopicMode;
  slots: object;
  summary?: string | null;
  action?: string | null;
  awaiting: boolean;
  close: boolean;
  lastQuestion?: string | null;
};

/**
 * Conclui APENAS o assunto efetivamente resolvido. Outras tarefas continuam
 * pendentes. O histórico completo continua em conv_messages; aqui só ficam
 * fatos operacionais resumidos, nunca tokens de autorização nem propostas.
 */
export function trackConversationTopic<T extends TopicMemory>(memory: T, turn: TopicTurn): T {
  const topics = safeTopics(memory).map((t) => ({ ...t, slots: { ...t.slots } }));
  if (!ACTIONS.has(turn.intent)) {
    const hasPending = topics.some((t) => OPEN.has(t.status));
    return { ...memory, topics: compactTopics(topics), active_topic_id: hasPending ? memory.active_topic_id ?? null : null };
  }

  const finished = turn.action === 'admin_confirmed' || turn.action === 'confirmed' || turn.action === 'joined'
    || turn.action === 'participants_changed' || turn.action === 'declined'
    || (turn.close && !turn.awaiting);
  const canceled = turn.action === 'declined';
  const chosen = turn.mode === 'new' ? null : topicForIntent(memory, turn.intent, turn.mode);
  const id = chosen?.id ?? `topic-${topics.reduce((n, t) => Math.max(n, Number(t.id.replace('topic-', '')) || 0), 0) + 1}`;
  const found = topics.findIndex((t) => t.id === id);
  const previous = found >= 0 ? topics[found] : null;
  const status: TopicStatus = finished ? (canceled ? 'canceled' : 'completed')
    : turn.action?.startsWith('proposed') ? 'awaiting_confirmation'
      : turn.awaiting ? 'awaiting_data' : 'suspended';
  const summary = (turn.summary || previous?.summary || '').trim().slice(0, MAX_SUMMARY);
  const updated: TopicSnapshot = {
    id, intent: turn.intent, status,
    slots: finished ? {} : { ...turn.slots },
    summary,
    last_question: finished ? null : turn.awaiting
      ? (turn.lastQuestion?.trim().slice(0, 400) || previous?.last_question || null)
      : previous?.last_question ?? null,
    updated_at: new Date().toISOString(),
  };
  if (found >= 0) topics[found] = updated; else topics.push(updated);
  if (chosen && chosen.id !== memory.active_topic_id) {
    const previousActive = topics.find((t) => t.id === memory.active_topic_id);
    if (previousActive && OPEN.has(previousActive.status)) previousActive.status = 'suspended';
  }
  const nextOpen = topics.filter((t) => OPEN.has(t.status));
  const active = !finished ? updated : nextOpen.find((t) => t.id !== updated.id) ?? null;
  return {
    ...memory,
    topics: compactTopics(topics),
    active_topic_id: active?.id ?? null,
    ...(finished && active ? { intent: active.intent, slots: { ...active.slots } } : {}),
  } as T;
}
