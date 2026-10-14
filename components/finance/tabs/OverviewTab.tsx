import React from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { receiptQueue } from '../../../lib/finance/financeApi';
import { useAsync } from '../hooks';
import { useFinance } from '../FinanceContext';
import type { FinAccount, FinSettings } from '../../../lib/finance/types';
import { ClubOverview } from '../ClubOverview';
import { Notice, btnGhost } from '../ui';


type Alert = { text: string; tab: string; tone: 'warn' | 'bad' };

/** O que precisa da mão do administrador antes de os números valerem. */
function setupAlerts(settings: FinSettings | null, accounts: FinAccount[], pending: number): Alert[] {
  const alerts: Alert[] = [];
  if (settings && !settings.late_fee_confirmed_at) alerts.push({ text: 'Os encargos de atraso ainda não foram configurados: mensalidades vencidas não recebem multa nem juros.', tab: 'settings', tone: 'warn' });
  if (accounts.length === 0) alerts.push({ text: 'Cadastre ao menos uma conta (Caixa, Banco…) para registrar recebimentos e pagamentos.', tab: 'accounts', tone: 'bad' });
  else if (!accounts.some((a) => a.is_default_receipts)) alerts.push({ text: 'Defina a conta padrão de recebimentos: sem ela, os pagamentos de Card Mensal/Day Card aparecem como "sem conta" no caixa.', tab: 'accounts', tone: 'warn' });
  if (pending > 0) alerts.push({ text: `${pending} comprovante(s) aguardando análise.`, tab: 'receipts', tone: 'warn' });
  return alerts;
}

const Alerts: React.FC<{ alerts: Alert[]; go: (tab: string) => void }> = ({ alerts, go }) => (
  <>
    {alerts.map((a) => (
      <div key={a.text} className="flex items-start gap-2">
        <div className="flex-1"><Notice tone={a.tone}><span className="flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{a.text}</span></Notice></div>
        <button className={btnGhost} onClick={() => go(a.tab)} aria-label="Resolver"><ArrowRight size={16} /></button>
      </div>
    ))}
  </>
);

/**
 * Painel: o que pede ação e, abaixo, a visão financeira do clube (a mesma que o sócio vê no Dashboard).
 * Saldo por conta mora em Cadastros › Contas e entradas/saídas no Fluxo de caixa: aqui não se repetem.
 */
const OverviewTab: React.FC = () => {
  const { settings, accounts, go } = useFinance();
  const pending = useAsync(async () => (await receiptQueue('pending', 100, 0)).length, []);

  return (
    <div className="space-y-5">
      <Alerts alerts={setupAlerts(settings, accounts, pending.data ?? 0)} go={go} />
      <ClubOverview onOpenAccounts={() => go('accounts')} />
    </div>
  );
};

export default OverviewTab;
