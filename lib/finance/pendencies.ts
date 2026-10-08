/**
 * Regras puras da aba Pendências de sócios (cobranças manuais com régua pelo WhatsApp): texto da régua,
 * montagem da lista, totais, validação e dados de uma pendência nova. Sem React e sem banco.
 */
import type { CreateMemberPendencyInput } from './financeApi';
import type { ChargeStatementRow, FinCategory, FinSettings, MemberPendencyKind, MemberPendencyMeta } from './types';
import { firstOfMonth, type IsoDate } from './dates';
import { formatBRL } from './money';
import { matchesSearch } from '../searchText';

export const PENDENCY_KINDS: ReadonlyArray<readonly [MemberPendencyKind, string]> = [
  ['day_card', 'Day Card'],
  ['consumo', 'Consumo'],
  ['evento', 'Evento'],
  ['multa', 'Multa'],
  ['dano_reposicao', 'Dano / reposição'],
  ['outros', 'Outros'],
];

export const PENDENCY_STATUS_FILTERS = [['', 'Todas'], ['overdue', 'Vencidas'], ['open', 'Em aberto'], ['partial', 'Parciais'], ['in_review', 'Em análise'], ['paid', 'Pagas'], ['canceled', 'Canceladas']] as const;

export const pendencyKindLabel = (kind: MemberPendencyKind): string => PENDENCY_KINDS.find(([id]) => id === kind)?.[1] ?? kind;

// ------------------------------------------------------------------
// Texto da régua
// ------------------------------------------------------------------

/** [0, 3, 7] → "No vencimento, +3 e +7 dias". */
export function reminderDaysText(days: number[]): string {
  if (days.length === 0) return 'Nenhum envio';
  const parts = days.map((d) => (d === 0 ? 'no vencimento' : `+${d}`));
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
  const text = days[days.length - 1] === 0 ? joined : `${joined} dias`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const percentText = (bps: number): string => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/** Multa ou juros: valor fixo, percentual ou os dois ("R$ 5,00 + 2%"); vazio quando não cobra. */
export const feeText = (fixedCents: number, bps: number): string =>
  [fixedCents ? formatBRL(fixedCents) : null, bps ? percentText(bps) : null].filter(Boolean).join(' + ');

// ------------------------------------------------------------------
// Lista e totais
// ------------------------------------------------------------------

export type PendencyRow = ChargeStatementRow & { meta: MemberPendencyMeta };

/** Junta cada cobrança à sua ficha de pendência (as sem ficha somem) e aplica a busca por sócio, descrição ou convidado. */
export function pendencyRows(statements: ChargeStatementRow[], metas: MemberPendencyMeta[], search: string): PendencyRow[] {
  const byId = new Map(metas.map((m) => [m.id, m]));
  const rows: PendencyRow[] = [];
  for (const statement of statements) {
    const meta = byId.get(statement.charge_id);
    if (meta && matchesPendencySearch(statement, meta, search)) rows.push({ ...statement, meta });
  }
  return rows;
}

const matchesPendencySearch = (statement: ChargeStatementRow, meta: MemberPendencyMeta, search: string): boolean =>
  !search.trim() || matchesSearch(search, `${statement.profile_name} ${meta.description} ${meta.guest_name ?? ''}`);

export interface PendencyTotals {
  /** Saldo em aberto: tudo que não está quitado nem cancelado. */
  open: number;
  overdue: number;
}

export function pendencyTotals(rows: ChargeStatementRow[]): PendencyTotals {
  let open = 0;
  let overdue = 0;
  for (const row of rows) {
    if (row.stored_status !== 'paid' && row.stored_status !== 'canceled') open += row.total_due_cents;
    if (row.display_status === 'overdue') overdue += row.total_due_cents;
  }
  return { open, overdue };
}

// ------------------------------------------------------------------
// Ações sobre uma pendência
// ------------------------------------------------------------------

export type PendencyAction = 'pay' | 'send' | 'toggle' | 'cancel';

type ActionRule = (row: PendencyRow) => boolean;

// Na ordem dos botões.
const ACTION_RULES: Array<[PendencyAction, ActionRule]> = [
  ['pay', (row) => row.total_due_cents > 0],
  ['send', (row) => row.total_due_cents > 0 && row.meta.collection_enabled],
  ['toggle', (row) => row.total_due_cents > 0],
  ['cancel', (row) => row.principal_paid_cents === 0 && row.stored_status !== 'paid'],
];

/** O que dá para fazer com a pendência agora, na ordem dos botões. Cancelada: nada. */
export function availablePendencyActions(row: PendencyRow): PendencyAction[] {
  if (row.stored_status === 'canceled') return [];
  return ACTION_RULES.filter(([, applies]) => applies(row)).map(([action]) => action);
}

// ------------------------------------------------------------------
// Pendência nova
// ------------------------------------------------------------------

export interface PendencyDraft {
  profile: string;
  kind: MemberPendencyKind;
  description: string;
  amount: number | null;
  competence: IsoDate;
  due: IsoDate;
  guestName: string;
  guestDate: IsoDate | '';
  sendNow: boolean;
  collection: boolean;
  alreadyPaid: boolean;
  paidOn: IsoDate;
  method: string;
  account: string;
}

/** O formulário limpo: Day Card pelo valor do clube, competência e vencimento hoje, cobrança automática ligada. */
export function emptyPendencyDraft(today: IsoDate, settings: FinSettings | null, accountId: string): PendencyDraft {
  return {
    profile: '', kind: 'day_card', description: '', amount: settings?.day_card_price_cents ?? null, competence: firstOfMonth(today), due: today,
    guestName: '', guestDate: '', sendNow: false, collection: true, alreadyPaid: false, paidOn: today, method: 'pix', account: accountId,
  };
}

/** Day Card traz o valor do clube; o valor que a pessoa já digitou só é trocado se ainda for o do clube ou estiver vazio. */
export function amountAfterKindChange(next: MemberPendencyKind, amount: number | null, dayCardPriceCents: number | null | undefined): number | null {
  const untouched = !amount || amount === dayCardPriceCents;
  return next === 'day_card' && untouched ? (dayCardPriceCents ?? amount) : amount;
}

/** Day Card e as demais pendências têm categoria própria no plano de contas. */
export function pendencyCategoryId(categories: FinCategory[], kind: MemberPendencyKind): string | null {
  const key = kind === 'day_card' ? 'day_card' : 'member_pendency';
  return categories.find((c) => c.system_key === key)?.id ?? null;
}

const MIN_DESCRIPTION = 3;

export function isPendencyReady(draft: PendencyDraft, categoryId: string | null): boolean {
  const described = draft.description.trim().length >= MIN_DESCRIPTION;
  const paidWithAccount = !draft.alreadyPaid || Boolean(draft.account);
  const hasValue = Boolean(draft.amount && draft.amount > 0);
  return [draft.profile, described, hasValue, draft.competence, draft.due, categoryId, paidWithAccount].every(Boolean);
}

// Convidado e data da visita só existem no Day Card.
const guestFields = (d: PendencyDraft) => (d.kind === 'day_card'
  ? { guestName: d.guestName.trim() || null, guestDate: d.guestDate || null }
  : { guestName: null, guestDate: null });

// "Já foi pago" leva o pagamento junto e nunca vai com "cobrar agora".
const paymentFields = (d: PendencyDraft) => (d.alreadyPaid
  ? { alreadyPaid: true, sendNow: false, paidOn: d.paidOn, method: d.method, accountId: d.account }
  : { alreadyPaid: false, sendNow: d.sendNow, paidOn: null, method: null, accountId: null });

/** O que o banco recebe. */
export function pendencyInput(draft: PendencyDraft, categoryId: string | null): CreateMemberPendencyInput {
  return {
    profileId: draft.profile,
    description: draft.description.trim(),
    amountCents: draft.amount ?? 0,
    competenceMonth: firstOfMonth(draft.competence),
    dueDate: draft.due,
    pendencyKind: draft.kind,
    categoryId,
    collectionEnabled: draft.collection,
    ...guestFields(draft),
    ...paymentFields(draft),
  };
}

/** O aviso depois de criar: diz o que de fato aconteceu (pagamento registrado, cobrança na fila ou só a pendência). */
export function pendencyCreatedMessage(draft: Pick<PendencyDraft, 'alreadyPaid' | 'sendNow'>): string {
  if (draft.alreadyPaid) return 'Pendência lançada e pagamento registrado.';
  return draft.sendNow ? 'Pendência criada. A cobrança entrou na fila do WhatsApp.' : 'Pendência criada.';
}
