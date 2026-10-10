/**
 * Taxas dos NÃO-sócios ao clube: o Day Card do convidado (derivado da reserva) e os
 * pagamentos registrados dos alunos (Card Mensal / Aula avulsa, em `student_payments`).
 *
 * As duas tabelas são do app (não do financeiro novo) e a RLS só deixa o administrador
 * escrever; os gatilhos `fin_*_audit` registram cada mudança. O Day Card em si é lido pela
 * função `fin_day_card_rows` (a mesma que alimenta a DRE), então tela e relatório batem.
 */
import { supabase } from '../supabase';
import type { DayCardRow } from './types';
import type { IsoDate } from './dates';

/** O clube fica em Fortaleza (UTC−3, sem horário de verão): a DRE data o pagamento nesse fuso. */
const FORTALEZA_OFFSET = '-03:00';

export interface StudentPaymentRow {
  id: string;
  studentName: string;
  amountCents: number;
  paidOn: IsoDate;
  canceled: boolean;
  canceledReason: string | null;
}

interface StudentPaymentRecord {
  id: string;
  amount: number | string | null;
  payment_date: string;
  status: string | null;
  cancelled_reason: string | null;
  student: { name: string | null } | null;
}

/** Data do pagamento como a DRE enxerga: o dia em Fortaleza, não em UTC. */
export function fortalezaDate(timestamp: string): IsoDate {
  const shifted = new Date(new Date(timestamp).getTime() - 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** `student_payments.amount` é NUMERIC em reais; o financeiro trabalha em centavos inteiros. */
const toCents = (amount: StudentPaymentRecord['amount']): number => Math.round(Number(amount ?? 0) * 100);

export const toStudentPaymentRow = (r: StudentPaymentRecord): StudentPaymentRow => ({
  id: r.id,
  studentName: r.student?.name?.trim() || 'Aluno excluído',
  amountCents: toCents(r.amount),
  paidOn: fortalezaDate(r.payment_date),
  canceled: r.status === 'cancelled',
  canceledReason: r.cancelled_reason,
});

/** Pagamentos de alunos com data (em Fortaleza) dentro do período, mais recentes primeiro. */
export async function listStudentPayments(from: IsoDate, to: IsoDate): Promise<StudentPaymentRow[]> {
  const { data, error } = await supabase
    .from('student_payments')
    .select('id, amount, payment_date, status, cancelled_reason, student:non_socio_students(name)')
    .gte('payment_date', `${from}T00:00:00${FORTALEZA_OFFSET}`)
    .lte('payment_date', `${to}T23:59:59.999${FORTALEZA_OFFSET}`)
    .order('payment_date', { ascending: false })
    .order('id');
  if (error) throw error;
  return ((data ?? []) as unknown as StudentPaymentRecord[]).map(toStudentPaymentRow);
}

export async function deleteStudentPayment(id: string): Promise<void> {
  const { error } = await supabase.from('student_payments').delete().eq('id', id);
  if (error) throw error;
}

async function setDayCardStatus(reservationId: string, paymentStatus: 'exempt' | 'paid'): Promise<void> {
  const { error } = await supabase.from('reservations').update({ payment_status: paymentStatus }).eq('id', reservationId);
  if (error) throw error;
}

/** Isenta o Day Card do convidado: vale R$ 0 no caixa e na DRE. */
export const exemptDayCard = (reservationId: string) => setDayCardStatus(reservationId, 'exempt');

/** Desfaz a isenção: o Day Card volta a valer o preço configurado. */
export const chargeDayCardAgain = (reservationId: string) => setDayCardStatus(reservationId, 'paid');

export interface StudentFeeTotals {
  dayCardCents: number;
  dayCardCharged: number;
  dayCardExempt: number;
  paymentsCents: number;
  paymentsCount: number;
  canceledCount: number;
}

/** Totais do período: só Day Card cobrado e pagamento ativo contam como receita. */
export function studentFeeTotals(dayCards: DayCardRow[], payments: StudentPaymentRow[]): StudentFeeTotals {
  const active = payments.filter((p) => !p.canceled);
  return {
    dayCardCents: dayCards.reduce((s, r) => s + r.charged_cents, 0),
    dayCardCharged: dayCards.filter((r) => !r.exempt).length,
    dayCardExempt: dayCards.filter((r) => r.exempt).length,
    paymentsCents: active.reduce((s, p) => s + p.amountCents, 0),
    paymentsCount: active.length,
    canceledCount: payments.length - active.length,
  };
}
