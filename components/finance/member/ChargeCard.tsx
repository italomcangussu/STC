import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ChargeStatementRow, MemberPendencyMeta } from '../../../lib/finance/types';
import { chargeSubtitle, chargeTitle, guestLine, isPendencyCharge } from '../../../lib/finance/memberStatement';
import { formatBRL } from '../../../lib/finance/money';
import { ChargeStatusBadge, btnGhost, btnPrimary } from '../ui';
import { StatementHistory } from './StatementHistory';

const Line: React.FC<{ label: string; value: React.ReactNode; valueClass?: string }> = ({ label, value, valueClass = '' }) => (
  <div className="flex justify-between"><dt className="text-stone-500">{label}</dt><dd className={valueClass}>{value}</dd></div>
);

/** Multa e juros do atraso; se o clube ainda não definiu os encargos, diz isso em vez de mostrar zero. */
const LateRows: React.FC<{ charge: ChargeStatementRow }> = ({ charge: c }) => (
  <>
    <Line label="Dias de atraso" value={c.days_late} valueClass="font-bold text-red-600" />
    {c.fees_configured ? (
      <>
        <Line label="Multa" value={formatBRL(c.fine_due_cents)} valueClass="tabular-nums" />
        <Line label="Juros" value={formatBRL(c.interest_due_cents)} valueClass="tabular-nums" />
      </>
    ) : <p className="text-xs text-stone-400">Encargos de atraso ainda não definidos pelo clube.</p>}
  </>
);

const Amounts: React.FC<{ charge: ChargeStatementRow; payable: boolean }> = ({ charge: c, payable }) => (
  <dl className="mt-3 space-y-1 text-sm">
    <Line label="Valor original" value={formatBRL(c.original_amount_cents)} valueClass="font-bold tabular-nums" />
    {c.principal_base_cents !== c.original_amount_cents && <Line label="Valor com ajustes" value={formatBRL(c.principal_base_cents)} valueClass="font-bold tabular-nums" />}
    {c.principal_paid_cents > 0 && <Line label="Já pago" value={`− ${formatBRL(c.principal_paid_cents)}`} valueClass="font-bold tabular-nums text-emerald-600" />}
    {payable && c.days_late > 0 && <LateRows charge={c} />}
    {payable && (
      <div className="flex justify-between border-t border-stone-100 pt-1.5 text-base"><dt className="font-black text-stone-700">Total atualizado hoje</dt><dd className="font-black tabular-nums text-stone-900">{formatBRL(c.total_due_cents)}</dd></div>
    )}
  </dl>
);

const Heading: React.FC<{ charge: ChargeStatementRow; meta: MemberPendencyMeta | null | undefined }> = ({ charge, meta }) => {
  const guest = isPendencyCharge(charge, meta) ? guestLine(meta) : '';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-black text-stone-800">{chargeTitle(charge, meta)}</p>
        <p className="text-xs text-stone-500">{chargeSubtitle(charge, meta)}</p>
        {guest && <p className="mt-1 text-xs text-stone-400">{guest}</p>}
      </div>
      <ChargeStatusBadge status={charge.display_status} />
    </div>
  );
};

const PayToggle: React.FC<{ title: string; selected: boolean; onToggle: () => void }> = ({ title, selected, onToggle }) => (
  <label className={`${selected ? btnPrimary : btnGhost} cursor-pointer`}>
    <input type="checkbox" className="sr-only" checked={selected} onChange={onToggle} aria-label={`Incluir ${title} no comprovante`} />
    {selected ? 'Incluída no comprovante' : 'Pagar esta'}
  </label>
);

const Notes: React.FC<{ charge: ChargeStatementRow }> = ({ charge }) => (
  <>
    {charge.in_review && <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-medium text-amber-800">Você enviou um comprovante para esta cobrança. O clube está conferindo — ela só muda de situação quando o pagamento for confirmado.</p>}
    {charge.cancel_reason && <p className="mt-2 text-xs text-stone-400">Cancelada: {charge.cancel_reason}</p>}
  </>
);

interface Props { c: ChargeStatementRow; meta?: MemberPendencyMeta | null; selected: boolean; selectable: boolean; onToggle: () => void }

/** Uma cobrança do sócio: valores, atraso, total de hoje, e os atalhos para pagar e ver o histórico. */
export const ChargeCard: React.FC<Props> = ({ c, meta, selected, selectable, onToggle }) => {
  const [historyOpen, setHistoryOpen] = useState(false);
  const payable = c.display_status !== 'paid' && c.display_status !== 'canceled';
  const title = chargeTitle(c, meta);
  return (
    <div className={`rounded-3xl border bg-white p-4 shadow-sm ${selected ? 'border-saibro-400 ring-2 ring-saibro-100' : 'border-stone-100'}`}>
      <Heading charge={c} meta={meta} />
      <Amounts charge={c} payable={payable} />
      <Notes charge={c} />

      <div className="mt-3 flex flex-wrap gap-2">
        {selectable && payable && <PayToggle title={title} selected={selected} onToggle={onToggle} />}
        <button className={btnGhost} onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}>{historyOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />} Histórico</button>
      </div>

      {historyOpen && <StatementHistory chargeId={c.charge_id} />}
    </div>
  );
};
