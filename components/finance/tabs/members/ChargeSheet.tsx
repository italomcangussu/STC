import React, { useState } from 'react';
import { notify } from '../../../../lib/notifications';
import { chargeHistory } from '../../../../lib/finance/financeApi';
import type { ChargeStatementRow } from '../../../../lib/finance/types';
import { availableChargeActions, lastEffectivePayment, type ChargeAction } from '../../../../lib/finance/memberCharges';
import { brDate, monthLabel } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { useAction, useAsync } from '../../hooks';
import { Badge, ChargeStatusBadge, Sheet, btnDanger, btnGhost, btnPrimary } from '../../ui';
import { CancelForm, DiscountForm, PayForm, ReverseForm, WaiverForm, type FormProps, type Submit } from './ChargeForms';
import { ChargeHistory } from './ChargeHistory';

const ACTION_BUTTON: Record<ChargeAction, { label: string; className: string }> = {
  pay: { label: 'Registrar pagamento', className: btnPrimary },
  discount: { label: 'Desconto / acréscimo', className: btnGhost },
  waiver: { label: 'Dispensar encargos', className: btnGhost },
  reverse: { label: 'Estornar último pagamento', className: btnGhost },
  cancel: { label: 'Cancelar cobrança', className: btnDanger },
};

const AmountLine: React.FC<{ label: string; value: React.ReactNode; valueClass?: string }> = ({ label, value, valueClass = 'tabular-nums' }) => (
  <div className="flex justify-between"><dt className="text-stone-500">{label}</dt><dd className={valueClass}>{value}</dd></div>
);

const ChargeSummary: React.FC<{ charge: ChargeStatementRow }> = ({ charge: c }) => (
  <dl className="space-y-1 rounded-2xl bg-stone-50 p-3 text-sm">
    <AmountLine label="Valor original" value={formatBRL(c.original_amount_cents)} valueClass="font-bold tabular-nums" />
    <AmountLine label="Valor com ajustes" value={formatBRL(c.principal_base_cents)} valueClass="font-bold tabular-nums" />
    <AmountLine label="Principal já pago" value={formatBRL(c.principal_paid_cents)} valueClass="font-bold tabular-nums" />
    <AmountLine label="Principal em aberto" value={formatBRL(c.principal_remaining_cents)} valueClass="font-bold tabular-nums" />
    <AmountLine label="Dias de atraso" value={c.days_late} valueClass="font-bold" />
    {c.fees_configured ? (
      <>
        <AmountLine label="Multa devida" value={formatBRL(c.fine_due_cents)} />
        <AmountLine label="Juros devidos" value={formatBRL(c.interest_due_cents)} />
        <AmountLine label="Encargos pagos / dispensados" value={`${formatBRL(c.fees_paid_cents)} / ${formatBRL(c.fees_waived_cents)}`} />
      </>
    ) : <p className="text-xs text-amber-700">Encargos de atraso não configurados (Cadastros › Configurações).</p>}
    <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-black"><dt>Total a pagar</dt><dd className="tabular-nums">{formatBRL(c.total_due_cents)}</dd></div>
  </dl>
);

const ChargeActions: React.FC<{ actions: ChargeAction[]; onChoose: (action: ChargeAction) => void }> = ({ actions, onChoose }) => {
  if (actions.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((action) => <button key={action} className={ACTION_BUTTON[action].className} onClick={() => onChoose(action)}>{ACTION_BUTTON[action].label}</button>)}
    </div>
  );
};

const FORM_BY_ACTION: Record<ChargeAction, React.FC<FormProps>> = {
  pay: PayForm, discount: DiscountForm, waiver: WaiverForm, reverse: ReverseForm, cancel: CancelForm,
};

const StatusRow: React.FC<{ charge: ChargeStatementRow }> = ({ charge }) => (
  <div className="flex items-center justify-between"><ChargeStatusBadge status={charge.display_status} />{charge.in_review && <Badge tone="warn">Comprovante em análise</Badge>}</div>
);

/** Extrato de uma cobrança de sócio e tudo que o administrador pode fazer com ela. */
export const ChargeSheet: React.FC<{ charge: ChargeStatementRow | null; onClose: () => void; onChanged: () => void }> = ({ charge, onClose, onChanged }) => {
  const [mode, setMode] = useState<ChargeAction | null>(null);
  const { busy, run } = useAction({ message: 'Não foi possível concluir a operação.', event: 'finance_charge_action_failed' });
  const history = useAsync(() => (charge ? chargeHistory(charge.charge_id) : Promise.resolve(null)), [charge?.charge_id, busy]);

  if (!charge) return null;
  const lastPayment = lastEffectivePayment(history.data?.payments ?? []);
  const submit: Submit = (action, okText) => run(action, () => { notify.success(okText); setMode(null); onChanged(); });

  const Form = mode === null ? null : FORM_BY_ACTION[mode];

  return (
    <Sheet open onClose={onClose} wide title={`${charge.profile_name} — ${monthLabel(charge.competence_month)}`} subtitle={`Vencimento ${brDate(charge.due_date)}`}>
      <StatusRow charge={charge} />
      <ChargeSummary charge={charge} />
      {Form ? <Form charge={charge} lastPayment={lastPayment} busy={busy} submit={submit} onBack={() => setMode(null)} /> : <ChargeActions actions={availableChargeActions(charge, lastPayment)} onChoose={setMode} />}
      <ChargeHistory data={history.data} loading={history.loading} />
    </Sheet>
  );
};
