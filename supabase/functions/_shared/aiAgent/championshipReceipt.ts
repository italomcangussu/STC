// Comprovante do Pix de quem tem pré-inscrição no campeonato: o servidor confere valor, favorecido e arquivo e,
// batendo, lança a receita com o comprovante e inscreve na hora (sem confirmação em duas etapas).
// Não bateu: explica o que esperava quando dá para ver que o Pix é da inscrição; senão segue o fluxo comum do comprovante.

import { brl } from './championshipPrompt.ts';
import type { ReceiptForward } from './receiptForward.ts';

type Call = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }>;
type Pending = { name: string; class: string };
type Auto = {
  applied?: boolean; reason?: string; championship?: string; amount_cents?: number; total_cents?: number; pending?: Pending[];
  confirmed?: string[]; waitlist?: string[]; admin_conversation_id?: string | null; admin_name?: string; sender_name?: string;
};
export type ChampReceipt = { messages: string[]; action: string; forward?: ReceiptForward };

const lista = (nomes: string[]) => nomes.join(', ').replace(/, ([^,]*)$/, ' e $1');

function paidMessages(a: Auto): string[] {
  const ok = a.confirmed ?? [];
  const espera = a.waitlist ?? [];
  const messages = [`Recebi o Pix de ${brl(a.amount_cents)} ✅`];
  if (ok.length) messages.push(`${ok.length > 1 ? 'Inscrições confirmadas' : 'Inscrição confirmada'} no ${a.championship}: ${lista(ok)}. Bom campeonato! 🎾`);
  if (espera.length) messages.push(`${lista(espera)} ${espera.length > 1 ? 'ficaram' : 'ficou'} na lista de espera porque a classe lotou antes do pagamento. O pagamento está registrado e a organização vai falar com você.`);
  return messages;
}

/** Aviso ao responsável pelo financeiro: a receita já está lançada, com quem entrou e quem ficou na espera. */
function financeNotice(a: Auto): ReceiptForward | undefined {
  if (!a.admin_conversation_id) return undefined;
  const ok = a.confirmed ?? [];
  const espera = a.waitlist ?? [];
  const confirmados = ok.length ? ` Confirmados: ${lista(ok)}.` : '';
  const naEspera = espera.length ? ` Pagos, mas na lista de espera (classe lotada): ${lista(espera)}.` : '';
  return { admin_conversation_id: a.admin_conversation_id, admin_name: a.admin_name ?? '', sender_name: a.sender_name ?? '', kind: 'championship_auto', detail: null,
    text: `${a.admin_name}, para você saber: ${a.sender_name} pagou ${brl(a.amount_cents)} de inscrição no ${a.championship} pelo WhatsApp e eu já lancei a receita com o comprovante.${confirmados}${naEspera}` };
}

/** O Pix parece da inscrição: valor múltiplo do preço de uma inscrição, ou a última fala do João foi sobre a inscrição. */
function looksLikeSignup(a: Auto, lastBot: string): boolean {
  if (/inscri[cç][aã]o/i.test(lastBot)) return true;
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

/** Tenta confirmar a inscrição pelo comprovante. null = não é (ou não dá para saber se é) da inscrição: segue o fluxo comum. */
export async function tryChampionshipPay(db: Call, stageId: string, lastBot: string): Promise<ChampReceipt | null> {
  let a: Auto | null = null;
  try { a = (await db('conv_svc_receipt_championship_auto', { p_stage: stageId })).data as Auto | null; } catch { return null; }
  if (!a) return null;
  if (a.applied) return { action: 'receipt_championship_paid', messages: paidMessages(a), forward: financeNotice(a) };
  if (a.reason === 'DUPLICATE') return { action: 'receipt_championship_duplicate', messages: ['Esse comprovante já foi usado antes, então não confirmei nada com ele. Se fez um Pix novo, me manda o comprovante dele.'] };
  if (!a.pending?.length || !looksLikeSignup(a, lastBot)) return null;
  return mismatchReply(a);
}
