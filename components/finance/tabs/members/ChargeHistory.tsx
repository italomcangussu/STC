import React from 'react';
import type { ChargeAdjustmentRow, ChargePaymentRow } from '../../../../lib/finance/types';
import { brDate } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { Spinner } from '../../ui';

const ADJUSTMENT_LABEL: Record<ChargeAdjustmentRow['kind'], string> = { discount: 'Desconto', increase: 'Acréscimo', fee_waiver: 'Dispensa de encargos' };

export interface ChargeHistoryData { payments: ChargePaymentRow[]; adjustments: ChargeAdjustmentRow[] }

/** " · principal R$ 140,00, encargos R$ 5,00, crédito R$ 5,00": para onde foi o dinheiro de um pagamento. */
const breakdown = (p: ChargePaymentRow): string => {
  const credit = p.excess_cents ? `, crédito ${formatBRL(p.excess_cents)}` : '';
  return ` · principal ${formatBRL(p.principal_cents)}, encargos ${formatBRL(p.fine_cents + p.interest_cents)}${credit}`;
};

const PaymentLine: React.FC<{ payment: ChargePaymentRow }> = ({ payment: p }) => (
  <p>
    {brDate(p.paid_on)} — {p.kind === 'reversal' ? <b className="text-red-600">Estorno</b> : 'Pagamento'} <b>{formatBRL(p.amount_cents)}</b> ({p.method})
    {p.kind === 'payment' && breakdown(p)}{p.note ? ` — ${p.note}` : ''}
  </p>
);

const AdjustmentLine: React.FC<{ adjustment: ChargeAdjustmentRow }> = ({ adjustment: a }) => (
  <p>{brDate(a.created_at.slice(0, 10))} — {ADJUSTMENT_LABEL[a.kind]} <b>{formatBRL(a.amount_cents)}</b>: {a.reason}</p>
);

/** Pagamentos, estornos e ajustes da cobrança, do mais antigo para o mais novo como o banco entrega. */
export const ChargeHistory: React.FC<{ data: ChargeHistoryData | null; loading: boolean }> = ({ data, loading }) => (
  <div className="space-y-1.5 border-t border-stone-100 pt-3 text-xs text-stone-600">
    <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Histórico</p>
    {loading && <Spinner label="Carregando…" />}
    {data?.payments.map((p) => <PaymentLine key={p.id} payment={p} />)}
    {data?.adjustments.map((a) => <AdjustmentLine key={a.id} adjustment={a} />)}
    {data && data.payments.length + data.adjustments.length === 0 && <p className="text-stone-400">Sem pagamentos ou ajustes.</p>}
  </div>
);
