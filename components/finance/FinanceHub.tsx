/**
 * Financeiro do clube (administrador). Reúne dashboard, mensalidades, comprovantes,
 * alunos e Day Card, contas a pagar, recorrências, DRE, fluxo de caixa,
 * contas, categorias e configurações. Cada aba é carregada sob demanda.
 *
 * Quem pode: o administrador (`is_admin()`), garantido no BANCO — esconder o botão
 * não é a proteção; as funções recusam qualquer outro papel.
 */
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import { listAccounts, listCategories, getSettings, receiptQueue } from '../../lib/finance/financeApi';
import { FinanceProvider } from './FinanceContext';
import { ErrorBlock, SectionTabs, Spinner } from './ui';
import { useAsync } from './hooks';
import { useAdminEmbedded } from '../admin/AdminEmbedContext';

const OverviewTab = lazy(() => import('./tabs/OverviewTab'));
const MembersTab = lazy(() => import('./tabs/MembersTab'));
const ReceiptsTab = lazy(() => import('./tabs/ReceiptsTab'));
const StudentsTab = lazy(() => import('./tabs/StudentsTab'));
const BillsTab = lazy(() => import('./tabs/BillsTab'));
const RecurrencesTab = lazy(() => import('./tabs/RecurrencesTab'));
const CashFlowTab = lazy(() => import('./tabs/CashFlowTab'));
const DreTab = lazy(() => import('./tabs/DreTab'));
const AccountsTab = lazy(() => import('./tabs/AccountsTab'));
const CategoriesTab = lazy(() => import('./tabs/CategoriesTab'));
const SettingsTab = lazy(() => import('./tabs/SettingsTab'));

// eslint-disable-next-line react-refresh/only-export-components
export const FINANCE_GROUPS = [
  { id: 'visao', label: 'Visão', tabs: [['overview', 'Painel'], ['dre', 'DRE'], ['cashflow', 'Fluxo de caixa']] },
  { id: 'receber', label: 'Receber', tabs: [['members', 'Mensalidades'], ['receipts', 'Comprovantes'], ['students', 'Alunos e Day Card']] },
  { id: 'pagar', label: 'Pagar', tabs: [['bills', 'Contas a pagar'], ['recurrences', 'Recorrências']] },
  { id: 'cadastros', label: 'Cadastros', tabs: [['accounts', 'Contas'], ['categories', 'Categorias'], ['settings', 'Configurações']] },
] as const;

const ALL = FINANCE_GROUPS.flatMap((g) => g.tabs.map((t) => t[0] as string));
const KEY = 'finance-hub-tab';

const loadTab = (): string => {
  try { const v = localStorage.getItem(KEY); if (v && ALL.includes(v)) return v; } catch { /* storage indisponível */ }
  return 'overview';
};

export const FinanceHub: React.FC = () => {
  const embedded = useAdminEmbedded();
  const [tab, setTab] = useState(loadTab);
  const go = useCallback((id: string) => {
    if (!ALL.includes(id)) return;
    setTab(id);
    try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  }, []);

  const refs = useAsync(async () => {
    const [accounts, categories, settings] = await Promise.all([listAccounts(), listCategories(), getSettings()]);
    return { accounts, categories, settings };
  }, []);
  const pending = useAsync(() => receiptQueue('pending', 100, 0), [tab === 'receipts']);

  useEffect(() => { try { localStorage.setItem(KEY, tab); } catch { /* ignore */ } }, [tab]);

  const group = FINANCE_GROUPS.find((g) => g.tabs.some((t) => t[0] === tab)) ?? FINANCE_GROUPS[0];
  const value = useMemo(() => ({
    accounts: refs.data?.accounts ?? [], categories: refs.data?.categories ?? [], settings: refs.data?.settings ?? null, reload: refs.reload, go,
  }), [refs.data, refs.reload, go]);

  if (refs.error) return <ErrorBlock error={refs.error} onRetry={refs.reload} />;
  if (!refs.data) return <Spinner label="Abrindo o financeiro…" />;

  const pendingCount = pending.data?.length ?? 0;
  const body = (() => {
    switch (tab) {
      case 'members': return <MembersTab />;
      case 'receipts': return <ReceiptsTab onChanged={pending.reload} />;
      case 'students': return <StudentsTab />;
      case 'bills': return <BillsTab />;
      case 'recurrences': return <RecurrencesTab />;
      case 'cashflow': return <CashFlowTab />;
      case 'dre': return <DreTab />;
      case 'accounts': return <AccountsTab />;
      case 'categories': return <CategoriesTab />;
      case 'settings': return <SettingsTab />;
      default: return <OverviewTab />;
    }
  })();

  return (
    <FinanceProvider value={value}>
      <div className="space-y-4">
        {!embedded && (
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-linear-to-br from-emerald-500 to-emerald-600 p-3 text-white shadow-lg shadow-emerald-200"><Landmark size={24} /></div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-stone-800 md:text-2xl">Financeiro do clube</h1>
              <p className="text-xs font-medium text-stone-500">Mensalidades, pagamentos, contas, DRE e caixa</p>
            </div>
          </div>
        )}
        <SectionTabs variant="segmented" label="Áreas do financeiro" value={group.id} onChange={(g) => { if (g !== group.id) go(FINANCE_GROUPS.find((x) => x.id === g)!.tabs[0][0]); }}
          items={FINANCE_GROUPS.map((g) => ({ id: g.id, label: g.label, badge: g.id === 'receber' ? pendingCount : undefined }))} />
        <SectionTabs label={group.label} value={tab} onChange={go}
          items={group.tabs.map((t) => ({ id: t[0], label: t[1], badge: t[0] === 'receipts' ? pendingCount : undefined }))} />
        <Suspense fallback={<Spinner />}>{body}</Suspense>
      </div>
    </FinanceProvider>
  );
};

export default FinanceHub;
