import React, { useState } from 'react';
import { cancelCharge, registerPayment } from '../../../../lib/finance/financeApi';
import type { ChargeStatementRow } from '../../../../lib/finance/types';
import { defaultReceiptsAccountId } from '../../../../lib/finance/accounts';
import type { IsoDate } from '../../../../lib/finance/dates';
import { useRequestKey, useToday } from '../../hooks';
import { useFinance } from '../../FinanceContext';
import { ActionPanel, PanelActions } from '../../ActionPanel';
import { AccountSelect, MethodSelect } from '../../fields';
import { Field, MoneyInput, btnDanger, btnPrimary, inputCls } from '../../ui';

/** Executa a operação, avisa o resultado e fecha o quadro. */
export type PendencySubmit = (action: () => Promise<unknown>, okText: string) => Promise<void>;

interface PanelProps { charge: ChargeStatementRow; busy: boolean; submit: PendencySubmit; onBack: () => void }

const MIN_CANCEL_REASON = 5;

export const PayPanel: React.FC<PanelProps> = ({ charge, busy, submit, onBack }) => {
  const today = useToday();
  const { accounts } = useFinance();
  const { key } = useRequestKey();
  const [amount, setAmount] = useState<number | null>(charge.total_due_cents);
  const [date, setDate] = useState<IsoDate>(today);
  const [method, setMethod] = useState('pix');
  const [account, setAccount] = useState(defaultReceiptsAccountId(accounts));

  const pay = async () => {
    if (!amount) return;
    await submit(() => registerPayment(charge.charge_id, amount, date, method, account, null, key), 'Pagamento registrado.');
  };

  return (
    <ActionPanel tone="emerald" title="Registrar pagamento">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Data"><input type="date" className={inputCls} value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Forma"><MethodSelect value={method} onChange={setMethod} /></Field>
      </div>
      <Field label="Conta"><AccountSelect accounts={accounts} value={account} onChange={setAccount} placeholder="Escolha…" /></Field>
      <PanelActions onBack={onBack}>
        <button className={btnPrimary} disabled={busy || !amount || amount <= 0 || !account} onClick={pay}>Confirmar</button>
      </PanelActions>
    </ActionPanel>
  );
};

export const CancelPanel: React.FC<PanelProps> = ({ charge, busy, submit, onBack }) => {
  const { key } = useRequestKey();
  const [reason, setReason] = useState('');
  return (
    <ActionPanel tone="red">
      <Field label="Motivo do cancelamento"><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <PanelActions onBack={onBack}>
        <button className={btnDanger} disabled={busy || reason.trim().length < MIN_CANCEL_REASON} onClick={() => submit(() => cancelCharge(charge.charge_id, reason.trim(), key), 'Pendência cancelada.')}>Cancelar pendência</button>
      </PanelActions>
    </ActionPanel>
  );
};
