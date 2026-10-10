/**
 * Receber › Cobranças de sócios: mensalidades e pendências numa lista só. No banco as duas são a
 * mesma coisa (uma cobrança do sócio); a diferença é só de origem, então vira o filtro "Tipo",
 * não duas abas com a mesma busca, os mesmos totais e a mesma lista.
 *
 *  - Mensalidade nasce do valor de cada sócio (Cadastros › Mensalidades dos sócios) em "Gerar mensalidades".
 *  - Pendência é lançada à mão ("Nova pendência") e é cobrada pela régua do WhatsApp, configurada aqui.
 *  - Créditos de sócios (pagamento a mais) aparecem como aviso só quando existem.
 */
import React, { useState } from 'react';
import { listCredits } from '../../../lib/finance/financeApi';
import type { ChargeTypeFilter, MemberChargeRow } from '../../../lib/finance/memberCharges';
import type { PendencyRow } from '../../../lib/finance/pendencies';
import { useAsync } from '../hooks';
import { useFinance } from '../FinanceContext';
import { Sheet, Spinner } from '../ui';
import PendencyRulesSection from './PendencyRulesSection';
import { ChargeActions } from './members/ChargeActions';
import { ChargeSheet } from './members/ChargeSheet';
import { ChargesView } from './members/ChargesView';
import { CreditsPanel } from './members/CreditsPanel';
import { useChargesList } from './members/useChargesList';
import { NewPendencySheet } from './pendencies/NewPendencySheet';
import { PendencySheet } from './pendencies/PendencySheet';
import { RulesSummary } from './pendencies/RulesSummary';

/** A folha da régua pode ser aberta pela "Nova pendência" (aviso de PIX): ao fechá-la, volta para onde estava. */
function useRulesSheet() {
  const [newOpen, setNewOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [resumeNew, setResumeNew] = useState(false);
  const openRules = (fromNew = false) => {
    if (fromNew) { setNewOpen(false); setResumeNew(true); }
    setRulesOpen(true);
  };
  const closeRules = () => {
    setRulesOpen(false);
    if (resumeNew) { setResumeNew(false); setNewOpen(true); }
  };
  return { newOpen, setNewOpen, rulesOpen, openRules, closeRules };
}

const isPendency = (row: MemberChargeRow | null): row is PendencyRow => !!row?.meta;

const MembersTab: React.FC<{ initialType?: ChargeTypeFilter }> = ({ initialType = '' }) => {
  const { settings, reload: reloadSettings } = useFinance();
  const list = useChargesList(initialType);
  const credits = useAsync(() => listCredits(), []);
  const sheets = useRulesSheet();
  const [selected, setSelected] = useState<MemberChargeRow | null>(null);
  const changed = () => { list.reload(); setSelected(null); };

  return (
    <div className="space-y-4">
      <ChargesView list={list} onOpen={setSelected}
        actions={<ChargeActions onGenerated={list.reload} onNewPendency={() => sheets.setNewOpen(true)} onRules={() => sheets.openRules()} />} />
      <CreditsPanel credits={credits} />
      {list.filters.type === 'member_pendency' && <RulesSummary settings={settings} onConfigure={() => sheets.openRules()} />}

      <NewPendencySheet open={sheets.newOpen} onClose={() => sheets.setNewOpen(false)} onDone={list.reload} onConfigure={() => sheets.openRules(true)} />
      <Sheet open={sheets.rulesOpen} onClose={sheets.closeRules} wide closeOnBackdrop={false} title="Régua de cobrança das pendências" subtitle="Vale para todas as pendências de sócio. Mensalidades têm encargos próprios, em Configurações.">
        {settings ? <PendencyRulesSection bare s={settings} onSaved={() => { reloadSettings(); sheets.closeRules(); }} /> : <Spinner />}
      </Sheet>
      {/* Uma folha nova por cobrança: o formulário que ficou aberto na anterior não passa para a próxima. */}
      {isPendency(selected)
        ? <PendencySheet key={selected.charge_id} row={selected} onClose={() => setSelected(null)} onChanged={changed} />
        : <ChargeSheet key={selected?.charge_id ?? 'none'} charge={selected} onClose={() => setSelected(null)} onChanged={changed} />}
    </div>
  );
};

export default MembersTab;
