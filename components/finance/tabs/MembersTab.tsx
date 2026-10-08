import React, { useState } from 'react';
import { listPlans } from '../../../lib/finance/financeApi';
import type { ChargeStatementRow } from '../../../lib/finance/types';
import { useAsync } from '../hooks';
import { SectionTabs } from '../ui';
import { ChargeSheet } from './members/ChargeSheet';
import { ChargesView } from './members/ChargesView';
import { CreditsPanel } from './members/CreditsPanel';
import { PlansView } from './members/PlansView';
import { useChargesList } from './members/useChargesList';

const VIEWS = [{ id: 'charges', label: 'Cobranças' }, { id: 'plans', label: 'Sócios e valores' }, { id: 'credits', label: 'Créditos' }];

/** Mensalidades dos sócios: cobranças e seus extratos, o valor de cada sócio e os créditos guardados. */
const MembersTab: React.FC = () => {
  const [view, setView] = useState('charges');
  const [selected, setSelected] = useState<ChargeStatementRow | null>(null);
  const list = useChargesList();
  const plans = useAsync(() => listPlans(), []);

  const reloadAll = () => { plans.reload(); list.charges.reload(); };

  return (
    <div className="space-y-4">
      <SectionTabs label="Mensalidades" value={view} onChange={setView} items={VIEWS} />
      {view === 'charges' && <ChargesView list={list} onOpen={setSelected} onGenerated={plans.reload} />}
      {view === 'plans' && <PlansView plans={plans} onChanged={reloadAll} />}
      {view === 'credits' && <CreditsPanel />}
      {/* Uma folha nova por cobrança: o formulário que ficou aberto na anterior não passa para a próxima. */}
      <ChargeSheet key={selected?.charge_id ?? 'none'} charge={selected} onClose={() => setSelected(null)} onChanged={() => { list.charges.reload(); setSelected(null); }} />
    </div>
  );
};

export default MembersTab;
