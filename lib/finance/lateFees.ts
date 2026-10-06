/**
 * Encargos de atraso e imputação de pagamentos de uma cobrança.
 *
 * Regras (todas explícitas; espelhadas em `public.fin_charge_statement` e
 * `public.fin_register_payment`, e comparadas em `__tests__/finance/sql`):
 *
 * - Principal base = valor original − descontos + acréscimos. Descontos e
 *   acréscimos valem desde a origem da cobrança.
 * - `limite` = vencimento + dias de carência. Pagar até o `limite` (inclusive)
 *   não gera encargo. Dias de atraso em `D` = `D − limite` (mínimo 0).
 * - Multa: **uma vez**, no 1º dia de atraso = valor fixo + % sobre o saldo
 *   principal daquele dia.
 * - Juros: **simples, sem juros sobre juros**. Em cada dia de atraso incide
 *   valor fixo diário + % diário sobre o **saldo principal em aberto no início
 *   do dia** (pagamento feito no dia só reduz a base do dia seguinte). Os dias
 *   consecutivos com a mesma base formam um trecho; o percentual é calculado
 *   uma vez por trecho, arredondando metade para cima.
 * - Encargos nunca entram na base de cálculo (nem multa nem juros acumulados).
 * - Imputação de um pagamento: primeiro multa, depois juros, depois principal;
 *   o que sobrar é **excedente** (vira crédito do sócio, nunca é descartado).
 * - Sem política confirmada pelo admin, **nenhum encargo é calculado** (a tela
 *   mostra "encargos não configurados").
 */
import { applyBps, type Cents } from './money';
import { addDays, diffDays, type IsoDate } from './dates';

export interface FeePolicy {
  /** `true` só depois de o admin confirmar (inclusive a decisão "sem encargos"). */
  confirmed: boolean;
  graceDays: number;
  fineFixedCents: Cents | null;
  finePercentBps: number | null;
  interestDailyFixedCents: Cents | null;
  interestDailyPercentBps: number | null;
}

export const UNCONFIGURED_POLICY: FeePolicy = {
  confirmed: false, graceDays: 0, fineFixedCents: null, finePercentBps: null,
  interestDailyFixedCents: null, interestDailyPercentBps: null,
};

export interface LedgerPayment {
  id?: string;
  paidOn: IsoDate;
  fineCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  excessCents?: Cents;
}

export interface ChargeLedger {
  originalCents: Cents;
  dueDate: IsoDate;
  canceled?: boolean;
  discountCents?: Cents;
  increaseCents?: Cents;
  feeWaivedCents?: Cents;
  /** Somente pagamentos **efetivos** (os estornados já ficam de fora). */
  payments: LedgerPayment[];
}

export interface Statement {
  principalBaseCents: Cents;
  principalPaidCents: Cents;
  principalRemainingCents: Cents;
  /** Último dia sem encargo (vencimento + carência). */
  graceUntil: IsoDate;
  daysLate: number;
  fineAccruedCents: Cents;
  interestAccruedCents: Cents;
  feesPaidCents: Cents;
  feesWaivedCents: Cents;
  fineDueCents: Cents;
  interestDueCents: Cents;
  feesDueCents: Cents;
  totalDueCents: Cents;
  /** `false` quando a política não foi confirmada (encargos zerados por falta de regra). */
  feesConfigured: boolean;
  overdue: boolean;
  settled: boolean;
}

const nz = (v: number | null | undefined) => v ?? 0;

/** Posição do saldo principal no início do dia `day` (pagamentos antes de `day` já abateram). */
function baseOnDay(base: Cents, payments: LedgerPayment[], day: IsoDate): Cents {
  let b = base;
  for (const p of payments) if (p.paidOn < day) b -= p.principalCents;
  return Math.max(b, 0);
}

export function computeStatement(ledger: ChargeLedger, policy: FeePolicy, asOf: IsoDate): Statement {
  const payments = [...ledger.payments]
    .filter((p) => p.paidOn <= asOf)
    .sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : 0));

  const principalBase = Math.max(ledger.originalCents - nz(ledger.discountCents) + nz(ledger.increaseCents), 0);
  const principalPaid = payments.reduce((s, p) => s + p.principalCents, 0);
  const principalRemaining = ledger.canceled ? 0 : Math.max(principalBase - principalPaid, 0);
  const feesPaid = payments.reduce((s, p) => s + p.fineCents + p.interestCents, 0);
  const feesWaived = nz(ledger.feeWaivedCents);

  const graceUntil = addDays(ledger.dueDate, Math.max(policy.graceDays, 0));
  const daysLate = Math.max(diffDays(graceUntil, asOf), 0);

  let fineAccrued = 0;
  let interestAccrued = 0;
  const feesConfigured = policy.confirmed;

  if (feesConfigured && !ledger.canceled && daysLate > 0) {
    const firstLateDay = addDays(graceUntil, 1);
    const baseAtFirstLateDay = baseOnDay(principalBase, payments, firstLateDay);

    if (baseAtFirstLateDay > 0) {
      fineAccrued = nz(policy.fineFixedCents) + applyBps(baseAtFirstLateDay, nz(policy.finePercentBps));
    }

    // Trechos de dias consecutivos com a mesma base de principal.
    let cursor = firstLateDay;
    let base = baseAtFirstLateDay;
    const pending = payments.filter((p) => p.paidOn >= firstLateDay && p.paidOn < asOf);
    const closeSegment = (to: IsoDate) => {
      const days = diffDays(cursor, to) + 1;
      if (days > 0 && base > 0) {
        interestAccrued += nz(policy.interestDailyFixedCents) * days;
        const bps = nz(policy.interestDailyPercentBps);
        if (bps > 0) interestAccrued += applyBps(base * days, bps);
      }
    };
    for (const p of pending) {
      closeSegment(p.paidOn); // o pagamento do dia só reduz a base do dia seguinte
      base = Math.max(base - p.principalCents, 0);
      cursor = addDays(p.paidOn, 1);
    }
    closeSegment(asOf);
  }

  // Pagamentos e dispensas abatem primeiro a multa, depois os juros.
  const reduction = feesPaid + feesWaived;
  const fineDue = Math.max(fineAccrued - reduction, 0);
  const interestDue = Math.max(fineAccrued + interestAccrued - reduction - fineDue, 0);
  const feesDue = fineDue + interestDue;

  return {
    principalBaseCents: principalBase,
    principalPaidCents: principalPaid,
    principalRemainingCents: principalRemaining,
    graceUntil,
    daysLate,
    fineAccruedCents: fineAccrued,
    interestAccruedCents: interestAccrued,
    feesPaidCents: feesPaid,
    feesWaivedCents: feesWaived,
    fineDueCents: fineDue,
    interestDueCents: interestDue,
    feesDueCents: feesDue,
    totalDueCents: principalRemaining + feesDue,
    feesConfigured,
    overdue: !ledger.canceled && principalRemaining + feesDue > 0 && asOf > ledger.dueDate,
    settled: !!ledger.canceled || principalRemaining + feesDue === 0,
  };
}

export interface PaymentSplit {
  fineCents: Cents;
  interestCents: Cents;
  principalCents: Cents;
  excessCents: Cents;
  /** Depois deste pagamento a cobrança fica quitada (principal e encargos). */
  settles: boolean;
  /** Pagamento sobre cobrança já quitada: tudo vira excedente "duplicado". */
  duplicate: boolean;
}

/** Divide um pagamento: multa → juros → principal → excedente. */
export function allocatePayment(statement: Statement, amountCents: Cents): PaymentSplit {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Valor do pagamento inválido');
  const fine = Math.min(amountCents, statement.fineDueCents);
  const interest = Math.min(amountCents - fine, statement.interestDueCents);
  const principal = Math.min(amountCents - fine - interest, statement.principalRemainingCents);
  const excess = amountCents - fine - interest - principal;
  const duplicate = statement.settled && excess === amountCents;
  return {
    fineCents: fine,
    interestCents: interest,
    principalCents: principal,
    excessCents: excess,
    settles: fine + interest + principal === statement.totalDueCents,
    duplicate,
  };
}

export type StoredChargeStatus = 'open' | 'partial' | 'paid' | 'canceled';

/** Status gravado da cobrança depois do pagamento (ou do estorno) mais recente. */
export function storedStatusFor(statement: Statement, hasEffectivePayments: boolean, canceled = false): StoredChargeStatus {
  if (canceled) return 'canceled';
  if (statement.settled) return 'paid';
  return hasEffectivePayments ? 'partial' : 'open';
}

/**
 * Distribui um valor entre várias cobranças, da mais antiga para a mais nova
 * (por vencimento), usando o total devido de cada uma na data do pagamento.
 * Sobra vira `excessCents`.
 */
export function allocateAcrossCharges<T extends { id: string; dueDate: IsoDate; statement: Statement }>(
  charges: T[], amountCents: Cents,
): { allocations: Array<{ id: string; amountCents: Cents }>; excessCents: Cents } {
  let left = amountCents;
  const allocations: Array<{ id: string; amountCents: Cents }> = [];
  for (const c of [...charges].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    if (left <= 0) break;
    const take = Math.min(left, c.statement.totalDueCents);
    if (take > 0) {
      allocations.push({ id: c.id, amountCents: take });
      left -= take;
    }
  }
  return { allocations, excessCents: left };
}
