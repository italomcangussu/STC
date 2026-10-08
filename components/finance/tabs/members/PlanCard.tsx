import React, { useState } from 'react';
import { UserMinus } from 'lucide-react';
import { notify } from '../../../../lib/notifications';
import { listPlanPrices, updatePlan, type PlanWithMember } from '../../../../lib/finance/financeApi';
import type { PlanPriceRow } from '../../../../lib/finance/types';
import { brDate, firstOfMonth } from '../../../../lib/finance/dates';
import { priceFor, type PlanStatus } from '../../../../lib/finance/memberBilling';
import { formatBRL } from '../../../../lib/finance/money';
import { useAction, useAsync, useRequestKey, useToday } from '../../hooks';
import { Badge, btnDanger, btnGhost } from '../../ui';
import { EndForm, PriceForm, PriceHistory, type PlanSubmit } from './PlanForms';

type PlanMode = 'price' | 'end' | 'prices';

const STATUS_BADGE = { active: { tone: 'good', label: 'Ativa' }, paused: { tone: 'warn', label: 'Pausada' }, ended: { tone: 'muted', label: 'Encerrada' } } as const;

// Pausar e retomar são o mesmo botão: o que ele faz depende de como o plano está.
const TOGGLE: Partial<Record<PlanStatus, { next: 'active' | 'paused'; done: string }>> = {
  active: { next: 'paused', done: 'Mensalidade pausada.' },
  paused: { next: 'active', done: 'Mensalidade retomada.' },
};

const PlanHeader: React.FC<{ plan: PlanWithMember }> = ({ plan }) => {
  const badge = STATUS_BADGE[plan.status];
  const period = plan.period_months === 1 ? 'mensal' : `a cada ${plan.period_months} meses`;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-stone-800">{plan.profile?.name ?? 'Sócio'}</p>
        <p className="text-xs text-stone-500">Desde {brDate(plan.start_on)} · {period}{plan.ended_on ? ` · encerrada em ${brDate(plan.ended_on)}` : ''}</p>
      </div>
      <Badge tone={badge.tone}>{badge.label}</Badge>
    </div>
  );
};

/** O valor da mensalidade que vale no mês de hoje, ou "—" enquanto os preços não chegaram. */
const CurrentPrice: React.FC<{ prices: PlanPriceRow[] | null }> = ({ prices }) => {
  const today = useToday();
  const cents = prices ? priceFor(prices.map((p) => ({ effectiveFrom: p.effective_from, amountCents: p.amount_cents })), firstOfMonth(today)) : null;
  return <p className="mt-2 text-lg font-black tabular-nums">{cents !== null ? formatBRL(cents) : '—'}<span className="text-xs font-medium text-stone-400"> vigente hoje</span></p>;
};

interface ActionsProps { plan: PlanWithMember; busy: boolean; onChoose: (mode: PlanMode) => void; onToggleStatus: () => void }

const PlanActions: React.FC<ActionsProps> = ({ plan, busy, onChoose, onToggleStatus }) => (
  <div className="mt-3 flex flex-wrap gap-2">
    <button className={btnGhost} onClick={() => onChoose('price')}>Reajustar valor</button>
    <button className={btnGhost} disabled={busy} onClick={onToggleStatus}>{plan.status === 'active' ? 'Pausar' : 'Retomar'}</button>
    <button className={btnGhost} onClick={() => onChoose('prices')}>Histórico de preços</button>
    <button className={btnDanger} onClick={() => onChoose('end')}><UserMinus size={16} /> Encerrar vínculo</button>
  </div>
);

interface PanelProps { mode: PlanMode | null; form: { planId: string; busy: boolean; submit: PlanSubmit; onBack: () => void }; prices: PlanPriceRow[] }

const PlanModePanel: React.FC<PanelProps> = ({ mode, form, prices }) => {
  if (mode === 'price') return <PriceForm {...form} />;
  if (mode === 'end') return <EndForm {...form} />;
  if (mode === 'prices') return <PriceHistory prices={prices} />;
  return null;
};

/** Mensalidade de um sócio: valor vigente e as ações de reajustar, pausar, consultar o histórico e encerrar. */
export const PlanCard: React.FC<{ plan: PlanWithMember; onChanged: () => void }> = ({ plan, onChanged }) => {
  const { key, renew } = useRequestKey();
  const prices = useAsync(() => listPlanPrices(plan.id), [plan.id]);
  const [mode, setMode] = useState<PlanMode | null>(null);
  const { busy, run } = useAction({ message: 'Não foi possível concluir.', event: 'finance_plan_action_failed' });
  const ended = plan.status === 'ended';

  const submit: PlanSubmit = (action, okText) => run(action, () => { notify.success(okText); renew(); setMode(null); prices.reload(); onChanged(); });
  const toggleStatus = async () => {
    const toggle = TOGGLE[plan.status];
    if (!toggle) return;
    await submit(() => updatePlan(plan.id, plan.version, { status: toggle.next }, key), toggle.done);
  };
  const form = { planId: plan.id, busy, submit, onBack: () => setMode(null) };

  return (
    <div className={`rounded-3xl border bg-white p-4 shadow-sm ${ended ? 'border-stone-100 opacity-70' : 'border-stone-100'}`}>
      <PlanHeader plan={plan} />
      <CurrentPrice prices={prices.data} />
      {plan.end_reason && <p className="text-xs text-stone-400">Motivo: {plan.end_reason}</p>}
      {!ended && mode === null && <PlanActions plan={plan} busy={busy} onChoose={setMode} onToggleStatus={toggleStatus} />}
      {ended && <button className={`${btnGhost} mt-3`} onClick={() => setMode(mode === 'prices' ? null : 'prices')}>Histórico de preços</button>}
      <PlanModePanel mode={mode} form={form} prices={prices.data ?? []} />
    </div>
  );
};
