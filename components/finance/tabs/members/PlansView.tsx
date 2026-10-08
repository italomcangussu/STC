import React, { useState } from 'react';
import { CreditCard, Plus } from 'lucide-react';
import type { PlanWithMember } from '../../../../lib/finance/financeApi';
import type { AsyncState } from '../../hooks';
import { Empty, ErrorBlock, Spinner, btnPrimary } from '../../ui';
import { NewPlanSheet } from './NewPlanSheet';
import { PlanCard } from './PlanCard';

const PlanGrid: React.FC<{ plans: AsyncState<PlanWithMember[]>; onChanged: () => void }> = ({ plans, onChanged }) => {
  if (plans.error) return <ErrorBlock error={plans.error} onRetry={plans.reload} />;
  if (plans.loading) return <Spinner />;
  const list = plans.data ?? [];
  if (list.length === 0) return <Empty icon={<CreditCard size={32} />} title="Nenhuma mensalidade cadastrada" hint="Defina o valor de cada sócio. Não há valor padrão para todos." />;
  return <div className="grid gap-3 md:grid-cols-2">{list.map((p) => <PlanCard key={p.id} plan={p} onChanged={onChanged} />)}</div>;
};

/** Aba "Sócios e valores": a mensalidade individual de cada sócio e o botão para criar uma nova. */
export const PlansView: React.FC<{ plans: AsyncState<PlanWithMember[]>; onChanged: () => void }> = ({ plans, onChanged }) => {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-stone-600">Mensalidade individual de cada sócio</p>
        <button className={btnPrimary} onClick={() => setCreating(true)}><Plus size={16} /> Nova</button>
      </div>
      <PlanGrid plans={plans} onChanged={onChanged} />
      <NewPlanSheet open={creating} onClose={() => setCreating(false)} onDone={onChanged} />
    </>
  );
};
