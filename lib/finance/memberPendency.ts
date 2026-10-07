import { diffDays, type IsoDate } from './dates';

export const DEFAULT_PENDENCY_REMINDER_DAYS = [0, 3, 7, 14, 21] as const;

export function normalizeReminderDays(days: number[]): number[] {
  return [...new Set(days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))].sort((a, b) => a - b);
}

export function isPendencyReminderDue(dueDate: IsoDate, today: IsoDate, days: readonly number[] = DEFAULT_PENDENCY_REMINDER_DAYS): boolean {
  const late = diffDays(dueDate, today);
  return late >= 0 && normalizeReminderDays([...days]).includes(late);
}

export interface PendencyAllocationCandidate {
  id: string;
  dueDate: IsoDate;
  totalDueCents: number;
}

export function orderPendencyAllocations<T extends PendencyAllocationCandidate>(items: T[], today: IsoDate): T[] {
  return [...items].sort((a, b) => {
    const aOverdue = a.dueDate < today ? 0 : 1;
    const bOverdue = b.dueDate < today ? 0 : 1;
    return aOverdue - bOverdue || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id);
  });
}

type Confidence = 'high' | 'low' | 'none';

export interface AutoApprovePendencyReceiptInput {
  ocrStatus: 'not_run' | 'ok' | 'unreadable' | 'failed';
  possibleDuplicate: boolean;
  amountCents: number | null;
  paidOn: IsoDate | null;
  ocrAmountCents: number | null;
  ocrPaidOn: IsoDate | null;
  amountConfidence: Confidence;
  dateConfidence: Confidence;
  payee: string | null;
  payeeConfidence: Confidence;
  expectedPayees: string[];
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function canAutoApprovePendencyReceipt(i: AutoApprovePendencyReceiptInput): { ok: boolean; reason: string | null } {
  if (i.ocrStatus !== 'ok') return { ok: false, reason: 'OCR_NOT_OK' };
  if (i.possibleDuplicate) return { ok: false, reason: 'POSSIBLE_DUPLICATE' };
  if (i.amountCents === null || i.paidOn === null || i.ocrAmountCents === null || i.ocrPaidOn === null) return { ok: false, reason: 'FIELDS_MISSING' };
  if (i.amountConfidence !== 'high' || i.dateConfidence !== 'high') return { ok: false, reason: 'LOW_CONFIDENCE' };
  if (i.amountCents !== i.ocrAmountCents) return { ok: false, reason: 'AMOUNT_MISMATCH' };
  if (i.paidOn !== i.ocrPaidOn) return { ok: false, reason: 'DATE_MISMATCH' };

  const expected = i.expectedPayees.map(norm).filter(Boolean);
  if (expected.length > 0) {
    if (!i.payee || i.payeeConfidence !== 'high') return { ok: false, reason: 'PAYEE_NOT_CONFIRMED' };
    const got = norm(i.payee);
    if (!expected.some((x) => got.includes(x) || x.includes(got))) return { ok: false, reason: 'PAYEE_MISMATCH' };
  }

  return { ok: true, reason: null };
}
