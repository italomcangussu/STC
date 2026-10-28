// Comprovante do Pix de quem tem pré-inscrição no campeonato: o servidor confere valor, favorecido e arquivo e,
// batendo, lança a receita com o comprovante e inscreve na hora (sem confirmação em duas etapas).
// Não bateu: explica o que esperava quando a conversa é sobre a inscrição; senão segue o fluxo comum do comprovante.

import { athleteCard, brl, championshipTitle, dateBR } from './championshipPrompt.ts';
import type { Ctx } from './promptTypes.ts';
import type { ReceiptForward } from './receiptForward.ts';
import type { ReceiptTopic } from './receiptContext.ts';

type Call = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }>;
type Pending = { name: string; class: string };
type Auto = {
  applied?: boolean; reason?: string; championship?: string; amount_cents?: number; total_cents?: number; pending?: Pending[];
  confirmed?: string[]; waitlist?: string[]; admin_conversation_id?: string | null; admin_name?: string; sender_name?: string;
  /** Na confirmação: título do evento, cartão de cada atleta pago e o que o comprovante mostrou. */
  title?: string[]; athletes?: Ctx[]; paid_on?: string | null;
  /** Mídia original do comprovante (conv-media), que vai junto no aviso ao financeiro. */
  media_path?: string | null; media_mime?: string | null; media_name?: string | null; media_kind?: string | null;
};
export type ChampReceipt = { messages: string[]; action: string; forward?: ReceiptForward };

const lista = (nomes: string[]) => nomes.join(', ').replace(/, ([^,]*)$/, ' e $1');

const STATUS_PAGO: Record<string, string> = {
  confirmed: '✅ Confirmada',
  waitlist: '⏳ Lista de espera (pago; a classe lotou antes do pagamento, a organização vai falar com você)',
};

/** Confirmação: o comprovante já foi conferido, então vai o cartão de cada atleta, sem dados bancários. */
function paidMessages(a: Auto): string[] {
  const titulo = championshipTitle({ title: a.title }, a.championship);
  const cartoes = (a.athletes ?? []).map((x) => athleteCard(titulo, x, STATUS_PAGO[String(x.status)] ?? '✅ Confirmada'));
  const quando = a.paid_on ? ` em ${dateBR(a.paid_on)}` : '';
  const conferido = `🧾 Comprovante recebido e conferido: Pix de ${brl(a.amount_cents)}${quando}. Tudo certo no sistema. Bom campeonato! 🎾`;
  return [...(cartoes.length ? cartoes : namesOnly(a)), conferido];
}

/** Sem o cartão (função antiga no banco): os nomes de quem entrou e de quem ficou na espera. */
function namesOnly(a: Auto): string[] {
  const ok = a.confirmed ?? [];
  const espera = a.waitlist ?? [];
  return [...(ok.length ? [`✅ ${ok.length > 1 ? 'Inscrições confirmadas' : 'Inscrição confirmada'} no ${a.championship}: ${lista(ok)}.`] : []),
    ...(espera.length ? [`⏳ Na lista de espera (pago; a classe lotou antes do pagamento): ${lista(espera)}. A organização vai falar com você.`] : [])];
}

/** Quem entrou (com a classe) e quem ficou na espera, para o aviso ao financeiro. */
function athleteLines(a: Auto): string[] {
  const linha = (x: Ctx) => `${x.full_name} (${x.class})`;
  const atletas = a.athletes ?? [];
  const ok = atletas.length ? atletas.filter((x) => x.status === 'confirmed').map(linha) : a.confirmed ?? [];
  const espera = atletas.length ? atletas.filter((x) => x.status === 'waitlist').map(linha) : a.waitlist ?? [];
  return [...(ok.length ? [`✅ *Confirmados:* ${lista(ok)}`] : []), ...(espera.length ? [`⏳ *Pagos, na lista de espera:* ${lista(espera)}`] : [])];
}

/**
 * Aviso ao responsável pelo financeiro (pedido do Hermeson, 26/10): o que entrou no caixa, em cartão, e o próprio
 * comprovante logo depois, para ele conferir sem abrir o painel.
 */
function financeNotice(a: Auto): ReceiptForward | undefined {
  if (!a.admin_conversation_id) return undefined;
  const titulo = championshipTitle({ title: a.title }, a.championship)[0];
  const cartao = [`💰 *Inscrição paga · ${titulo}*`, '', `👤 *Pagou:* ${a.sender_name}`, ...athleteLines(a), `💵 *Valor:* ${brl(a.amount_cents)}`,
    ...(a.paid_on ? [`📅 *Data do Pix:* ${dateBR(a.paid_on)}`] : []), '🧾 *Caixa:* receita lançada em Inscrição Serra e Sertão, com o comprovante anexado'];
  return { admin_conversation_id: a.admin_conversation_id, admin_name: a.admin_name ?? '', sender_name: a.sender_name ?? '', kind: 'championship_auto', detail: null,
    media_path: a.media_path ?? null, media_mime: a.media_mime ?? null, media_name: a.media_name ?? null, media_kind: a.media_kind ?? null,
    text: `${a.admin_name}, para você saber, entrou no caixa:\n\n${cartao.join('\n')}` };
}

/** O Pix é da inscrição: a conversa é sobre o campeonato, ou o valor é múltiplo do preço de uma inscrição. */
function looksLikeSignup(a: Auto, topic: ReceiptTopic | null): boolean {
  if (topic === 'campeonato') return true;
  if (topic) return false;
  const preco = Number(a.total_cents) / Math.max(1, a.pending?.length ?? 1);
  return preco > 0 && Number(a.amount_cents) > 0 && Number(a.amount_cents) % preco === 0;
}

function mismatchReply(a: Auto): ChampReceipt | null {
  const quem = lista((a.pending ?? []).map((p) => p.name));
  const total = brl(a.total_cents);
  if (a.reason === 'AMOUNT_NOT_READ') {
    return { action: 'receipt_championship_unread', messages: ['Recebi o comprovante, mas não consegui ler o valor. Me manda uma foto mais nítida, ou o PDF do comprovante, que eu confiro a inscrição.'] };
  }
  if (a.reason === 'PAYEE') {
    return { action: 'receipt_championship_payee', messages: [`Recebi o comprovante, mas não vi o clube como favorecido. O Pix da inscrição é para o Sobral Tênis Clube, na chave que te passei. Pode conferir?`] };
  }
  if (a.reason === 'AMBIGUOUS' || a.reason === 'AMOUNT_MISMATCH') {
    return { action: 'receipt_championship_amount', messages: [
      `Recebi o comprovante de ${brl(a.amount_cents)}, mas as inscrições esperando o Pix (${quem}) somam ${total}.`,
      'Para eu confirmar na hora, o Pix precisa ser do total das inscrições pendentes. Se esse pagamento é de outra coisa, me diz do que é.',
    ] };
  }
  return null;
}

/** Pagou antes de se inscrever (caso Bruno, 28/10): o comprovante fica guardado, sem ir ao financeiro, até a inscrição existir. */
export const HOLD = 'receipt_championship_hold';
const holdReply: ChampReceipt = { action: HOLD, messages: [
  'Recebi seu comprovante 🧾 Pra eu confirmar a inscrição, me passa o nome completo do atleta, a classe (4ª ou 5ª), o tamanho da camisa e a cidade.'] };

/** Tenta confirmar a inscrição pelo comprovante. null = não é (ou não dá para saber se é) da inscrição: segue o fluxo comum. */
export async function tryChampionshipPay(db: Call, stageId: string, topic: ReceiptTopic | null): Promise<ChampReceipt | null> {
  let a: Auto | null = null;
  try { a = (await db('conv_svc_receipt_championship_auto', { p_stage: stageId })).data as Auto | null; } catch { return null; }
  if (!a) return null;
  if (a.applied) return { action: 'receipt_championship_paid', messages: paidMessages(a), forward: financeNotice(a) };
  if (a.reason === 'DUPLICATE') return { action: 'receipt_championship_duplicate', messages: ['Esse comprovante já foi usado antes, então não confirmei nada com ele. Se fez um Pix novo, me manda o comprovante dele.'] };
  if (a.reason === 'NO_SIGNUP' && topic === 'campeonato') return holdReply;
  if (!a.pending?.length || !looksLikeSignup(a, topic)) return null;
  return mismatchReply(a);
}

/** Inscrição acabou de ser criada: o comprovante que a pessoa mandou antes (guardado, esperando finalidade) é conferido na hora. */
export async function payHeldReceipt(db: Call, conversation: string): Promise<ChampReceipt | null> {
  let stage: { id?: string; status?: string } | null = null;
  try { stage = (await db('conv_svc_receipt_stage', { p_conversation: conversation })).data as typeof stage; } catch { return null; }
  if (!stage?.id || stage.status !== 'awaiting_purpose') return null;
  const r = await tryChampionshipPay(db, stage.id, 'campeonato');
  return r?.action === HOLD ? null : r;
}
