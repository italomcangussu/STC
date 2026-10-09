/**
 * Continuidade cognitiva do João: a sessão técnica expira, o ASSUNTO não.
 *
 * Um assunto é uma tarefa do solicitante (uma reserva, uma receita, uma ação administrativa). Vive em
 * memory.topics da sessão e, por gatilho no banco, em conv_ai_topics, de onde volta em qualquer sessão
 * nova (ctx.durable_topics). Aqui ficam só regras puras: escolher o assunto do turno, atualizar seu
 * ciclo de vida e compactar o que terminou. Nunca carrega autorização: confirmar exige a proposta aberta
 * da sessão atual, revalidada pelo banco.
 */
export type TopicStatus = 'awaiting_data' | 'awaiting_confirmation' | 'suspended' | 'completed' | 'canceled' | 'archived';
export type TopicMode = 'continue' | 'new' | 'resume';
export type TopicDomain = 'agenda' | 'admin';

export type TopicSnapshot = {
  id: string;
  intent: string;
  domain: TopicDomain;
  status: TopicStatus;
  /** Aberto: dados operacionais completos. Encerrado: só os fatos (valores preenchidos). */
  slots: Record<string, unknown>;
  summary: string;
  last_question: string | null;
  next_step: string | null;
  /** Histórico mínimo de decisões (proposta, correção, confirmação, cancelamento). */
  decisions: string[];
  /** Resultado do sistema (ex.: admin_confirmed). Só existe em assunto encerrado. */
  outcome: string | null;
  close_reason: string | null;
  /** Referência da proposta vigente (preenchida pelo banco). Nunca é autorização. */
  proposal_id?: string | null;
  created_at: string;
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

const AGENDA_INTENTS = new Set(['reservar', 'cancelar', 'remarcar', 'entrar', 'participantes']);
const ADMIN_INTENTS = new Set(['admin_financeiro', 'admin_acao']);
/** Trocar entre estas é outra tarefa ("na verdade quero cancelar"); entre as demais da agenda é a mesma conversa sobre o jogo. */
const BOOKING_ACTIONS = new Set(['reservar', 'cancelar', 'remarcar']);
const OPEN = new Set<TopicStatus>(['awaiting_data', 'awaiting_confirmation', 'suspended']);
const EXECUTED = new Set(['admin_confirmed', 'confirmed', 'joined', 'participants_changed']);
const MAX_CLOSED_IN_MEMORY = 6;
const MAX_DECISIONS = 8;
const MAX_SUMMARY = 480;
const REPROPOSE = 'reapresentar a proposta e pedir nova confirmação';
const RESUME_LATER = 'retomar quando a pessoa voltar ao assunto';

export const isOpenTopic = (t: TopicSnapshot) => OPEN.has(t.status);

export function domainOf(intent: string | undefined): TopicDomain | null {
  if (!intent) return null;
  if (AGENDA_INTENTS.has(intent)) return 'agenda';
  return ADMIN_INTENTS.has(intent) ? 'admin' : null;
}

function asTopic(raw: unknown): TopicSnapshot | null {
  const t = raw as Partial<TopicSnapshot> | null;
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.intent !== 'string') return null;
  const domain = domainOf(t.intent);
  if (!domain || !t.status || !(OPEN.has(t.status) || ['completed', 'canceled', 'archived'].includes(t.status))) return null;
  const slots = t.slots && typeof t.slots === 'object' && !Array.isArray(t.slots) ? t.slots : {};
  return {
    id: t.id, intent: t.intent, domain, status: t.status, slots: { ...slots },
    summary: typeof t.summary === 'string' ? t.summary : '',
    last_question: t.last_question ?? null, next_step: t.next_step ?? null,
    decisions: Array.isArray(t.decisions) ? t.decisions.filter((d) => typeof d === 'string').slice(-MAX_DECISIONS) : [],
    outcome: t.outcome ?? null, close_reason: t.close_reason ?? null, proposal_id: t.proposal_id ?? null,
    created_at: t.created_at ?? t.updated_at ?? new Date(0).toISOString(),
    updated_at: t.updated_at ?? new Date(0).toISOString(),
  };
}

function topicsOf(memory: TopicMemory): TopicSnapshot[] {
  return Array.isArray(memory.topics) ? memory.topics.map(asTopic).filter((t): t is TopicSnapshot => t !== null) : [];
}

const byCreation = (a: TopicSnapshot, b: TopicSnapshot) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
const byRecency = (a: TopicSnapshot, b: TopicSnapshot) => b.updated_at.localeCompare(a.updated_at);

/** Assuntos pendentes, na ordem em que nasceram (é a ordem das referências t1, t2… mostradas ao modelo). */
export function openTopics(memory: TopicMemory): TopicSnapshot[] {
  return topicsOf(memory).filter(isOpenTopic).sort(byCreation);
}

export function activeTopic(memory: TopicMemory): TopicSnapshot | null {
  return openTopics(memory).find((t) => t.id === memory.active_topic_id) ?? null;
}

/** "t2" → id do segundo assunto pendente. */
export function topicIdFromRef(memory: TopicMemory, ref: string | null | undefined): string | null {
  const m = /^t(\d{1,2})$/i.exec(String(ref ?? '').trim());
  return m ? openTopics(memory)[Number(m[1]) - 1]?.id ?? null : null;
}

/** Abertos ficam todos; encerrados, só os mais recentes (o banco guarda o resto). */
function compact(topics: TopicSnapshot[]): TopicSnapshot[] {
  const open = topics.filter(isOpenTopic);
  const closed = topics.filter((t) => !isOpenTopic(t)).sort(byRecency).slice(0, MAX_CLOSED_IN_MEMORY);
  return [...closed, ...open].sort(byCreation);
}

/** Só os valores preenchidos: é o que um assunto encerrado precisa lembrar. */
export function factsOf(slots: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(slots).filter(([, v]) =>
    v !== null && v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)));
}

/** O turno trouxe algum dado novo para o assunto? (duração vem do modelo de resposta e não conta.) */
export function bringsNewData(next: object, current: Record<string, unknown>): boolean {
  return Object.entries(factsOf(next)).some(([k, v]) => k !== 'duration' && JSON.stringify(current[k]) !== JSON.stringify(v));
}

export type RestoreInput = { durable?: unknown; openProposalId?: string | null; today: string };

/**
 * Junta o que a sessão sabe com o que o banco guarda (por assunto, o mais novo vence; empate fica com o banco,
 * que tem a referência da proposta) e normaliza:
 * - aguardando confirmação sem a proposta aberta NESTA sessão → suspenso, para reapresentar (contexto volta, autorização não);
 * - assunto de agenda cuja data já passou → arquivado (regra explícita: não há o que reservar no passado).
 */
export function restoreTopics<T extends TopicMemory>(memory: T, input: RestoreInput): T {
  const merged = new Map<string, TopicSnapshot>();
  for (const t of topicsOf(memory)) merged.set(t.id, t);
  const durable = Array.isArray(input.durable) ? input.durable.map(asTopic).filter((t): t is TopicSnapshot => t !== null) : [];
  for (const t of durable) {
    const known = merged.get(t.id);
    if (!known || t.updated_at >= known.updated_at) merged.set(t.id, known && !isOpenTopic(known) ? known : t);
  }
  const topics = [...merged.values()].map((t) => normalize(t, input));
  if (!topics.length) return memory;

  const open = topics.filter(isOpenTopic);
  const active = open.find((t) => t.id === memory.active_topic_id) ?? [...open].sort(byRecency)[0] ?? null;
  const freshSession = memory.intent === undefined && memory.slots === undefined;
  return {
    ...memory,
    topics: compact(topics),
    active_topic_id: active?.id ?? null,
    ...(freshSession && active ? { intent: active.intent, slots: { ...active.slots } } : {}),
  };
}

function normalize(t: TopicSnapshot, input: RestoreInput): TopicSnapshot {
  if (t.status === 'awaiting_confirmation') {
    const live = Boolean(input.openProposalId) && (!t.proposal_id || t.proposal_id === input.openProposalId);
    if (!live) return { ...t, status: 'suspended', proposal_id: null, next_step: REPROPOSE };
  }
  const date = typeof t.slots.date === 'string' ? t.slots.date : null;
  if (t.domain === 'agenda' && isOpenTopic(t) && date && date < input.today) {
    return { ...t, status: 'archived', close_reason: 'a data do pedido já passou', next_step: null, last_question: null };
  }
  return t;
}

const sameTask = (t: TopicSnapshot, intent: string) => t.intent === intent
  || (t.domain === 'agenda' && domainOf(intent) === 'agenda' && !(BOOKING_ACTIONS.has(t.intent) && BOOKING_ACTIONS.has(intent)));

/**
 * Qual assunto pendente este turno continua (null = assunto novo).
 * Referência explícita (t2) vence; senão o ativo, se for a mesma tarefa; senão o pendente mais recente da mesma intenção.
 * "resume" sem referência prefere um pendente que NÃO é o ativo (a pessoa está voltando a algo).
 */
export function selectTopic(memory: TopicMemory, intent: string, mode: TopicMode = 'continue', topicId: string | null = null): TopicSnapshot | null {
  if (!domainOf(intent) || mode === 'new') return null;
  const open = openTopics(memory);
  const byId = topicId ? open.find((t) => t.id === topicId && t.domain === domainOf(intent)) : undefined;
  if (byId) return byId;
  const candidates = open.filter((t) => sameTask(t, intent)).sort(byRecency);
  const active = candidates.find((t) => t.id === memory.active_topic_id);
  if (mode === 'resume') return candidates.find((t) => t.id !== memory.active_topic_id) ?? active ?? null;
  return active ?? candidates.find((t) => t.intent === intent) ?? null;
}

export type TopicTurn = {
  /** Assunto escolhido por selectTopic (null = criar). */
  topic: TopicSnapshot | null;
  intent: string;
  slots: object;
  summary?: string | null;
  /** Ação do servidor no turno (proposed*, admin_confirmed, declined, ask…). */
  action?: string | null;
  awaiting: boolean;
  close: boolean;
  /** A pessoa recusou/desistiu desta tarefa. */
  declined?: boolean;
  lastQuestion?: string | null;
  now?: string;
  newId?: () => string;
};

/**
 * Registra o turno no assunto dele. Só esse assunto muda de estado; os outros pendentes continuam intactos
 * (o que era ativo vira suspenso). Encerrado guarda intenção, fatos, decisões e resultado do sistema.
 */
export function recordTopicTurn<T extends TopicMemory>(memory: T, turn: TopicTurn): T {
  const topics = topicsOf(memory);
  const domain = domainOf(turn.intent);
  if (!domain) return { ...memory, topics: compact(topics) };

  const now = turn.now ?? new Date().toISOString();
  const previous = turn.topic ? topics.find((t) => t.id === turn.topic!.id) ?? turn.topic : null;
  const executed = EXECUTED.has(turn.action ?? '');
  const canceled = !executed && (turn.declined === true || turn.action === 'declined' || (turn.close && !turn.awaiting));
  // Proposta aberta segue valendo enquanto a pessoa não muda nenhum dado (recusa, dúvida, conversa no meio);
  // dado alterado exige proposta nova, nunca a confirmação da antiga.
  const stillProposed = previous?.status === 'awaiting_confirmation' && !bringsNewData(turn.slots, previous.slots);
  const proposed = !executed && !canceled && (Boolean(turn.action?.startsWith('proposed')) || stillProposed);
  const status: TopicStatus = executed ? 'completed' : canceled ? 'canceled' : proposed ? 'awaiting_confirmation' : turn.awaiting ? 'awaiting_data' : 'suspended';
  const closed = status === 'completed' || status === 'canceled';
  const facts = factsOf(turn.slots);

  const updated: TopicSnapshot = {
    id: previous?.id ?? (turn.newId ?? (() => crypto.randomUUID()))(),
    intent: turn.intent, domain, status,
    slots: closed ? facts : { ...turn.slots } as Record<string, unknown>,
    summary: (turn.summary || previous?.summary || '').trim().slice(0, MAX_SUMMARY),
    last_question: closed ? null : turn.awaiting ? (turn.lastQuestion?.trim().slice(0, 400) || previous?.last_question || null) : previous?.last_question ?? null,
    next_step: closed ? null : proposed ? 'aguardando a confirmação da proposta' : turn.awaiting ? 'aguardando resposta da pessoa' : RESUME_LATER,
    decisions: [...(previous?.decisions ?? []), ...decisionsOf(previous, status, facts, turn.action)].slice(-MAX_DECISIONS),
    outcome: executed ? turn.action ?? null : canceled ? 'canceled' : null,
    close_reason: canceled ? (turn.declined || turn.action === 'declined' ? 'a pessoa desistiu' : 'encerrado na conversa sem execução') : null,
    proposal_id: proposed ? previous?.proposal_id ?? null : null,
    created_at: previous?.created_at ?? now,
    updated_at: now,
  };

  const rest = topics.filter((t) => t.id !== updated.id).map((t) => {
    if (!isOpenTopic(t)) return t;
    // Só há uma proposta aberta por sessão: a nova substitui a de outro assunto.
    if (proposed && t.status === 'awaiting_confirmation') return { ...t, status: 'suspended' as const, proposal_id: null, next_step: REPROPOSE, updated_at: now };
    // Quem estava aguardando dado fica suspenso; quem tem proposta aberta continua dono dela.
    if (t.id === memory.active_topic_id && t.status === 'awaiting_data') return { ...t, status: 'suspended' as const, updated_at: now };
    return t;
  });
  const all = [...rest, updated];
  const nextActive = closed ? all.filter(isOpenTopic).sort(byRecency)[0] ?? null : updated;
  return {
    ...memory,
    topics: compact(all),
    active_topic_id: nextActive?.id ?? null,
    ...(closed ? { intent: nextActive?.intent ?? turn.intent, slots: nextActive ? { ...nextActive.slots } : {} } : {}),
  };
}


function decisionsOf(previous: TopicSnapshot | null, status: TopicStatus, facts: Record<string, unknown>, action?: string | null): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(facts)) {
    const before = previous?.slots[k];
    if (before !== undefined && before !== null && before !== '' && JSON.stringify(before) !== JSON.stringify(v)) out.push(`corrigiu ${k}: ${short(before)} → ${short(v)}`);
  }
  if (status === 'awaiting_confirmation' && previous?.status !== 'awaiting_confirmation') out.push('proposta apresentada');
  if (status === 'completed') out.push(`concluído pelo sistema (${action})`);
  if (status === 'canceled') out.push('cancelado; nada será executado');
  return out;
}

const short = (v: unknown) => String(Array.isArray(v) ? v.join(', ') : v).slice(0, 40);

const STATUS_TEXT: Record<TopicStatus, string> = {
  awaiting_data: 'aguardando dado', awaiting_confirmation: 'aguardando confirmação da proposta', suspended: 'suspenso',
  completed: 'concluído', canceled: 'cancelado', archived: 'arquivado',
};

/** Seção do prompt: pendências completas (nada operacional é cortado) e resultados recentes em uma linha. */
export function topicsPromptText(memory: TopicMemory, outcomes: unknown = []): string {
  const open = openTopics(memory);
  const lines = open.map((t, i) => {
    const facts = JSON.stringify(factsOf(t.slots));
    return `- t${i + 1}${t.id === memory.active_topic_id ? ' (ATIVO)' : ''} [${t.intent} · ${STATUS_TEXT[t.status]}] ${t.summary || '(sem resumo)'}`
      + `\n  dados: ${facts}${t.last_question ? `\n  sua última pergunta: "${t.last_question}"` : ''}${t.next_step ? `\n  próximo passo: ${t.next_step}` : ''}`
      + `${t.decisions.length ? `\n  decisões: ${t.decisions.join('; ')}` : ''}`;
  });
  const closedInMemory = topicsOf(memory).filter((t) => !isOpenTopic(t));
  const fromDb = Array.isArray(outcomes) ? outcomes as { id?: string; intent?: string; status?: string; summary?: string; outcome?: string }[] : [];
  const done = [...closedInMemory.map((t) => ({ id: t.id, intent: t.intent, status: t.status, summary: t.summary })), ...fromDb]
    .filter((t, i, all) => t.id && all.findIndex((x) => x.id === t.id) === i).slice(-5)
    .map((t) => `- [${t.intent} · ${STATUS_TEXT[t.status as TopicStatus] ?? t.status}] ${t.summary ?? ''}`.trimEnd());
  return `${lines.length ? lines.join('\n') : '(nenhum assunto pendente)'}${done.length ? `\nEncerrados recentemente (não reabrir nem repetir; só referência):\n${done.join('\n')}` : ''}`;
}
