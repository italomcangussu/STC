import React from 'react';
import { CalendarPlus, Plus, Settings2 } from 'lucide-react';
import { notify } from '../../../../lib/notifications';
import { generateCharges } from '../../../../lib/finance/financeApi';
import { useAction, useRequestKey } from '../../hooks';
import { btnGhost, btnPrimary } from '../../ui';

const GenerateButton: React.FC<{ onGenerated: () => void }> = ({ onGenerated }) => {
  const { key, renew } = useRequestKey();
  const { busy, run } = useAction({ message: 'Não foi possível gerar as cobranças.', event: 'finance_generate_failed' });
  const generate = () => run(() => generateCharges(null, key), (result) => {
    notify.success(result.created ? `${result.created} mensalidade(s) gerada(s).` : 'Nada novo a gerar — tudo já está gerado.', {
      description: result.missing_price ? `${result.missing_price} competência(s) sem preço definido não foram geradas.` : undefined,
    });
    renew(); onGenerated();
  });
  return <button className={`${btnGhost} px-3`} disabled={busy} onClick={generate}><CalendarPlus size={16} /> Gerar mensalidades</button>;
};

/**
 * As ações da lista de cobranças: a primária (nova pendência) ocupa a linha; as de rotina (gerar,
 * régua) dividem a linha de baixo no celular, para não empurrar a lista para fora da tela.
 */
export const ChargeActions: React.FC<{ onGenerated: () => void; onNewPendency: () => void; onRules: () => void }> = ({ onGenerated, onNewPendency, onRules }) => (
  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-row-reverse">
    <button className={`${btnPrimary} col-span-2`} onClick={onNewPendency}><Plus size={16} /> Nova pendência</button>
    <GenerateButton onGenerated={onGenerated} />
    <button className={`${btnGhost} px-3`} onClick={onRules}><Settings2 size={16} /> Configurar régua</button>
  </div>
);
