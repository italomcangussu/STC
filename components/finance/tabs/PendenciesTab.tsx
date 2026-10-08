/**
 * Receber › Pendências de sócio: cobranças manuais (Day Card não lançado,
 * consumo, evento, reposição…) com régua de cobrança pelo WhatsApp. A régua
 * (dias, PIX, carência, multa/juros) se configura AQUI, em "Configurar régua";
 * o resumo da aba é lido das configurações salvas, não é texto fixo.
 */
import React, { useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { PENDENCY_STATUS_FILTERS, type PendencyRow } from '../../../lib/finance/pendencies';
import { useFinance } from '../FinanceContext';
import { AdminSearch } from '../../admin/ui';
import { Card, SectionTabs, Sheet, Spinner, btnGhost, btnPrimary } from '../ui';
import PendencyRulesSection from './PendencyRulesSection';
import { NewPendencySheet } from './pendencies/NewPendencySheet';
import { PartialNotice, PendencyRows, Totals } from './pendencies/PendencyList';
import { PendencySheet } from './pendencies/PendencySheet';
import { RulesSummary } from './pendencies/RulesSummary';
import { usePendencies } from './pendencies/usePendencies';

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

const PendenciesTab: React.FC = () => {
  const { settings, reload: reloadSettings } = useFinance();
  const sheets = useRulesSheet();
  const pendencies = usePendencies();
  const [selected, setSelected] = useState<PendencyRow | null>(null);

  return (
    <div className="space-y-4">
      <Card title="Pendências de sócios" subtitle="Cobranças manuais vinculadas ao sócio: Day Card não lançado, consumo, evento, reposição ou outro ajuste."
        right={<div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button className={`${btnGhost} flex-1 whitespace-nowrap sm:flex-none`} onClick={() => sheets.openRules()}><Settings2 size={16} /> Configurar régua</button>
          <button className={`${btnPrimary} flex-1 whitespace-nowrap sm:flex-none`} onClick={() => sheets.setNewOpen(true)}><Plus size={16} /> Nova pendência</button>
        </div>}>
        <Totals totals={pendencies.totals} />
        <div className="mt-4 space-y-3">
          <AdminSearch value={pendencies.search} onChange={pendencies.setSearch} placeholder="Buscar sócio, descrição ou convidado…" label="Buscar pendência" />
          <SectionTabs label="Situação" value={pendencies.status} onChange={pendencies.setStatus} items={PENDENCY_STATUS_FILTERS.map(([id, label]) => ({ id, label }))} />
          <PartialNotice pendencies={pendencies} />
          <PendencyRows pendencies={pendencies} onOpen={setSelected} />
        </div>
      </Card>
      <RulesSummary settings={settings} onConfigure={() => sheets.openRules()} />
      <NewPendencySheet open={sheets.newOpen} onClose={() => sheets.setNewOpen(false)} onDone={pendencies.reload} onConfigure={() => sheets.openRules(true)} />
      <Sheet open={sheets.rulesOpen} onClose={sheets.closeRules} wide closeOnBackdrop={false} title="Régua de cobrança das pendências" subtitle="Vale para todas as pendências de sócio. Mensalidades têm encargos próprios, em Configurações.">
        {settings ? <PendencyRulesSection bare s={settings} onSaved={() => { reloadSettings(); sheets.closeRules(); }} /> : <Spinner />}
      </Sheet>
      <PendencySheet row={selected} onClose={() => setSelected(null)} onChanged={() => { pendencies.reload(); setSelected(null); }} />
    </div>
  );
};

export default PendenciesTab;
