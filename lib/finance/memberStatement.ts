/**
 * Regras puras da tela "Meu financeiro" (o sócio vendo as próprias cobranças e enviando comprovante):
 * texto das regras do clube, grupos de cobrança, frases do cabeçalho e o que a leitura automática preenche.
 * Sem React e sem banco.
 */
import type { ChargePaymentRow, ChargeStatementRow, MemberCreditRow, MemberPendencyMeta, PublicSettings } from './types';
import { brDate, monthLabel, type IsoDate } from './dates';
import { formatBRL } from './money';
import type { OcrOutcome } from './ocr';
import { analyzeReceipt, statementFromRow, type ReceiptFlag } from './receipts';

// ------------------------------------------------------------------
// Regras do clube em linguagem do sócio
// ------------------------------------------------------------------

const DUE_RULE_LABEL: Record<PublicSettings['non_business_rule'], string> = {
  next_business_day: 'passa para o próximo dia útil', previous_business_day: 'passa para o dia útil anterior', keep: 'é mantido',
};

const percentText = (bps: number): string => `${(bps / 100).toLocaleString('pt-BR')}%`;
const joinPlus = (parts: Array<string | null>): string => parts.filter(Boolean).join(' + ');

const dueText = (s: PublicSettings): string => {
  const month = s.due_month_offset === 1 ? 'do mês seguinte ao período cobrado' : 'do mês do período cobrado';
  return `Vence no dia ${s.due_day} ${month}; se cair em dia não útil, ${DUE_RULE_LABEL[s.non_business_rule]}.`;
};

const fineClause = (s: PublicSettings): string | null => {
  const fine = joinPlus([s.fine_fixed_cents ? formatBRL(s.fine_fixed_cents) : null, s.fine_percent_bps ? percentText(s.fine_percent_bps) : null]);
  return fine ? `multa única de ${fine} no 1º dia de atraso` : null;
};

const interestClause = (s: PublicSettings): string | null => {
  const interest = joinPlus([
    s.interest_daily_fixed_cents ? `${formatBRL(s.interest_daily_fixed_cents)} por dia` : null,
    s.interest_daily_percent_bps ? `${percentText(s.interest_daily_percent_bps)} ao dia sobre o valor em aberto` : null,
  ]);
  return interest ? `juros de ${interest}` : null;
};

const feesText = (s: PublicSettings): string => {
  if (!s.late_fee_confirmed) return 'Os encargos de atraso ainda não foram definidos pelo clube: por enquanto nenhum encargo é cobrado.';
  const clauses = [fineClause(s), interestClause(s)].filter(Boolean);
  if (clauses.length === 0) return 'O clube não cobra encargos de atraso.';
  const grace = s.grace_days ? `, após ${s.grace_days} dia(s) de carência` : '';
  return `Em caso de atraso: ${clauses.join(' e ')}${grace}. Juros simples — encargos não geram novos juros.`;
};

/** Descreve em português a regra de vencimento e de encargos em vigor. */
export const describeRules = (s: PublicSettings): { due: string; fees: string } => ({ due: dueText(s), fees: feesText(s) });

// ------------------------------------------------------------------
// Cobranças do sócio
// ------------------------------------------------------------------

const TO_PAY_STATUSES: ReadonlyArray<ChargeStatementRow['display_status']> = ['overdue', 'open', 'partial', 'in_review'];

export interface ChargeGroups {
  pay: ChargeStatementRow[];
  forecast: ChargeStatementRow[];
  paid: ChargeStatementRow[];
  canceled: ChargeStatementRow[];
}

export function groupCharges(list: ChargeStatementRow[]): ChargeGroups {
  return {
    pay: list.filter((c) => TO_PAY_STATUSES.includes(c.display_status)),
    forecast: list.filter((c) => c.display_status === 'forecast'),
    paid: list.filter((c) => c.display_status === 'paid'),
    canceled: list.filter((c) => c.display_status === 'canceled'),
  };
}

export const sumDue = (charges: ChargeStatementRow[]): number => charges.reduce((sum, c) => sum + c.total_due_cents, 0);

/** O que o sócio pode incluir num comprovante: a pagar e previstas, desde que tenham saldo. */
export const payableCharges = (groups: ChargeGroups): ChargeStatementRow[] => [...groups.pay, ...groups.forecast].filter((c) => c.total_due_cents > 0);

/** A frase do topo da tela: quantas vencidas, ou o que está em aberto, ou que está tudo em dia. */
export function headerSentence(overdueCount: number, owedCents: number): string {
  if (overdueCount > 0) return `Você tem ${overdueCount} cobrança${overdueCount > 1 ? 's' : ''} vencida${overdueCount > 1 ? 's' : ''}`;
  return owedCents > 0 ? 'Valor em aberto hoje' : 'Tudo em dia';
}

/** Pendências lançadas pelo clube que ainda não foram quitadas nem canceladas. */
export const openPendencyCharges = (list: ChargeStatementRow[], pendencyIds: ReadonlySet<string>): ChargeStatementRow[] =>
  list.filter((c) => pendencyIds.has(c.charge_id) && c.display_status !== 'paid' && c.display_status !== 'canceled');

export const openCreditCents = (credits: MemberCreditRow[]): number =>
  credits.filter((c) => c.status === 'open').reduce((sum, c) => sum + c.remaining_cents, 0);

/** Marca ou desmarca um id numa lista de escolhidos. */
export const toggleId = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

// ------------------------------------------------------------------
// Textos do cartão da cobrança
// ------------------------------------------------------------------

/** Pendência lançada pelo clube (e não mensalidade de plano). */
export const isPendencyCharge = (charge: ChargeStatementRow, meta: MemberPendencyMeta | null | undefined): meta is MemberPendencyMeta =>
  charge.plan_id === null && !!meta;

export const chargeTitle = (charge: ChargeStatementRow, meta: MemberPendencyMeta | null | undefined): string =>
  isPendencyCharge(charge, meta) ? meta.description : `Mensalidade de ${monthLabel(charge.competence_month)}`;

export function chargeSubtitle(charge: ChargeStatementRow, meta: MemberPendencyMeta | null | undefined): string {
  const prefix = isPendencyCharge(charge, meta) ? `Pendência · competência ${monthLabel(charge.competence_month)} · ` : '';
  return `${prefix}Vencimento em ${brDate(charge.due_date)}`;
}

/** "Convidado: Carlos · Visita: 05/10/2026" — vazio quando a pendência não tem convidado nem data. */
export function guestLine(meta: MemberPendencyMeta): string {
  const parts = [meta.guest_name ? `Convidado: ${meta.guest_name}` : null, meta.guest_date ? `Visita: ${brDate(meta.guest_date)}` : null];
  return parts.filter(Boolean).join(' · ');
}

/** " (principal R$ 140,00, encargos R$ 5,00, crédito R$ 5,00)": para onde foi o pagamento. Vazio para estorno. */
export function paymentBreakdown(p: ChargePaymentRow): string {
  if (p.kind !== 'payment') return '';
  const fees = p.fine_cents + p.interest_cents;
  const feesText = fees > 0 ? `, encargos ${formatBRL(fees)}` : '';
  const credit = p.excess_cents > 0 ? `, crédito ${formatBRL(p.excess_cents)}` : '';
  return ` (principal ${formatBRL(p.principal_cents)}${feesText}${credit})`;
}

/** "R$ 154,50 · 17/09/2026" — o que o sócio declarou no comprovante; cada parte some se não foi informada. */
export function receiptSummaryLine(receipt: { declared_amount_cents: number | null; declared_paid_on: string | null }): string {
  const amount = receipt.declared_amount_cents ? formatBRL(receipt.declared_amount_cents) : 'Valor não informado';
  return receipt.declared_paid_on ? `${amount} · ${brDate(receipt.declared_paid_on)}` : amount;
}

// ------------------------------------------------------------------
// Envio do comprovante
// ------------------------------------------------------------------

export interface OcrState {
  status: 'idle' | 'reading' | 'ok' | 'unreadable' | 'failed';
  pct: number;
  stored: Record<string, unknown> | null;
  identifier: string | null;
}

export const IDLE_OCR: OcrState = { status: 'idle', pct: 0, stored: null, identifier: null };

type OkOutcome = Extract<OcrOutcome, { status: 'ok' }>;

/** O que a leitura automática preenche nos campos: valor lido, data lida (nunca futura) e identificador. */
export function fieldsFromOcr(extracted: OkOutcome['extracted'], today: IsoDate): { amount?: number; paidOn?: IsoDate; reference?: string } {
  const fields: { amount?: number; paidOn?: IsoDate; reference?: string } = {};
  if (extracted.amountCents !== null) fields.amount = extracted.amountCents;
  if (extracted.paidOn && extracted.paidOn <= today) fields.paidOn = extracted.paidOn;
  if (extracted.identifier) fields.reference = extracted.identifier;
  return fields;
}

/** Como o banco registra o resultado da leitura: "ainda lendo" e "parada" contam como "não rodou". */
export const submittedOcrStatus = (status: OcrState['status']): 'not_run' | 'ok' | 'unreadable' | 'failed' =>
  status === 'ok' || status === 'unreadable' || status === 'failed' ? status : 'not_run';

/** O envio só habilita com arquivo, ao menos uma cobrança escolhida, valor positivo e data. */
export const canSendReceipt = (draft: { file: unknown | null; chosen: string[]; amount: number | null; paidOn: string }): boolean =>
  !!draft.file && draft.chosen.length > 0 && draft.amount !== null && draft.amount > 0 && !!draft.paidOn;

export interface ReceiptNotice { title: string; description: string }

/** O aviso depois de enviar: baixa automática, arquivo repetido ou envio comum. */
export function receiptSentNotice(result: { auto_approved?: boolean; possible_duplicate?: boolean }): ReceiptNotice {
  if (result.auto_approved) return { title: 'Pagamento identificado e baixado!', description: 'O OCR conferiu os dados e o financeiro foi atualizado automaticamente.' };
  const description = result.possible_duplicate ? 'Este arquivo já tinha sido enviado antes; o clube vai conferir.' : 'O clube vai conferir o pagamento e você será avisado.';
  return { title: 'Comprovante enviado!', description };
}

/**
 * Conferência que o próprio sócio vê antes de enviar (só orienta; quem decide é o clube): compara o valor
 * digitado com o devido na data do pagamento. Mostra os avisos e, entre os informativos, só "o valor confere".
 */
export function receiptHints(input: {
  atPaid: ChargeStatementRow[];
  selected: ChargeStatementRow[];
  amountCents: number | null;
  paidOn: IsoDate;
  ocrStatus: OcrState['status'];
  today: IsoDate;
}): ReceiptFlag[] {
  const charges = input.atPaid.map((r) => {
    const nowRow = input.selected.find((c) => c.charge_id === r.charge_id)!;
    return { id: r.charge_id, competenceMonth: r.competence_month, dueDate: r.due_date, statementAtPaid: statementFromRow(r), statementToday: statementFromRow(nowRow) };
  });
  const analysis = analyzeReceipt({
    declared: { amountCents: input.amountCents, paidOn: input.paidOn || null }, extracted: null,
    ocrStatus: input.ocrStatus === 'idle' || input.ocrStatus === 'reading' ? 'not_run' : input.ocrStatus,
    charges, today: input.today, possibleDuplicate: false,
  });
  return analysis.flags.filter((f) => f.severity !== 'info' || f.code === 'amount_matches_total');
}
