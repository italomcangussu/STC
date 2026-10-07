/**
 * Acesso ao financeiro: leitura por tabelas/visões (RLS) e funções do banco;
 * escrita SÓ pelas funções `fin_*` (SECURITY DEFINER), sempre com chave de
 * idempotência. A tela não soma nada que o relatório mostre: ela formata.
 *
 * Erros: as funções lançam códigos (`REASON_REQUIRED`…); `errors.ts` os traduz.
 * Nada aqui registra valores, arquivos ou texto de comprovante em log.
 */
import { supabase } from '../supabase';
import type {
  AccountBalance, AuditRow, CashFlowBucket, ChargeAdjustmentRow, ChargePaymentRow, ChargeStatementRow, DreDetailRow, DreLineRow, FinAccount,
  DayCardRow, FinCategory, FinEntry, FinHoliday, FinRecurrence, FinSettings, MemberCreditRow, MemberPlanRow, MonthlyTrendRow, MovementRow,
  PayablesSummary, PlanPriceRow, PublicSettings, ReceiptQueueRow, ReceiptRow, ReceivablesSummary,
} from './types';
import type { IsoDate } from './dates';
import { RECEIPT_TYPES, receiptStoragePath, type ReceiptMime } from './receiptFile';
import { sendPushNotification } from '../notificationService';
import { receiptDecisionNotice } from './receipts';

export const RECEIPTS_BUCKET = 'fin-receipts';
export const DOCS_BUCKET = 'fin-docs';

/** Chave de idempotência: uma por tentativa de operação (reaproveitada em reenvios). */
export const newRequestId = (): string => globalThis.crypto.randomUUID();

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

async function rows<T>(fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
  return (await call<T[] | null>(fn, args)) ?? [];
}

// ------------------------------------------------------------------
// Configuração, calendário, contas, categorias
// ------------------------------------------------------------------
export const getPublicSettings = async (): Promise<PublicSettings> => (await rows<PublicSettings>('fin_public_settings'))[0];

export async function getSettings(): Promise<FinSettings> {
  const { data, error } = await supabase.from('fin_settings').select('*').single();
  if (error) throw error;
  return data as FinSettings;
}
export const saveSettings = (version: number, data: Record<string, unknown>, requestId = newRequestId()) =>
  call<{ version: number }>('fin_save_settings', { p_request_id: requestId, p_expected_version: version, p_data: data });

export async function listHolidays(): Promise<FinHoliday[]> {
  const { data, error } = await supabase.from('fin_holidays').select('*').order('holiday_date');
  if (error) throw error;
  return (data ?? []) as FinHoliday[];
}
export const saveHoliday = (id: string | null, data: Record<string, unknown>, requestId = newRequestId()) =>
  call('fin_save_holiday', { p_request_id: requestId, p_id: id, p_data: data });
export const seedHolidays = (year: number, requestId = newRequestId()) => call('fin_seed_holidays', { p_request_id: requestId, p_year: year });

export async function listAccounts(): Promise<FinAccount[]> {
  const { data, error } = await supabase.from('fin_accounts').select('*').order('position').order('name');
  if (error) throw error;
  return (data ?? []) as FinAccount[];
}
export const saveAccount = (id: string | null, version: number | null, data: Record<string, unknown>, requestId = newRequestId()) =>
  call<{ id: string }>('fin_save_account', { p_request_id: requestId, p_id: id, p_expected_version: version, p_data: data });
export const accountBalances = (at?: IsoDate) => rows<AccountBalance>('fin_account_balances', { p_at: at ?? null });

export async function listCategories(): Promise<FinCategory[]> {
  const { data, error } = await supabase.from('fin_categories').select('*').order('position').order('name');
  if (error) throw error;
  return (data ?? []) as FinCategory[];
}
export const saveCategory = (id: string | null, version: number | null, data: Record<string, unknown>, requestId = newRequestId()) =>
  call<{ id: string }>('fin_save_category', { p_request_id: requestId, p_id: id, p_expected_version: version, p_data: data });

// ------------------------------------------------------------------
// Lançamentos (contas a pagar/receber, pontuais, transferências), recorrências, anexos
// ------------------------------------------------------------------
export interface EntryFilters {
  status?: 'open' | 'overdue' | 'paid' | 'canceled' | 'all';
  kind?: string;
  search?: string;
  dueFrom?: IsoDate;
  dueTo?: IsoDate;
  competenceFrom?: IsoDate;
  competenceTo?: IsoDate;
  limit?: number;
}

export async function listEntries(f: EntryFilters = {}): Promise<FinEntry[]> {
  let q = supabase.from('fin_entries_v').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(f.limit ?? 300);
  if (f.status === 'open') q = q.in('display_status', ['pending', 'partial', 'overdue']);
  else if (f.status && f.status !== 'all') q = q.eq('display_status', f.status);
  if (f.kind) q = q.eq('kind', f.kind);
  if (f.search?.trim()) q = q.ilike('description', `%${f.search.trim().replace(/[%_]/g, '')}%`);
  if (f.dueFrom) q = q.gte('due_date', f.dueFrom);
  if (f.dueTo) q = q.lte('due_date', f.dueTo);
  if (f.competenceFrom) q = q.gte('competence_date', f.competenceFrom);
  if (f.competenceTo) q = q.lte('competence_date', f.competenceTo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as FinEntry[];
}

export interface EntryPaymentRow { id: string; entry_id: string; kind: 'payment' | 'reversal'; amount_cents: number; paid_on: string; account_id: string; note: string | null; reverses_payment_id: string | null }
export async function listEntryPayments(entryId: string): Promise<EntryPaymentRow[]> {
  const { data, error } = await supabase.from('fin_entry_payments').select('*').eq('entry_id', entryId).order('created_at');
  if (error) throw error;
  return (data ?? []) as EntryPaymentRow[];
}

export const createEntry = (data: Record<string, unknown>, requestId = newRequestId()) => call<{ id: string }>('fin_create_entry', { p_request_id: requestId, p_data: data });
export const updateEntry = (id: string, version: number, data: Record<string, unknown>, reason: string | null, requestId = newRequestId()) =>
  call('fin_update_entry', { p_request_id: requestId, p_id: id, p_expected_version: version, p_data: data, p_reason: reason });
export const payEntry = (id: string, version: number, data: Record<string, unknown>, requestId = newRequestId()) =>
  call('fin_pay_entry', { p_request_id: requestId, p_id: id, p_expected_version: version, p_data: data });
export const reverseEntryPayment = (paymentId: string, reason: string, requestId = newRequestId()) =>
  call('fin_reverse_entry_payment', { p_request_id: requestId, p_payment_id: paymentId, p_reason: reason });
export const cancelEntry = (id: string, version: number, reason: string, requestId = newRequestId()) =>
  call('fin_cancel_entry', { p_request_id: requestId, p_id: id, p_expected_version: version, p_reason: reason });

export async function listRecurrences(): Promise<FinRecurrence[]> {
  const { data, error } = await supabase.from('fin_recurrences').select('*').order('description');
  if (error) throw error;
  return (data ?? []) as FinRecurrence[];
}
export const saveRecurrence = (id: string | null, version: number | null, data: Record<string, unknown>, applyFrom: IsoDate | null, requestId = newRequestId()) =>
  call<{ id: string }>('fin_save_recurrence', { p_request_id: requestId, p_id: id, p_expected_version: version, p_data: data, p_apply_from: applyFrom });
/** Apaga o modelo da recorrência: o pendente sem pagamento é cancelado e o que já foi pago fica como lançamento avulso. */
export const deleteRecurrence = (id: string, version: number, requestId = newRequestId()) =>
  call<{ id: string; canceled: number; kept: number }>('fin_delete_recurrence', { p_request_id: requestId, p_id: id, p_expected_version: version, p_data: {} });
export const generateRecurrences = (requestId = newRequestId()) => call<{ created: number }>('fin_generate_recurrences', { p_request_id: requestId, p_until: null });

export interface AttachmentRow { id: string; entry_id: string; storage_path: string; file_name: string; content_type: string; size_bytes: number; uploaded_at: string; removed_at: string | null }
export async function listAttachments(entryId: string): Promise<AttachmentRow[]> {
  const { data, error } = await supabase.from('fin_attachments').select('*').eq('entry_id', entryId).is('removed_at', null).order('uploaded_at');
  if (error) throw error;
  return (data ?? []) as AttachmentRow[];
}
export async function uploadAttachment(entryId: string, file: File, type: ReceiptMime, safeName: string): Promise<void> {
  const path = `${entryId}/${newRequestId()}-${safeName}`;
  const { error } = await supabase.storage.from(DOCS_BUCKET).upload(path, file, { contentType: type, upsert: false });
  if (error) throw error;
  await call('fin_attach_file', { p_request_id: newRequestId(), p_entry: entryId, p_path: path, p_name: file.name.slice(0, 200), p_content_type: type, p_size: file.size });
}
export const removeAttachment = (id: string, reason: string, requestId = newRequestId()) => call('fin_remove_attachment', { p_request_id: requestId, p_id: id, p_reason: reason });
export async function signedUrl(bucket: string, path: string, seconds = 120): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data) throw error ?? new Error('signed_url_failed');
  return data.signedUrl;
}

// ------------------------------------------------------------------
// Mensalidades dos sócios
// ------------------------------------------------------------------
/** Chave de `fin_member_plans.profile_id` → `profiles` (nome gerado pelo Postgres; um teste SQL garante que existe). */
export const PLAN_PROFILE_FK = 'fin_member_plans_profile_id_fkey';
export interface PlanWithMember extends MemberPlanRow { profile: { name: string; avatar_url: string | null; is_active: boolean | null } | null }
export async function listPlans(): Promise<PlanWithMember[]> {
  // `fin_member_plans` aponta 3 vezes para `profiles` (sócio, criado por, alterado por): sem dizer QUAL
  // chave usar, o PostgREST recusa a consulta por ambiguidade e a tela inteira falha ao carregar.
  const { data, error } = await supabase.from('fin_member_plans').select(`*, profile:profiles!${PLAN_PROFILE_FK}(name, avatar_url, is_active)`).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PlanWithMember[];
}
export async function listPlanPrices(planId: string): Promise<PlanPriceRow[]> {
  const { data, error } = await supabase.from('fin_member_plan_prices').select('*').eq('plan_id', planId).order('effective_from', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PlanPriceRow[];
}
export const createPlan = (data: Record<string, unknown>, requestId = newRequestId()) => call<{ id: string }>('fin_create_member_plan', { p_request_id: requestId, p_data: data });
export const setPlanPrice = (planId: string, effectiveFrom: IsoDate, amountCents: number, reason: string, requestId = newRequestId()) =>
  call<{ repriced_charges: number }>('fin_set_plan_price', { p_request_id: requestId, p_plan_id: planId, p_effective_from: effectiveFrom, p_amount_cents: amountCents, p_reason: reason });
export const updatePlan = (planId: string, version: number, data: Record<string, unknown>, requestId = newRequestId()) =>
  call('fin_update_member_plan', { p_request_id: requestId, p_plan_id: planId, p_expected_version: version, p_data: data });
export const endPlan = (planId: string, endedOn: IsoDate, reason: string, requestId = newRequestId()) =>
  call<{ canceled_charges: number }>('fin_end_member_plan', { p_request_id: requestId, p_plan_id: planId, p_ended_on: endedOn, p_reason: reason });
export const generateCharges = (planId: string | null = null, requestId = newRequestId()) =>
  call<{ created: number; existing: number; missing_price: number }>('fin_generate_member_charges', { p_request_id: requestId, p_plan_id: planId, p_today: null });

export interface ChargeFilters {
  search?: string; status?: string; competenceFrom?: IsoDate; competenceTo?: IsoDate; dueFrom?: IsoDate; dueTo?: IsoDate; profileId?: string; planId?: string;
}
const filterJson = (f: ChargeFilters) => ({
  search: f.search ?? '', status: f.status ?? '', competence_from: f.competenceFrom ?? '', competence_to: f.competenceTo ?? '',
  due_from: f.dueFrom ?? '', due_to: f.dueTo ?? '', profile_id: f.profileId ?? '', plan_id: f.planId ?? '',
});
export const listCharges = (f: ChargeFilters = {}, limit = 200, offset = 0, asOf?: IsoDate) =>
  rows<ChargeStatementRow>('fin_charge_statements', { p_filters: filterJson(f), p_as_of: asOf ?? null, p_limit: limit, p_offset: offset });
export const chargeStatementsByIds = (ids: string[], asOf?: IsoDate) => rows<ChargeStatementRow>('fin_charge_statements_by_ids', { p_ids: ids, p_as_of: asOf ?? null });
export const myCharges = (asOf?: IsoDate) => rows<ChargeStatementRow>('fin_my_charges', { p_as_of: asOf ?? null });

export async function chargeHistory(chargeId: string): Promise<{ payments: ChargePaymentRow[]; adjustments: ChargeAdjustmentRow[] }> {
  const [p, a] = await Promise.all([
    supabase.from('fin_charge_payments').select('id, charge_id, kind, amount_cents, paid_on, fine_cents, interest_cents, principal_cents, excess_cents, method, note, created_at').eq('charge_id', chargeId).order('created_at'),
    supabase.from('fin_charge_adjustments').select('id, charge_id, kind, amount_cents, reason, actor_id, created_at').eq('charge_id', chargeId).order('created_at'),
  ]);
  if (p.error) throw p.error;
  if (a.error) throw a.error;
  return { payments: (p.data ?? []) as ChargePaymentRow[], adjustments: (a.data ?? []) as ChargeAdjustmentRow[] };
}

export const adjustCharge = (chargeId: string, kind: 'discount' | 'increase' | 'fee_waiver', amountCents: number, reason: string, requestId = newRequestId()) =>
  call('fin_adjust_charge', { p_request_id: requestId, p_charge: chargeId, p_kind: kind, p_amount_cents: amountCents, p_reason: reason });
export const registerPayment = (chargeId: string, amountCents: number, paidOn: IsoDate, method: string, accountId: string, note: string | null, requestId = newRequestId()) =>
  call<{ payment_id: string; excess_cents: number; charge_status: string }>('fin_register_payment', {
    p_request_id: requestId, p_charge: chargeId, p_amount_cents: amountCents, p_paid_on: paidOn, p_method: method, p_account: accountId, p_note: note,
  });
export const reversePayment = (paymentId: string, reason: string, requestId = newRequestId()) => call('fin_reverse_payment', { p_request_id: requestId, p_payment_id: paymentId, p_reason: reason });
export const cancelCharge = (chargeId: string, reason: string, requestId = newRequestId()) => call('fin_cancel_charge', { p_request_id: requestId, p_charge: chargeId, p_reason: reason });

export async function listCredits(profileId?: string): Promise<MemberCreditRow[]> {
  let q = supabase.from('fin_member_credits').select('*').order('created_at', { ascending: false });
  if (profileId) q = q.eq('profile_id', profileId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MemberCreditRow[];
}
export const resolveCredit = (creditId: string, action: 'apply' | 'refund' | 'void', data: Record<string, unknown>, requestId = newRequestId()) =>
  call('fin_resolve_credit', { p_request_id: requestId, p_credit: creditId, p_action: action, p_data: data });

/** Sócios que ainda podem receber um plano (ativos e sem plano vivo). */
export async function listMembersWithoutPlan(): Promise<Array<{ id: string; name: string }>> {
  const [members, plans] = await Promise.all([
    supabase.from('profiles').select('id, name').in('role', ['socio', 'admin']).eq('is_active', true).order('name'),
    supabase.from('fin_member_plans').select('profile_id').neq('status', 'ended'),
  ]);
  if (members.error) throw members.error;
  if (plans.error) throw plans.error;
  const taken = new Set((plans.data ?? []).map((p) => p.profile_id as string));
  return (members.data ?? []).filter((m) => !taken.has(m.id as string)) as Array<{ id: string; name: string }>;
}

// ------------------------------------------------------------------
// Comprovantes
// ------------------------------------------------------------------
export interface SubmitReceiptInput {
  userId: string;
  submissionId: string;
  requestId: string;
  file: File;
  type: ReceiptMime;
  safeName: string;
  sha256: string;
  chargeIds: string[];
  declaredAmountCents: number | null;
  declaredPaidOn: IsoDate | null;
  reference: string | null;
  note: string | null;
  ocrStatus: 'not_run' | 'ok' | 'unreadable' | 'failed';
  ocr: Record<string, unknown> | null;
  replaces?: string | null;
}

/** Envia o arquivo (bucket privado, pasta do próprio sócio) e registra o envio. Nunca quita nada. */
export async function submitReceipt(i: SubmitReceiptInput): Promise<{ id: string; possible_duplicate: boolean }> {
  if (!(RECEIPT_TYPES as readonly string[]).includes(i.type)) throw new Error('INVALID_ATTACHMENT');
  const path = receiptStoragePath(i.userId, i.submissionId, i.safeName);
  const up = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, i.file, { contentType: i.type, upsert: false });
  // Reenvio da mesma tentativa: o arquivo já subiu na primeira vez.
  if (up.error && !/exists|duplicate/i.test(up.error.message)) throw up.error;
  return call('fin_submit_receipt', {
    p_request_id: i.requestId,
    p_submission_id: i.submissionId,
    p_data: {
      storage_path: path, file_name: i.safeName, content_type: i.type, size_bytes: i.file.size, content_sha256: i.sha256,
      charge_ids: i.chargeIds, declared_amount_cents: i.declaredAmountCents, declared_paid_on: i.declaredPaidOn,
      declared_reference: i.reference, member_note: i.note, ocr_status: i.ocrStatus, ocr: i.ocr, replaces: i.replaces ?? null,
    },
  });
}

export async function myReceipts(): Promise<Array<ReceiptRow & { charge_ids: string[] }>> {
  const { data, error } = await supabase.from('fin_receipt_submissions')
    .select('id, profile_id, status, file_name, content_type, size_bytes, declared_amount_cents, declared_paid_on, declared_reference, member_note, ocr_status, possible_duplicate, decision_reason, reviewed_at, created_at, fin_receipt_charges(charge_id)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const { fin_receipt_charges: links, ...rest } = r as unknown as ReceiptRow & { fin_receipt_charges: Array<{ charge_id: string }> };
    return { ...rest, ocr: null, charge_ids: (links ?? []).map((l) => l.charge_id) };
  });
}

export const receiptQueue = (status: 'pending' | 'approved' | 'rejected' | 'superseded' | null = 'pending', limit = 100, offset = 0) =>
  rows<ReceiptQueueRow>('fin_receipt_queue', { p_status: status, p_limit: limit, p_offset: offset });

export async function receiptDetail(id: string): Promise<ReceiptRow & { storage_path: string; charge_ids: string[] }> {
  const { data, error } = await supabase.from('fin_receipt_submissions').select('*, fin_receipt_charges(charge_id)').eq('id', id).single();
  if (error) throw error;
  const { fin_receipt_charges: links, ...rest } = data as unknown as ReceiptRow & { storage_path: string; fin_receipt_charges: Array<{ charge_id: string }> };
  return { ...rest, charge_ids: (links ?? []).map((l) => l.charge_id) };
}

export const startReceiptReview = (id: string, requestId = newRequestId()) => call('fin_start_receipt_review', { p_request_id: requestId, p_submission_id: id });

export interface ApproveReceiptInput {
  paidOn: IsoDate; method: string; accountId: string; note: string | null;
  allocations: Array<{ chargeId: string; amountCents: number }>;
  waivers: Array<{ chargeId: string; amountCents: number; reason: string }>;
}
export async function approveReceipt(id: string, i: ApproveReceiptInput, profileId: string, requestId = newRequestId()) {
  const res = await call<{ status: string; payment_ids: string[] }>('fin_approve_receipt', {
    p_request_id: requestId, p_submission_id: id,
    p_data: {
      paid_on: i.paidOn, method: i.method, account_id: i.accountId, note: i.note,
      allocations: i.allocations.map((a) => ({ charge_id: a.chargeId, amount_cents: a.amountCents })),
      waivers: i.waivers.map((w) => ({ charge_id: w.chargeId, amount_cents: w.amountCents, reason: w.reason })),
    },
  });
  void notifyMember(profileId, 'approved', null);
  return res;
}
export async function rejectReceipt(id: string, reason: string, profileId: string, requestId = newRequestId()) {
  const res = await call('fin_reject_receipt', { p_request_id: requestId, p_submission_id: id, p_reason: reason });
  void notifyMember(profileId, 'rejected', reason);
  return res;
}

/** Aviso ao sócio (push). Best-effort: a decisão já está gravada e visível na tela dele. */
async function notifyMember(profileId: string, status: 'approved' | 'rejected', reason: string | null): Promise<void> {
  const n = receiptDecisionNotice(status, reason);
  try { await sendPushNotification({ userId: profileId, title: n.title, body: n.body, url: '/#meu-financeiro' }); } catch { /* sem push configurado: a tela já mostra */ }
}

// ------------------------------------------------------------------
// Day Card dos convidados (derivado das reservas com convidado)
// ------------------------------------------------------------------
export const dayCardRows = (from: IsoDate, to: IsoDate) => rows<DayCardRow>('fin_day_card_rows', { p_from: from, p_to: to });

// ------------------------------------------------------------------
// Relatórios
// ------------------------------------------------------------------
export const dreLines = (from: IsoDate, to: IsoDate) => rows<DreLineRow>('fin_dre_lines', { p_from: from, p_to: to });
export const dreMemo = async (from: IsoDate, to: IsoDate) => (await rows<{ contributions_cents: number; withdrawals_cents: number }>('fin_dre_memo', { p_from: from, p_to: to }))[0];
export const dreDetail = (from: IsoDate, to: IsoDate, categoryId: string | null) => rows<DreDetailRow>('fin_dre_detail', { p_from: from, p_to: to, p_category: categoryId });
export const movements = (from: IsoDate, to: IsoDate, filters: Record<string, unknown> = {}, limit = 1000, offset = 0) =>
  rows<MovementRow>('fin_movements', { p_from: from, p_to: to, p_filters: filters, p_limit: limit, p_offset: offset });
export const cashFlow = (from: IsoDate, to: IsoDate, granularity: 'day' | 'week' | 'month', accountId: string | null) =>
  rows<CashFlowBucket>('fin_cash_flow', { p_from: from, p_to: to, p_granularity: granularity, p_account: accountId });
export const receivablesSummary = async () => (await rows<ReceivablesSummary>('fin_receivables_summary'))[0];
export const payablesSummary = async () => (await rows<PayablesSummary>('fin_payables_summary'))[0];
export const monthlyTrend = (months = 6) => rows<MonthlyTrendRow>('fin_monthly_trend', { p_to: null, p_months: months });

export async function listAudit(limit = 100, tableName?: string): Promise<AuditRow[]> {
  let q = supabase.from('admin_audit_logs').select('id, occurred_at, action, table_name, record_id, actor_name_snapshot, target_name_snapshot, changed_fields, metadata')
    .eq('source', 'finance').order('occurred_at', { ascending: false }).limit(limit);
  if (tableName) q = q.eq('table_name', tableName);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AuditRow[];
}
