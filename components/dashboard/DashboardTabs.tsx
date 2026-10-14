import React, { useState } from 'react';
import { Dashboard } from '../Dashboard';
import { ClubFinanceDashboard } from '../finance/ClubFinanceDashboard';
import { SectionTabs } from '../finance/ui';

type DashboardTab = 'finance' | 'club';

const TABS: { id: DashboardTab; label: string }[] = [
  { id: 'finance', label: 'Financeiro do clube' },
  { id: 'club', label: 'Atividade do clube' },
];

/** Dashboard do sócio: abre no financeiro do clube (só leitura); a outra aba é o Dashboard de uso de sempre. */
export const DashboardTabs: React.FC = () => {
  const [tab, setTab] = useState<DashboardTab>('finance');
  return (
    <div className="space-y-4">
      <SectionTabs variant="segmented" label="Dashboard" items={TABS} value={tab} onChange={(id) => setTab(id as DashboardTab)} />
      {tab === 'finance' ? <ClubFinanceDashboard /> : <Dashboard />}
    </div>
  );
};
