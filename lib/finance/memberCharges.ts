/**
 * Regras puras das telas de Mensalidades (cobrança, plano, crédito): sem React e sem banco,
 * para os componentes só desenharem e as contas ficarem testáveis num lugar.
 */
import type { ChargeFilters } from './financeApi';
import type { ChargePaymentRow, ChargeStatementRow, FinHoliday, FinSettings, MemberCreditRow } from './types';
import { brDate, firstOfMonth, monthLabel, type IsoDate } from './dates';
import { buildCalendar, CLUB_DEFAULT_DUE_RULE, type DueRule } from './calendar';
import { generationHorizon, planCharges, type PeriodMonths, type PlanChargesResult } from './memberBilling';

/** Cobrança que não está mais em jogo: já quitada ou cancelada. */
export const isSettled = (charge: Pick<ChargeStatementRow, 'display_status'>): boolean =>
  charge.display_status === 'paid' || charge.display_status === 'canceled';

// ------------------------------------------------------------------
// Pagamentos de uma cobrança
// ------------------------------------------------------------------

// O estorno cancela o pagamento de mesma forma e mesmo valor, lançado depois dele.
const reverses = (reversal: ChargePaymentRow, payment: ChargePaymentRow): boolean =>
  reversal.method === payment.method
  && reversal.paid_on >= payment.paid_on
  && reversal.amount_cents === payment.amount_cents
  && reversal.principal_cents === payment.principal_cents
  && reversal.created_at >= payment.created_at;

/** Pagamentos que ainda valem: os que nenhum estorno desfez. */
export function effectivePayments(payments: ChargePaymentRow[]): ChargePaymentRow[] {
  const reversals = payments.filter((p) => p.kind === 'reversal');
  return payments.filter((p) => p.kind === 'payment' && !reversals.some((r) => reverses(r, p)));
}

const momentOf = (payment: ChargePaymentRow): string => payment.paid_on + payment.created_at;

/** O pagamento mais recente que ainda vale (o único que pode ser estornado). Empate: o lançado por último. */
export function lastEffectivePayment(payments: ChargePaymentRow[]): ChargePaymentRow | undefined {
  return effectivePayments(payments).reduce<ChargePaymentRow | undefined>(
    (latest, p) => (latest === undefined || momentOf(p) >= momentOf(latest) ? p : latest),
    undefined,
  );
}

export type ChargeAction = 'pay' | 'discount' | 'waiver' | 'reverse' | 'cancel';

type ActionRule = (charge: ChargeStatementRow, lastPayment: ChargePaymentRow | undefined) => boolean;

// Na ordem em que a folha mostra os botões.
const ACTION_RULES: Array<[ChargeAction, ActionRule]> = [
  ['pay', (charge) => charge.total_due_cents > 0],
  ['discount', (charge) => charge.principal_remaining_cents > 0],
  ['waiver', (charge) => charge.fees_due_cents > 0],
  ['reverse', (_charge, lastPayment) => lastPayment !== undefined],
  ['cancel', (charge, lastPayment) => lastPayment === undefined && charge.stored_status !== 'paid'],
];

/**
 * O que o administrador pode fazer com a cobrança agora, na ordem em que a folha mostra.
 * Com pagamento válido a saída é estornar; só sem pagamento e ainda não quitada dá para cancelar.
 */
export function availableChargeActions(charge: ChargeStatementRow, lastPayment: ChargePaymentRow | undefined): ChargeAction[] {
  if (charge.display_status === 'canceled') return [];
  return ACTION_RULES.filter(([, applies]) => applies(charge, lastPayment)).map(([action]) => action);
}

// ------------------------------------------------------------------
// Lista de cobranças
// ------------------------------------------------------------------

export interface ChargeTotals {
  /** A receber: tudo que não está quitado nem cancelado. */
  due: number;
  overdue: number;
}

export function chargeTotals(rows: ChargeStatementRow[]): ChargeTotals {
  let due = 0;
  let overdue = 0;
  for (const row of rows) {
    if (!isSettled(row)) due += row.total_due_cents;
    if (row.display_status === 'overdue') overdue += row.total_due_cents;
  }
  return { due, overdue };
}

export const CHARGE_STATUS_FILTERS = [['', 'Todas'], ['overdue', 'Vencidas'], ['open', 'Em aberto'], ['forecast', 'Previstas'], ['partial', 'Parciais'], ['in_review', 'Em análise'], ['paid', 'Pagas'], ['canceled', 'Canceladas']] as const;

/** Os filtros que a pessoa mexe na tela de cobranças, como texto dos campos. */
export interface ChargeFilterState {
  search: string;
  status: string;
  /** Mês no formato `YYYY-MM` (campo de mês); vazio = sem limite. */
  compFrom: string;
  compTo: string;
  dueFrom: string;
  dueTo: string;
}

export const NO_CHARGE_FILTERS: ChargeFilterState = { search: '', status: '', compFrom: '', compTo: '', dueFrom: '', dueTo: '' };

/**
 * Filtros da tela → filtros do banco. A busca por nome NÃO vai: lá a comparação é sensível a acento
 * ("joao" não acha "João"), então a tela busca o máximo e filtra por nome no navegador.
 */
export function chargeApiFilters(f: ChargeFilterState): ChargeFilters {
  return {
    status: f.status,
    competenceFrom: f.compFrom ? `${f.compFrom}-01` : undefined,
    competenceTo: f.compTo ? `${f.compTo}-01` : undefined,
    dueFrom: f.dueFrom || undefined,
    dueTo: f.dueTo || undefined,
    chargeType: 'membership',
  };
}

const rangeText = ({ from, to }: { from: string; to: string }, whenEmpty: string): string => (from || to ? `${from || '…'} a ${to || '…'}` : whenEmpty);

/** As linhas "Filtros" do arquivo exportado: o que estava na tela quando a pessoa clicou em exportar. */
export function chargeExportFilters(f: ChargeFilterState, today: IsoDate): Array<{ label: string; value: string }> {
  return [
    { label: 'Situação', value: CHARGE_STATUS_FILTERS.find(([id]) => id === f.status)?.[1] ?? 'Todas' },
    { label: 'Busca', value: f.search || '—' },
    { label: 'Competência', value: rangeText({ from: f.compFrom, to: f.compTo }, 'todas') },
    { label: 'Vencimento', value: rangeText({ from: f.dueFrom, to: f.dueTo }, 'todos') },
    { label: 'Posição em', value: brDate(today) },
  ];
}

/** Cobranças que um crédito do sócio pode abater: do mesmo sócio, com saldo e não canceladas. */
export function creditTargets(charges: ChargeStatementRow[], credit: Pick<MemberCreditRow, 'profile_id'>): ChargeStatementRow[] {
  return charges.filter((c) => c.profile_id === credit.profile_id && c.total_due_cents > 0 && c.display_status !== 'canceled');
}

/** Valor que a lista mostra: o original para a cobrança encerrada, o total atualizado para a que ainda corre. */
export const shownAmountCents = (charge: ChargeStatementRow): number =>
  isSettled(charge) ? charge.original_amount_cents : charge.total_due_cents;

/** " · 3 dia(s) de atraso" só enquanto a cobrança está em jogo. */
export const lateSuffix = (charge: ChargeStatementRow): string =>
  charge.days_late > 0 && !isSettled(charge) ? ` · ${charge.days_late} dia(s) de atraso` : '';

// ------------------------------------------------------------------
// Resolver um crédito
// ------------------------------------------------------------------

export type CreditAction = 'apply' | 'refund' | 'void';

export interface CreditDraft {
  chargeId: string;
  accountId: string;
  reason: string;
}

const MIN_REFUND_NOTE = 3;
const MIN_VOID_REASON = 5;

type Resolver = (draft: CreditDraft) => Record<string, string> | null;

const CREDIT_RESOLVERS: Record<CreditAction, Resolver> = {
  apply: ({ chargeId }) => (chargeId ? { charge_id: chargeId } : null),
  refund: ({ accountId, reason }) => (accountId && reason.trim().length >= MIN_REFUND_NOTE ? { account_id: accountId, reason } : null),
  void: ({ reason }) => (reason.trim().length >= MIN_VOID_REASON ? { reason } : null),
};

/**
 * O que o banco recebe para resolver o crédito, ou `null` enquanto o formulário está incompleto:
 * aplicar pede a cobrança; devolver pede a conta e uma observação; baixar pede uma justificativa.
 */
export const creditResolution = (action: CreditAction, draft: CreditDraft): Record<string, string> | null => CREDIT_RESOLVERS[action](draft);

// ------------------------------------------------------------------
// Prévia de um plano novo
// ------------------------------------------------------------------

export interface NewPlanDraft {
  profile: string;
  start: IsoDate;
  period: PeriodMonths;
  amountCents: number;
}

/** Cobranças que o plano geraria hoje; é o que o administrador confere antes de criar. */
export function previewNewPlan(
  draft: NewPlanDraft,
  context: { today: IsoDate; settings: FinSettings | null; holidays: FinHoliday[] },
): PlanChargesResult {
  const { settings, holidays, today } = context;
  const rule: DueRule = settings
    ? { dueDay: settings.due_day, monthOffset: settings.due_month_offset, nonBusinessRule: settings.non_business_rule }
    : CLUB_DEFAULT_DUE_RULE;
  const calendar = buildCalendar(holidays.map((h) => ({ date: h.holiday_date, active: h.active })), settings?.saturday_is_business ?? false);
  const plan = { id: 'new', profileId: draft.profile || 'x', startOn: draft.start, endedOn: null, status: 'active' as const, periodMonths: draft.period };
  const prices = [{ effectiveFrom: firstOfMonth(draft.start), amountCents: draft.amountCents }];
  return planCharges(plan, prices, [], generationHorizon(today, settings?.horizon_months ?? 1), rule, calendar);
}

/** Quantas das cobranças da prévia já nascem vencidas. */
export const overdueCount = (preview: PlanChargesResult, today: IsoDate): number =>
  preview.create.filter((c) => c.dueDate < today).length;

/** " Ela já está vencida hoje." / " 2 já estão vencidas hoje." — vazio quando nenhuma venceu. */
export function overdueSentence(overdue: number, total: number): string {
  if (overdue === 0) return '';
  if (overdue === total) return overdue === 1 ? ' Ela já está vencida hoje.' : ' Todas já estão vencidas hoje.';
  return ` ${overdue === 1 ? '1 já está vencida' : `${overdue} já estão vencidas`} hoje.`;
}

const TOO_MANY_CHARGES = 12;

/** A prévia deve chamar atenção quando gera muita coisa ou já nasce vencida. */
export const previewNeedsAttention = (preview: PlanChargesResult, overdue: number): boolean =>
  preview.create.length > TOO_MANY_CHARGES || overdue > 0;

/** O texto da prévia: período coberto, primeiro vencimento e os avisos de atraso e de data de início suspeita. */
export function previewSentence(preview: PlanChargesResult, today: IsoDate): string {
  const { create } = preview;
  if (create.length === 0) return 'Nenhuma cobrança no período.';
  const first = create[0];
  const last = create[create.length - 1];
  const range = `De ${monthLabel(first.competenceMonth)} a ${monthLabel(last.competenceMonth)}; a primeira vence em ${brDate(first.dueDate)}.`;
  const lateNote = overdueSentence(overdueCount(preview, today), create.length);
  const manyNote = create.length > TOO_MANY_CHARGES ? ' Muitas competências passadas: confira se a data de início está certa.' : '';
  return range + lateNote + manyNote;
}
