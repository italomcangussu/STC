// O turno montado: quem fala, onde, o que mandou, o contexto, e as três saídas que todas as etapas usam
// (falar, salvar e transferir). Cada etapa do turno recebe este objeto em vez de uma dúzia de variáveis soltas.

import { actingFor } from './promptContext.ts';
import type { AiSettings, Ctx } from './promptTypes.ts';
import { cadence } from './cadence.ts';
import { MEMBER_FAIL, TRANSFER_DIRECT, memberKeep } from './serverRules.ts';
import { type Bubble, turnDelivery } from './turnDelivery.ts';
import type { Memory, TurnDeps, TurnResult } from './turnTypes.ts';

export type TurnBase = {
  deps: TurnDeps; messageId: string; session: string; conversation: string; isGroup: boolean;
  ctx: Ctx; settings: AiSettings; latest: () => Promise<boolean>;
  pendentes: Ctx[]; buffered: string; soMidia: boolean; ultima: Ctx | undefined; today: string;
};

type Payload = Record<string, unknown>;
type SayOpts = { awaiting?: boolean; memory?: Memory | null; action?: string | null };
type TransferOpts = { falar?: boolean; texto?: string; fechar?: boolean };

export type Turn = TurnBase & ReturnType<typeof turnDelivery> & {
  /** Sócio (ou admin) e assessor de professor no privado nunca vão para atendimento humano. O banco também recusa (ai_handoff). */
  socioNoPrivado: boolean;
  /** Memória com que a sessão chegou (antes de qualquer assunto restaurado). */
  sessionMemory: Memory;
  save: (memory: Memory | null, decision: string, payload: Payload, flags: { awaiting: boolean; close: boolean }) => PromiseLike<unknown>;
  /** Fala, salva a decisão (o payload recebe quantas bolhas saíram) e devolve o resultado do turno. */
  say: (messages: string[], decision: string, payload: (sent: number) => Payload, opts?: SayOpts) => Promise<TurnResult>;
  transferir: (kind: 'soft' | 'hard', note: string, memory: Memory | null, opts?: TransferOpts) => Promise<TurnResult>;
  /** A decisão pediu a equipe: grupo e sócio no privado ouvem uma frase; no resto a conversa vai para a equipe. */
  handoff: (bubbles: string[], h: { kind: 'soft' | 'hard'; note: string }, memory: Memory, action: string | null | undefined) => Promise<TurnResult>;
};

export function turnKit(b: TurnBase): Turn {
  const { deps, session, isGroup, ctx, messageId } = b;
  const db = deps.db;
  const delivery = turnDelivery({ deps, conversation: b.conversation, session, isGroup, replyTo: b.ultima?.id as string | undefined, latest: b.latest });
  const { entregar } = delivery;
  const socioNoPrivado = !isGroup && (((ctx.requester as Ctx | undefined)?.profile as Ctx | undefined)?.is_member === true || actingFor(ctx) !== null);
  const sessionMemory = (ctx.session?.memory ?? {}) as Memory;

  const save: Turn['save'] = (memory, decision, payload, { awaiting, close }) =>
    db('conv_svc_ai_save_turn', { p_session: session, p_memory: memory, p_decision: decision, p_payload: payload, p_awaiting: awaiting, p_close: close });

  const say: Turn['say'] = async (messages, decision, payload, opts = {}) => {
    const sent = messages.length ? await entregar(cadence(messages)) : 0;
    await save(opts.memory === undefined ? sessionMemory : opts.memory, decision, payload(sent), { awaiting: opts.awaiting ?? false, close: false });
    return { status: 'replied', bubbles: sent, handoff: null, ...(opts.action !== undefined ? { action: opts.action } : {}) } as TurnResult;
  };

  const handoffTo = async (kind: 'soft' | 'hard', note: string) => db('conv_svc_ai_handoff', { p_session: session, p_kind: kind, p_note: note });

  const transferir: Turn['transferir'] = async (kind, note, memory, { falar = true, texto, fechar } = {}) => {
    const reason = note.slice(0, 200);
    if (socioNoPrivado) {
      const enviadas = falar ? await entregar(cadence([texto ?? memberKeep(messageId)])) : 0;
      await save(memory, 'member_no_handoff', { reason, kind }, { awaiting: !fechar, close: fechar === true });
      return { status: 'replied', bubbles: enviadas, handoff: null } as TurnResult;
    }
    if (isGroup) return say(falar ? ['Não tenho essa informação confirmada.'] : [], 'group_no_handoff', () => ({ reason }), { memory });
    if (falar) await entregar(cadence([TRANSFER_DIRECT]));
    await handoffTo(kind, note);
    await save(memory, `handoff_${kind}`, { reason }, { awaiting: false, close: kind === 'hard' });
    return { status: 'handoff', handoff: kind } as TurnResult;
  };

  const handoff: Turn['handoff'] = async (bubbles, h, memory, action) => {
    const reason = h.note.slice(0, 200);
    if (socioNoPrivado) return say([MEMBER_FAIL], 'member_no_handoff', () => ({ action, reason }), { memory, action });
    if (isGroup) return say(['Não consegui concluir isso por aqui.'], 'group_no_handoff', () => ({ action, reason }), { memory, action });
    await entregar(cadence(bubbles));
    await handoffTo(h.kind, h.note);
    await save(memory, `handoff_${h.kind}`, { action, reason }, { awaiting: false, close: h.kind === 'hard' });
    return { status: 'handoff', handoff: h.kind, action } as TurnResult;
  };

  return { ...b, ...delivery, socioNoPrivado, sessionMemory, save, say, transferir, handoff };
}

export type { Bubble };
