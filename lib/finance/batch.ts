/**
 * Aprovação de comprovantes em lote.
 *
 * Nada aqui toca o banco nem confirma pagamento: `batchReadiness` só separa o que
 * pode ser aprovado de uma vez (valor igual ao devido, sem alerta que exija olhar
 * o arquivo) do que precisa de conferência individual. Quem quita é o administrador,
 * comprovante por comprovante, pela mesma RPC da aprovação individual.
 */
import type { IsoDate } from './dates';
import { analyzeReceipt, statementFromRow, type FlagCode, type OtherReceipt, type ReceiptAnalysis } from './receipts';
import type { Cents } from './money';
import type { ChargeStatementRow, ReceiptQueueRow } from './types';

/**
 * Alertas que mandam o comprovante para conferência individual. Os demais
 * (valor confere, valor corrigido pelo sócio, pago depois do vencimento com os
 * encargos já somados, encargos não configurados) não impedem o lote.
 */
const NEEDS_EYES: ReadonlySet<FlagCode> = new Set<FlagCode>([
  'unreadable', 'amount_missing', 'date_missing', 'amount_principal_only', 'amount_below_total', 'amount_above_total',
  'possible_duplicate', 'duplicate_fields', 'payee_mismatch',
]);

export interface BatchReadiness {
  /** `ready`: pode entrar no lote · `attention`: abrir e conferir · `blocked`: há impedimento (data futura, já quitada…). */
  status: 'ready' | 'attention' | 'blocked';
  /** Primeiro motivo, em português, para mostrar ao administrador. */
  reason: string | null;
}

export function batchReadiness(a: ReceiptAnalysis): BatchReadiness {
  const blocker = a.flags.find((f) => f.severity === 'block');
  if (blocker) return { status: 'blocked', reason: blocker.message };
  const eyes = a.flags.find((f) => NEEDS_EYES.has(f.code));
  if (eyes) return { status: 'attention', reason: eyes.message };
  const allocated = a.allocation.reduce((s, x) => s + x.amountCents, 0);
  // Defesa extra: mesmo sem alerta, só entra se a divisão fecha com o valor e sem sobra.
  if (a.amountCents === null || a.paidOn === null || a.allocation.length === 0 || a.excessCents !== 0 || allocated !== a.amountCents || a.amountCents !== a.totalDueAtPaidCents) {
    return { status: 'attention', reason: 'Não foi possível confirmar a divisão do pagamento. Abra para conferir.' };
  }
  return { status: 'ready', reason: null };
}

/** Dados do comprovante necessários para a conferência (subconjunto de `receiptDetail`). */
export interface QueuedReceiptDetail {
  declared_amount_cents: Cents | null;
  declared_paid_on: string | null;
  ocr_status: 'not_run' | 'ok' | 'unreadable' | 'failed';
  ocr: unknown;
  possible_duplicate: boolean;
}

type OcrFields = { amount_cents?: number | null; paid_on?: string | null; identifier?: string | null; payee?: string | null } | null;

/**
 * Outros comprovantes da fila usados na checagem de duplicidade. No lote, valor + data
 * iguais só contam como suspeita DENTRO do mesmo sócio: sócios diferentes pagam
 * a mesma mensalidade no mesmo dia o tempo todo. O identificador do Pix vale para todos.
 */
export function duplicateCandidates(queue: ReceiptQueueRow[], self: { id: string; profile_id: string }): OtherReceipt[] {
  return queue.filter((q) => q.id !== self.id).map((q) => {
    const identifier = ((q.ocr ?? null) as { identifier?: string | null } | null)?.identifier ?? null;
    return q.profile_id === self.profile_id
      ? { amountCents: q.declared_amount_cents, paidOn: q.declared_paid_on as IsoDate | null, identifier }
      : { amountCents: null, paidOn: null, identifier };
  });
}

/** Mesma conferência da folha individual, montada a partir dos extratos já lidos do banco. */
export function analyzeFromStatements(i: {
  detail: QueuedReceiptDetail; atPaid: ChargeStatementRow[]; now: ChargeStatementRow[]; others: OtherReceipt[]; payeeNames: string[]; today: IsoDate;
}): ReceiptAnalysis {
  const ocr = (i.detail.ocr ?? null) as OcrFields;
  const charges = i.atPaid.map((r) => {
    const nowRow = i.now.find((n) => n.charge_id === r.charge_id) ?? r;
    return { id: r.charge_id, competenceMonth: r.competence_month, dueDate: r.due_date, statementAtPaid: statementFromRow(r), statementToday: statementFromRow(nowRow) };
  });
  return analyzeReceipt({
    declared: { amountCents: i.detail.declared_amount_cents, paidOn: i.detail.declared_paid_on as IsoDate | null },
    extracted: ocr ? { amountCents: ocr.amount_cents ?? null, paidOn: (ocr.paid_on ?? null) as IsoDate | null, identifier: ocr.identifier ?? null, payee: ocr.payee ?? null } : null,
    ocrStatus: i.detail.ocr_status, charges, today: i.today, possibleDuplicate: i.detail.possible_duplicate, others: i.others, payeeNames: i.payeeNames,
  });
}

export interface BatchResult<T> { item: T; ok: boolean; error?: unknown }

/**
 * Executa um por vez (a ordem importa para o caixa e evita sobrecarregar o banco).
 * Uma falha não interrompe os demais: o resultado diz o que passou e o que não.
 */
export async function runSequential<T>(items: T[], fn: (item: T) => Promise<unknown>, onProgress?: (done: number, total: number) => void): Promise<BatchResult<T>[]> {
  const out: BatchResult<T>[] = [];
  for (const item of items) {
    try { await fn(item); out.push({ item, ok: true }); }
    catch (error) { out.push({ item, ok: false, error }); }
    onProgress?.(out.length, items.length);
  }
  return out;
}

/** Executa `fn` sobre todos, no máximo `limit` ao mesmo tempo, preservando a ordem do resultado. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onProgress?: (done: number, total: number) => void): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0; let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      onProgress?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
