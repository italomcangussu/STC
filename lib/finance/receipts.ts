/**
 * Conferência assistida do comprovante contra as cobranças.
 *
 * `analyzeReceipt` NÃO tem efeito colateral e NÃO confirma pagamento: ela só
 * produz alertas e uma sugestão de divisão para o administrador decidir.
 * Quitar é exclusividade de `fin_approve_receipt` (ação do admin).
 */
import { allocateAcrossCharges, type Statement } from './lateFees';
import { diffDays, type IsoDate } from './dates';
import { payeeCnpjMatches, payeeNameMatches } from './payee';
import { formatBRL, type Cents } from './money';
import type { ChargeStatementRow, ReceiptStatus } from './types';

export type FlagSeverity = 'info' | 'warn' | 'block';

export type FlagCode =
  | 'unreadable' | 'amount_missing' | 'date_missing' | 'date_future' | 'amount_edited'
  | 'amount_matches_total' | 'amount_principal_only' | 'amount_below_total' | 'amount_above_total'
  | 'paid_after_due' | 'charge_already_settled' | 'possible_duplicate' | 'duplicate_fields' | 'payee_mismatch'
  | 'fees_not_configured' | 'no_charges';

export interface ReceiptFlag {
  code: FlagCode;
  severity: FlagSeverity;
  message: string;
  chargeId?: string;
  cents?: Cents;
}

export interface ReceiptChargeContext {
  id: string;
  competenceMonth: IsoDate;
  dueDate: IsoDate;
  /** Extrato na data do pagamento declarada/lida. */
  statementAtPaid: Statement;
  /** Extrato hoje (para saber se já foi quitada por outro meio). */
  statementToday: Statement;
}

export interface OtherReceipt { amountCents: Cents | null; paidOn: IsoDate | null; identifier: string | null }

export interface ReceiptAnalysisInput {
  declared: { amountCents: Cents | null; paidOn: IsoDate | null };
  extracted: { amountCents: Cents | null; paidOn: IsoDate | null; identifier?: string | null; payee?: string | null; payeeDocument?: string | null } | null;
  ocrStatus: 'not_run' | 'ok' | 'unreadable' | 'failed';
  charges: ReceiptChargeContext[];
  today: IsoDate;
  possibleDuplicate: boolean;
  /** Outros comprovantes já enviados (só para o revisor) — compara valor+data ou identificador. */
  others?: OtherReceipt[];
  /** Nomes esperados do favorecido (configuração do clube); vazio = não conferir. */
  payeeNames?: string[];
  /** Chave Pix (CNPJ) do clube: o CNPJ do favorecido igual a ela dispensa a conferência do nome. */
  pixKey?: string | null;
}

export type ReceiptVerdict = 'ok' | 'review' | 'blocked';

export interface ReceiptAnalysis {
  amountCents: Cents | null;
  paidOn: IsoDate | null;
  flags: ReceiptFlag[];
  verdict: ReceiptVerdict;
  allocation: Array<{ chargeId: string; amountCents: Cents }>;
  excessCents: Cents;
  totalDueAtPaidCents: Cents;
  /** Sempre `false`: a análise nunca quita. */
  autoConfirms: false;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function analyzeReceipt(input: ReceiptAnalysisInput): ReceiptAnalysis {
  const flags: ReceiptFlag[] = [];
  const add = (code: FlagCode, severity: FlagSeverity, message: string, extra: Partial<ReceiptFlag> = {}) => flags.push({ code, severity, message, ...extra });

  const amount = input.declared.amountCents ?? input.extracted?.amountCents ?? null;
  const paidOn = input.declared.paidOn ?? input.extracted?.paidOn ?? null;

  if (input.charges.length === 0) add('no_charges', 'block', 'Nenhuma cobrança foi indicada neste comprovante.');
  if ((input.ocrStatus === 'unreadable' || input.ocrStatus === 'failed') && input.declared.amountCents === null) {
    add('unreadable', 'warn', 'A leitura automática não conseguiu ler o comprovante. Confira o arquivo e informe os dados à mão.');
  }
  if (amount === null) add('amount_missing', 'warn', 'Valor do pagamento não informado nem lido.');
  if (paidOn === null) add('date_missing', 'warn', 'Data do pagamento não informada nem lida.');
  if (paidOn !== null && paidOn > input.today) add('date_future', 'block', 'A data do pagamento está no futuro.');
  if (input.declared.amountCents !== null && input.extracted?.amountCents != null && input.declared.amountCents !== input.extracted.amountCents) {
    add('amount_edited', 'info', `O sócio corrigiu o valor lido (${formatBRL(input.extracted.amountCents)}) para ${formatBRL(input.declared.amountCents)}.`);
  }

  for (const c of input.charges) {
    if (c.statementToday.settled) add('charge_already_settled', 'block', 'Uma das cobranças já está quitada. Um novo pagamento viraria crédito do sócio.', { chargeId: c.id });
  }

  const totalDueAtPaid = input.charges.reduce((s, c) => s + c.statementAtPaid.totalDueCents, 0);
  const principalAtPaid = input.charges.reduce((s, c) => s + c.statementAtPaid.principalRemainingCents, 0);

  if (amount !== null && input.charges.length > 0) {
    if (amount === totalDueAtPaid) {
      add('amount_matches_total', 'info', 'O valor confere com o total devido na data do pagamento (já com encargos, se houver).', { cents: amount });
    } else if (amount < totalDueAtPaid) {
      if (amount === principalAtPaid && totalDueAtPaid > principalAtPaid) {
        add('amount_principal_only', 'warn', `Foi pago só o valor original; faltam ${formatBRL(totalDueAtPaid - amount)} de encargos de atraso (ou uma dispensa justificada).`, { cents: totalDueAtPaid - amount });
      } else {
        add('amount_below_total', 'warn', `Valor insuficiente: faltam ${formatBRL(totalDueAtPaid - amount)} para quitar. O restante continua em aberto.`, { cents: totalDueAtPaid - amount });
      }
    } else {
      add('amount_above_total', 'warn', `Valor acima do devido em ${formatBRL(amount - totalDueAtPaid)}. A sobra vira crédito do sócio.`, { cents: amount - totalDueAtPaid });
    }
  }

  if (paidOn !== null) {
    for (const c of input.charges) {
      if (paidOn > c.dueDate) {
        const days = diffDays(c.dueDate, paidOn);
        add('paid_after_due', 'warn', `Pagamento ${days} dia${days === 1 ? '' : 's'} após o vencimento (${c.dueDate.split('-').reverse().join('/')}).`, { chargeId: c.id, cents: days });
      }
    }
  }

  if (input.charges.some((c) => !c.statementAtPaid.feesConfigured && c.statementAtPaid.daysLate > 0)) {
    add('fees_not_configured', 'info', 'O clube ainda não configurou os encargos de atraso: nenhum encargo foi calculado.');
  }

  if (input.possibleDuplicate) add('possible_duplicate', 'warn', 'O mesmo arquivo já foi enviado antes. Confira se não é um pagamento duplicado.');
  const ident = input.extracted?.identifier ?? null;
  for (const o of input.others ?? []) {
    const same = (ident && o.identifier && ident === o.identifier) || (amount !== null && o.amountCents === amount && paidOn !== null && o.paidOn === paidOn);
    if (same) { add('duplicate_fields', 'warn', 'Outro comprovante tem o mesmo identificador, ou o mesmo valor na mesma data.'); break; }
  }

  const expected = (input.payeeNames ?? []).filter((n) => n.trim());
  const cnpjOk = payeeCnpjMatches(input.extracted?.payeeDocument, input.pixKey);
  if (!cnpjOk && expected.length > 0 && input.extracted?.payee && !payeeNameMatches(input.extracted.payee, expected)) {
    add('payee_mismatch', 'warn', 'O favorecido lido não parece ser o clube. Confira o comprovante.');
  }

  const allocationResult = amount !== null && amount > 0
    ? allocateAcrossCharges(input.charges.map((c) => ({ id: c.id, dueDate: c.dueDate, statement: c.statementAtPaid })), amount)
    : { allocations: [], excessCents: 0 };

  const verdict: ReceiptVerdict = flags.some((f) => f.severity === 'block') ? 'blocked'
    : flags.some((f) => f.severity === 'warn') ? 'review' : 'ok';

  return {
    amountCents: amount,
    paidOn,
    flags,
    verdict,
    allocation: allocationResult.allocations.map((a) => ({ chargeId: a.id, amountCents: a.amountCents })),
    excessCents: allocationResult.excessCents,
    totalDueAtPaidCents: totalDueAtPaid,
    autoConfirms: false,
  };
}

export type StatusTone = 'neutral' | 'info' | 'success' | 'danger' | 'muted';

export interface ReceiptStatusInfo {
  label: string;
  tone: StatusTone;
  /** O que o sócio deve entender/fazer agora. */
  nextStep: string;
}

/** Texto de status e próximo passo mostrado ao sócio (e no aviso enviado a ele). */
export function receiptStatusInfo(status: ReceiptStatus, ctx: { decisionReason?: string | null; reviewedOn?: string | null } = {}): ReceiptStatusInfo {
  switch (status) {
    case 'submitted':
      return { label: 'Enviado', tone: 'info', nextStep: 'Recebemos seu comprovante. O clube vai conferir o pagamento — até lá a cobrança continua em aberto. Você será avisado.' };
    case 'in_review':
      return { label: 'Em análise', tone: 'info', nextStep: 'O clube está conferindo seu comprovante. Não é preciso enviar de novo.' };
    case 'approved':
      return { label: 'Aprovado', tone: 'success', nextStep: `Pagamento confirmado${ctx.reviewedOn ? ` em ${ctx.reviewedOn}` : ''}. Obrigado! Nada mais a fazer.` };
    case 'rejected':
      return {
        label: 'Recusado', tone: 'danger',
        nextStep: `${ctx.decisionReason ? `Motivo: ${ctx.decisionReason}. ` : ''}A cobrança continua em aberto. Envie um novo comprovante ou fale com a secretaria.`,
      };
    case 'superseded':
      return { label: 'Substituído', tone: 'muted', nextStep: 'Você enviou um comprovante mais recente no lugar deste.' };
  }
}

/** Texto do aviso (push) enviado ao sócio quando o clube decide. */
export function receiptDecisionNotice(status: 'approved' | 'rejected', reason?: string | null): { title: string; body: string } {
  return status === 'approved'
    ? { title: 'Pagamento confirmado', body: 'O clube confirmou seu comprovante. Veja o extrato em Meu financeiro.' }
    : { title: 'Comprovante recusado', body: `${reason ? `${reason} ` : ''}Abra Meu financeiro para ver o que fazer.` };
}

/** Extrato calculado pelo banco (linha de `fin_charge_statements*`) no formato do motor de conferência. */
export function statementFromRow(s: ChargeStatementRow): Statement {
  return {
    principalBaseCents: s.principal_base_cents, principalPaidCents: s.principal_paid_cents, principalRemainingCents: s.principal_remaining_cents,
    graceUntil: s.due_date, daysLate: s.days_late, fineAccruedCents: 0, interestAccruedCents: 0, feesPaidCents: s.fees_paid_cents,
    feesWaivedCents: s.fees_waived_cents, fineDueCents: s.fine_due_cents, interestDueCents: s.interest_due_cents, feesDueCents: s.fees_due_cents,
    totalDueCents: s.total_due_cents, feesConfigured: s.fees_configured, overdue: s.overdue, settled: s.total_due_cents === 0,
  };
}
