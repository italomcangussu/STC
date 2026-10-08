import React, { useState } from 'react';
import { notify } from '../../../../lib/notifications';
import { endPlan, setPlanPrice } from '../../../../lib/finance/financeApi';
import type { PlanPriceRow } from '../../../../lib/finance/types';
import { addMonths, firstOfMonth, monthLabel, type IsoDate } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { useConfirm } from '../../../../hooks/useConfirm';
import { useRequestKey, useToday } from '../../hooks';
import { ActionPanel, PanelActions } from '../../ActionPanel';
import { Field, MoneyInput, btnDanger, btnPrimary, inputCls } from '../../ui';

/** Executa a operação do plano, avisa o resultado e fecha o formulário. */
export type PlanSubmit = (action: () => Promise<unknown>, okText: string) => Promise<void>;

interface PlanFormProps { planId: string; busy: boolean; submit: PlanSubmit; onBack: () => void }

const MIN_REASON = 3;
const hasReason = (text: string) => text.trim().length >= MIN_REASON;

export const PriceForm: React.FC<PlanFormProps> = ({ planId, busy, submit, onBack }) => {
  const today = useToday();
  const { key } = useRequestKey();
  const [from, setFrom] = useState<IsoDate>(addMonths(firstOfMonth(today), 1));
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const adjust = async () => {
    if (!amount) return;
    await submit(async () => {
      const result = await setPlanPrice(planId, from, amount, reason.trim(), key);
      notify.info(`${result.repriced_charges} cobrança(s) futura(s) ainda intocada(s) passam ao novo valor.`);
    }, 'Valor reajustado.');
  };

  return (
    <ActionPanel className="mt-3" title="Reajustar valor">
      <p className="text-xs text-stone-500">Vale da competência escolhida em diante. Cobranças anteriores — e as que já foram pagas ou ajustadas — não mudam.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Novo valor"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="A partir de"><input type="month" className={inputCls} value={from.slice(0, 7)} onChange={(e) => e.target.value && setFrom(`${e.target.value}-01`)} /></Field>
      </div>
      <Field label="Motivo"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <PanelActions onBack={onBack}>
        <button className={btnPrimary} disabled={busy || !amount || !hasReason(reason)} onClick={adjust}>Reajustar</button>
      </PanelActions>
    </ActionPanel>
  );
};

export const EndForm: React.FC<PlanFormProps> = ({ planId, busy, submit, onBack }) => {
  const today = useToday();
  const confirm = useConfirm();
  const { key } = useRequestKey();
  const [endOn, setEndOn] = useState<IsoDate>(today);
  const [reason, setReason] = useState('');

  const end = async () => {
    const confirmed = await confirm({ tone: 'warning', title: 'Encerrar este vínculo?', description: 'As cobranças futuras sem pagamento serão canceladas.', confirmLabel: 'Encerrar' });
    if (!confirmed) return;
    await submit(async () => {
      const result = await endPlan(planId, endOn, reason.trim(), key);
      notify.info(`${result.canceled_charges} cobrança(s) futura(s) cancelada(s).`);
    }, 'Vínculo encerrado.');
  };

  return (
    <ActionPanel tone="red" className="mt-3" title="Encerrar vínculo">
      <p className="text-xs text-stone-500">Cobranças de períodos que começam depois da data e ainda sem pagamento são canceladas. Passado, pagamentos e histórico ficam intactos.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Último dia do vínculo"><input type="date" className={inputCls} value={endOn} onChange={(e) => setEndOn(e.target.value)} /></Field>
        <Field label="Motivo"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <PanelActions onBack={onBack}>
        <button className={btnDanger} disabled={busy || !hasReason(reason)} onClick={end}>Encerrar</button>
      </PanelActions>
    </ActionPanel>
  );
};

export const PriceHistory: React.FC<{ prices: PlanPriceRow[] }> = ({ prices }) => (
  <ul className="mt-3 space-y-1 text-xs text-stone-600">
    {prices.map((p) => (
      <li key={p.id} className="flex justify-between">
        <span>desde {monthLabel(p.effective_from)}{p.reason ? ` — ${p.reason}` : ''}</span>
        <b className="tabular-nums">{formatBRL(p.amount_cents)}</b>
      </li>
    ))}
  </ul>
);
