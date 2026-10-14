/**
 * Saídas fixas do clube (recorrências ativas e vigentes), como o sócio as vê na aba
 * "Financeiro do clube" do Dashboard: só leitura.
 */
export type FixedExpenseFrequency = 'monthly' | 'quarterly' | 'yearly';

export interface FixedExpenseRow {
  id: string;
  description: string;
  supplier: string | null;
  category_name: string;
  amount_cents: number;
  frequency: FixedExpenseFrequency;
  due_day: number;
  start_month: string;
  end_month: string | null;
}

export const FREQUENCY_LABEL: Record<FixedExpenseFrequency, string> = { monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual' };

const MONTHS_PER_CHARGE: Record<FixedExpenseFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Quanto a saída pesa por mês: a trimestral vale um terço, a anual um doze avos (centavos arredondados). */
export function monthlyEquivalentCents(row: Pick<FixedExpenseRow, 'amount_cents' | 'frequency'>): number {
  return Math.round(row.amount_cents / MONTHS_PER_CHARGE[row.frequency]);
}

export function totalMonthlyEquivalentCents(rows: Pick<FixedExpenseRow, 'amount_cents' | 'frequency'>[]): number {
  return rows.reduce((sum, row) => sum + monthlyEquivalentCents(row), 0);
}
