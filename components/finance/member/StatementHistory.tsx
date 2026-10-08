import React from 'react';
import type { ChargeAdjustmentRow, ChargePaymentRow } from '../../../lib/finance/types';
import { paymentBreakdown } from '../../../lib/finance/memberStatement';
import { chargeHistory } from '../../../lib/finance/financeApi';
import { brDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { useAsync } from '../hooks';
import { Spinner } from '../ui';

const ADJUSTMENT_LABEL: Record<ChargeAdjustmentRow['kind'], string> = { discount: 'Desconto', increase: 'Acréscimo', fee_waiver: 'Dispensa de encargos' };

const PaymentLine: React.FC<{ payment: ChargePaymentRow }> = ({ payment: p }) => (
  <p>{brDate(p.paid_on)} — {p.kind === 'reversal' ? 'Estorno' : 'Pagamento'} de <b>{formatBRL(p.amount_cents)}</b>{paymentBreakdown(p)}</p>
);

const AdjustmentLine: React.FC<{ adjustment: ChargeAdjustmentRow }> = ({ adjustment: a }) => (
  <p>{brDate(a.created_at.slice(0, 10))} — {ADJUSTMENT_LABEL[a.kind]} de <b>{formatBRL(a.amount_cents)}</b>: {a.reason}</p>
);

/** Pagamentos, estornos e ajustes de uma cobrança; só carrega quando o sócio abre o histórico. */
export const StatementHistory: React.FC<{ chargeId: string }> = ({ chargeId }) => {
  const history = useAsync(() => chargeHistory(chargeId), [chargeId]);
  const { data } = history;
  return (
    <div className="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-xs text-stone-600">
      {history.loading && <Spinner label="Carregando histórico…" />}
      {data && data.payments.length === 0 && data.adjustments.length === 0 && <p className="text-stone-400">Nenhum pagamento ou ajuste ainda.</p>}
      {data?.payments.map((p) => <PaymentLine key={p.id} payment={p} />)}
      {data?.adjustments.map((a) => <AdjustmentLine key={a.id} adjustment={a} />)}
    </div>
  );
};
