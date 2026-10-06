/**
 * Mensalidades individuais dos sócios: preço por competência, geração
 * idempotente das cobranças e efeito do fim do vínculo.
 *
 * Nada aqui usa valor global: cada plano tem o seu histórico de preços
 * (`fin_member_plan_prices`) e cada cobrança guarda o **valor do momento**
 * (`original_amount_cents`) — reajustar o plano nunca reescreve o passado.
 *
 * Espelho em SQL: `public.fin_generate_member_charges` (comparado em
 * `__tests__/finance/sql`).
 */
import { addMonths, firstOfMonth, lastOfMonth, type IsoDate } from './dates';
import { computeDueDate, type BusinessCalendar, type DueRule } from './calendar';
import type { Cents } from './money';

export type PeriodMonths = 1 | 3 | 6 | 12;
export type PlanStatus = 'active' | 'paused' | 'ended';

export interface PlanPrice {
  /** Dia 1 do mês a partir do qual o valor vale. */
  effectiveFrom: IsoDate;
  amountCents: Cents;
}

export interface MemberPlan {
  id: string;
  profileId: string;
  startOn: IsoDate;
  endedOn: IsoDate | null;
  status: PlanStatus;
  periodMonths: PeriodMonths;
  /** Substituem a regra global quando preenchidos. */
  dueDay?: number | null;
  dueMonthOffset?: number | null;
}

export interface PlannedCharge {
  planId: string;
  profileId: string;
  competenceMonth: IsoDate;
  periodMonths: PeriodMonths;
  dueDate: IsoDate;
  originalAmountCents: Cents;
}

/** Valor da competência: o preço de maior `effectiveFrom` que não passe dela. */
export function priceFor(prices: PlanPrice[], competenceMonth: IsoDate): Cents | null {
  let best: PlanPrice | null = null;
  for (const p of prices) {
    if (p.effectiveFrom <= competenceMonth && (!best || p.effectiveFrom > best.effectiveFrom)) best = p;
  }
  return best ? best.amountCents : null;
}

/** Inícios de período do plano, de `startOn` até `untilMonth` (inclusive). */
export function periodStarts(plan: Pick<MemberPlan, 'startOn' | 'endedOn' | 'periodMonths'>, untilMonth: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let cursor = firstOfMonth(plan.startOn);
  const limit = firstOfMonth(untilMonth);
  while (cursor <= limit) {
    // O sócio deve o período se o vínculo existiu em algum dia dele.
    if (plan.endedOn && cursor > plan.endedOn) break;
    out.push(cursor);
    cursor = addMonths(cursor, plan.periodMonths);
  }
  return out;
}

/** Último mês (dia 1) até o qual gerar: mês atual + horizonte configurado. */
export function generationHorizon(today: IsoDate, horizonMonths: number): IsoDate {
  return addMonths(firstOfMonth(today), Math.max(horizonMonths, 0));
}

export interface PlanChargesResult {
  create: PlannedCharge[];
  /** Competências que já existiam (nada é regravado). */
  existing: IsoDate[];
  /** Competências sem preço definido: não geram cobrança, precisam de atenção. */
  missingPrice: IsoDate[];
}

/**
 * Cobranças que **faltam** para o plano. Idempotente: com as mesmas
 * `existingMonths`, rodar de novo devolve `create` vazio.
 * Plano pausado ou encerrado antes do período não gera nada novo.
 */
export function planCharges(
  plan: MemberPlan,
  prices: PlanPrice[],
  existingMonths: Iterable<IsoDate>,
  untilMonth: IsoDate,
  globalRule: DueRule,
  calendar: BusinessCalendar,
): PlanChargesResult {
  const have = new Set(existingMonths);
  const result: PlanChargesResult = { create: [], existing: [], missingPrice: [] };
  if (plan.status === 'paused') {
    result.existing = [...have].sort();
    return result;
  }
  const rule: DueRule = {
    ...globalRule,
    dueDay: plan.dueDay ?? globalRule.dueDay,
    monthOffset: plan.dueMonthOffset ?? globalRule.monthOffset,
  };
  for (const month of periodStarts(plan, untilMonth)) {
    if (have.has(month)) {
      result.existing.push(month);
      continue;
    }
    const amount = priceFor(prices, month);
    if (amount === null) {
      result.missingPrice.push(month);
      continue;
    }
    const { due } = computeDueDate(month, plan.periodMonths, rule, calendar);
    result.create.push({
      planId: plan.id, profileId: plan.profileId, competenceMonth: month, periodMonths: plan.periodMonths,
      dueDate: due, originalAmountCents: amount,
    });
  }
  return result;
}

export interface ChargeRef {
  id: string;
  competenceMonth: IsoDate;
  status: 'open' | 'partial' | 'paid' | 'canceled';
  hasEffectivePayments: boolean;
  hasAdjustments?: boolean;
}

/**
 * Fim do vínculo em `endedOn`: cancela só as cobranças **futuras** (período que
 * começa depois do fim) e **sem pagamento**. Passadas, pagas e parciais ficam.
 */
export function chargesToCancelOnEnd(endedOn: IsoDate, charges: ChargeRef[]): string[] {
  return charges
    .filter((c) => c.competenceMonth > endedOn && (c.status === 'open') && !c.hasEffectivePayments)
    .map((c) => c.id);
}

/** Cobranças ainda intocadas que passam a valer o novo preço (competência ≥ vigência). */
export function chargesToReprice(effectiveFrom: IsoDate, charges: ChargeRef[]): string[] {
  return charges
    .filter((c) => c.competenceMonth >= effectiveFrom && c.status === 'open' && !c.hasEffectivePayments && !c.hasAdjustments)
    .map((c) => c.id);
}

export type ChargeDisplayStatus = 'forecast' | 'open' | 'overdue' | 'partial' | 'paid' | 'canceled' | 'in_review';

export interface DisplayStatusInput {
  stored: 'open' | 'partial' | 'paid' | 'canceled';
  competenceMonth: IsoDate;
  periodMonths: number;
  dueDate: IsoDate;
  today: IsoDate;
  /** Há comprovante `submitted`/`in_review` apontando para a cobrança. */
  inReview?: boolean;
}

/**
 * Situação mostrada ao usuário. `overdue` e `in_review` são derivados na
 * leitura — nunca gravados. Prioridade: cancelada > paga > em análise >
 * parcial > vencida > aberta > prevista.
 */
export function chargeDisplayStatus(i: DisplayStatusInput): ChargeDisplayStatus {
  if (i.stored === 'canceled') return 'canceled';
  if (i.stored === 'paid') return 'paid';
  if (i.inReview) return 'in_review';
  if (i.stored === 'partial') return 'partial';
  if (i.today > i.dueDate) return 'overdue';
  const periodEnd = lastOfMonth(addMonths(firstOfMonth(i.competenceMonth), i.periodMonths - 1));
  return i.today <= periodEnd ? 'forecast' : 'open';
}

export const CHARGE_STATUS_LABEL: Record<ChargeDisplayStatus, string> = {
  forecast: 'Prevista',
  open: 'Em aberto',
  overdue: 'Vencida',
  partial: 'Parcial',
  paid: 'Paga',
  canceled: 'Cancelada',
  in_review: 'Em análise',
};
