/**
 * Tipos das linhas que o banco devolve ao financeiro (snake_case, como vêm).
 * Valores em centavos (`*_cents`) e datas `YYYY-MM-DD` (texto).
 */
import type { ChargeDisplayStatus } from './memberBilling';

export type { ChargeDisplayStatus };

export interface PublicSettings {
  due_day: number;
  due_month_offset: number;
  non_business_rule: 'next_business_day' | 'previous_business_day' | 'keep';
  saturday_is_business: boolean;
  late_fee_confirmed: boolean;
  grace_days: number;
  fine_fixed_cents: number | null;
  fine_percent_bps: number | null;
  interest_daily_fixed_cents: number | null;
  interest_daily_percent_bps: number | null;
}

export interface FinSettings extends Omit<PublicSettings, 'late_fee_confirmed'> {
  id: true;
  horizon_months: number;
  late_fee_confirmed_at: string | null;
  late_fee_confirmed_by: string | null;
  day_card_price_cents: number;
  day_card_in_cash: boolean;
  payee_names: string[];
  version: number;
  updated_at: string;
}

export interface FinHoliday {
  id: string;
  holiday_date: string;
  name: string;
  scope: 'national' | 'state' | 'municipal' | 'club';
  kind: 'holiday' | 'optional';
  active: boolean;
}

export interface FinAccount {
  id: string;
  name: string;
  kind: 'cash' | 'bank' | 'card' | 'other';
  opening_balance_cents: number;
  opening_date: string;
  is_default_receipts: boolean;
  active: boolean;
  position: number;
  version: number;
}

export type DreLineKey = 'revenue' | 'deduction' | 'variable_cost' | 'operational' | 'administrative' | 'commercial' | 'financial' | 'none';

export interface FinCategory {
  id: string;
  parent_id: string | null;
  name: string;
  kind: 'expense' | 'revenue';
  dre_line: DreLineKey;
  system_key: string | null;
  active: boolean;
  position: number;
  version: number;
}

export type EntryKind = 'expense' | 'revenue' | 'contribution' | 'withdrawal' | 'transfer' | 'member_refund';

export interface FinEntry {
  id: string;
  kind: EntryKind;
  status: 'pending' | 'partial' | 'paid' | 'canceled';
  display_status: 'pending' | 'partial' | 'paid' | 'canceled' | 'overdue';
  description: string;
  supplier: string | null;
  category_id: string | null;
  amount_cents: number;
  paid_cents: number;
  remaining_cents: number;
  competence_date: string;
  due_date: string | null;
  account_id: string | null;
  counter_account_id: string | null;
  recurrence_id: string | null;
  notes: string | null;
  adjustment_cents: number;
  settled_on: string | null;
  cancel_reason: string | null;
  version: number;
}

export interface FinRecurrence {
  id: string;
  description: string;
  supplier: string | null;
  category_id: string;
  amount_cents: number;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  due_day: number;
  due_month_offset: number;
  start_month: string;
  end_month: string | null;
  account_id: string | null;
  notes: string | null;
  active: boolean;
  version: number;
}

export interface MemberPlanRow {
  id: string;
  profile_id: string;
  start_on: string;
  ended_on: string | null;
  status: 'active' | 'paused' | 'ended';
  period_months: 1 | 3 | 6 | 12;
  due_day: number | null;
  due_month_offset: number | null;
  notes: string | null;
  end_reason: string | null;
  version: number;
}

export interface PlanPriceRow {
  id: string;
  plan_id: string;
  effective_from: string;
  amount_cents: number;
  reason: string | null;
  created_at: string;
}

export interface ChargeStatementRow {
  charge_id: string;
  plan_id: string;
  profile_id: string;
  profile_name: string;
  competence_month: string;
  period_months: number;
  due_date: string;
  original_amount_cents: number;
  stored_status: 'open' | 'partial' | 'paid' | 'canceled';
  display_status: ChargeDisplayStatus;
  in_review: boolean;
  principal_base_cents: number;
  principal_paid_cents: number;
  principal_remaining_cents: number;
  days_late: number;
  fine_due_cents: number;
  interest_due_cents: number;
  fees_due_cents: number;
  fees_paid_cents: number;
  fees_waived_cents: number;
  total_due_cents: number;
  fees_configured: boolean;
  overdue: boolean;
  last_payment_on: string | null;
  cancel_reason: string | null;
  total_count: number;
}

export interface ChargePaymentRow {
  id: string;
  charge_id: string;
  kind: 'payment' | 'reversal';
  amount_cents: number;
  paid_on: string;
  fine_cents: number;
  interest_cents: number;
  principal_cents: number;
  excess_cents: number;
  method: 'pix' | 'transfer' | 'cash' | 'card' | 'other' | 'credit';
  note: string | null;
  created_at: string;
}

export interface ChargeAdjustmentRow {
  id: string;
  charge_id: string;
  kind: 'discount' | 'increase' | 'fee_waiver';
  amount_cents: number;
  reason: string;
  actor_id: string | null;
  created_at: string;
}

export interface MemberCreditRow {
  id: string;
  profile_id: string;
  reason: 'excess' | 'duplicate';
  amount_cents: number;
  remaining_cents: number;
  status: 'open' | 'applied' | 'refunded' | 'void';
  resolution_note: string | null;
  created_at: string;
}

export type ReceiptStatus = 'submitted' | 'in_review' | 'approved' | 'rejected' | 'superseded';

export interface ReceiptRow {
  id: string;
  profile_id: string;
  status: ReceiptStatus;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_path?: string;
  declared_amount_cents: number | null;
  declared_paid_on: string | null;
  declared_reference: string | null;
  member_note: string | null;
  ocr_status: 'not_run' | 'ok' | 'unreadable' | 'failed';
  ocr: Record<string, unknown> | null;
  possible_duplicate: boolean;
  decision_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface ReceiptQueueRow extends Omit<ReceiptRow, 'member_note' | 'declared_reference'> {
  profile_name: string;
  charge_count: number;
  total_count: number;
}

export interface DreLineRow {
  period: 'current' | 'previous';
  line: Exclude<DreLineKey, 'none'>;
  category_id: string;
  name: string;
  parent_name: string | null;
  amount_cents: number;
}

export interface DreDetailRow {
  category_id: string;
  category_name: string;
  source_type: string;
  source_id: string;
  occurred_on: string;
  description: string;
  amount_cents: number;
  profile_id: string | null;
}

export interface MovementRow {
  source_type: string;
  source_id: string;
  leg: string;
  occurred_on: string;
  flow: string;
  description: string;
  category_id: string | null;
  category_name: string | null;
  account_id: string | null;
  account_name: string;
  amount_cents: number;
  is_transfer: boolean;
  origin: 'auto' | 'manual' | 'derived';
  profile_id: string | null;
  total_count: number;
}

export interface CashFlowBucket {
  bucket_start: string;
  bucket_end: string;
  opening_cents: number;
  inflow_cents: number;
  outflow_cents: number;
  net_cents: number;
  closing_cents: number;
}

export interface AccountBalance {
  id: string | null;
  name: string;
  kind: string;
  active: boolean;
  is_default_receipts: boolean;
  balance_cents: number;
}

export interface ReceivablesSummary {
  open_count: number;
  open_cents: number;
  overdue_count: number;
  overdue_cents: number;
  due_7d_cents: number;
  due_30d_cents: number;
  forecast_cents: number;
  fees_configured: boolean;
  overdue_members: number;
}

export interface PayablesSummary {
  payable_open_cents: number;
  payable_overdue_count: number;
  payable_overdue_cents: number;
  payable_due_7d_cents: number;
  payable_due_30d_cents: number;
  receivable_open_cents: number;
}

export interface MonthlyTrendRow {
  month_start: string;
  revenue_cents: number;
  expense_cents: number;
  cash_in_cents: number;
  cash_out_cents: number;
}

/** Day Card do convidado, derivado da reserva (não há pagamento registrado). */
export interface DayCardRow {
  reservation_id: string;
  occurred_on: string;
  guest_name: string;
  booked_by: string | null;
  exempt: boolean;
  charged_cents: number;
}

export interface AuditRow {
  id: string;
  occurred_at: string;
  action: string;
  table_name: string | null;
  record_id: string | null;
  actor_name_snapshot: string | null;
  target_name_snapshot: string | null;
  changed_fields: string[] | null;
  metadata: Record<string, unknown> | null;
}
