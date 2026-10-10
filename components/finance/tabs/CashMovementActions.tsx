/**
 * Exclusão administrativa completa no Fluxo de Caixa.
 * UI confirma e explica o impacto; o servidor mantém a integridade dos
 * pagamentos, créditos, reservas e do histórico de auditoria.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Pencil, Trash2 } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { useConfirm } from '../../../hooks/useConfirm';
import { entryForCashMovement, removeCashMovement } from '../../../lib/finance/financeApi';
import { notifyFinanceError } from '../../../lib/finance/errors';
import { formatBRL } from '../../../lib/finance/money';
import type { FinEntry, MovementRow } from '../../../lib/finance/types';
import { canRemoveCashMovement, cashCorrectionKind } from '../../../lib/finance/cashCorrection';
import { brDate } from '../../../lib/finance/dates';
import { useRequestKey } from '../hooks';
import { useFinance } from '../FinanceContext';
import { EntrySheet } from './entries/EntrySheets';
import { Field, Notice, Sheet, btnDanger, btnGhost, btnPrimary, inputCls } from '../ui';

type Props={movement:MovementRow|null;onClose:()=>void;onChanged:()=>void};

const impacts:Record<string,string>={
  entry:'O lançamento manual, seus pagamentos e eventuais estornos deixam de compor o caixa. Se já estava pago, a baixa é desfeita e o documento é cancelado.',
  member:'A baixa da mensalidade é desfeita, e sua entrada, crédito excedente e estorno deixam de compor o caixa. A cobrança volta ao status correspondente. Créditos já utilizados impedem a exclusão.',
  history:'A entrada original e este estorno são retirados juntos da listagem e dos saldos. Não será gerado outro estorno.',
  student:'O pagamento do aluno é cancelado na origem. Isso poderá afetar a validade do Card Mensal ou da aula avulsa.',
  daycard:'A cobrança de Day Card fica isenta na reserva e sai do caixa e do DRE. A reserva não será apagada.',
  opening:'O saldo inicial da conta será zerado. Isso recalcula todos os saldos históricos da conta.',
};

export const CashMovementActions:React.FC<Props>=({movement,onClose,onChanged})=>{
  const {go}=useFinance();
  const confirm=useConfirm();
  const {key}=useRequestKey();
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [entry,setEntry]=useState<FinEntry|null>(null);
  const [loadingEntry,setLoadingEntry]=useState(false);
  const [editing,setEditing]=useState(false);
  const kind=movement?cashCorrectionKind(movement):'history';

  useEffect(()=>{
    setReason('');setEditing(false);setEntry(null);
  },[movement?.source_id,movement?.source_type]);

  if(!movement)return null;
  const close=()=>{if(!busy)onClose();};
  const navigate=(tab:string)=>{onClose();go(tab);};
  const openEdit=async()=>{
    setLoadingEntry(true);
    try{
      const doc=await entryForCashMovement(movement.source_id);
      setEntry(doc);setEditing(true);
    }catch(e){
      notifyFinanceError(e,'Não foi possível abrir o lançamento para edição.','finance_cash_edit_failed');
    }finally{setLoadingEntry(false);}
  };
  const remove=async()=>{
    if(reason.trim().length<8||busy||!canRemoveCashMovement(movement.source_type))return;
    const ok=await confirm({
      tone:'danger',
      title:'Excluir este lançamento por completo?',
      description:'A movimentação incorreta desaparecerá do fluxo e dos saldos calculados. Entradas e estornos vinculados sairão juntos. O histórico de auditoria será preservado e não haverá transação bancária.',
      confirmLabel:'Excluir lançamento',
    });
    if(!ok)return;
    setBusy(true);
    try{
      await removeCashMovement(movement.source_type,movement.source_id,reason.trim(),key);
      notify.success('Lançamento incorreto excluído do caixa e dos saldos.');
      onChanged();onClose();
    }catch(e){
      notifyFinanceError(e,'Não foi possível excluir o lançamento.','finance_cash_remove_failed');
    }finally{setBusy(false);}
  };

  if(editing&&entry)return <EntrySheet key={entry.id} entry={entry}
    onClose={()=>{setEditing(false);setEntry(null);}}
    onChanged={()=>{onChanged();onClose();}}/>;

  const destination=kind==='opening'?'accounts':kind==='member'?'members':'students';
  return <Sheet open onClose={close} title="Corrigir ou excluir lançamento" subtitle={brDate(movement.occurred_on)} closeOnBackdrop={false}>
    <div className="space-y-4">
      <div className="rounded-2xl bg-stone-50 p-3">
        <p className="text-sm font-black text-stone-800">{movement.description}</p>
        <p className="mt-1 text-xs text-stone-500">{movement.account_name} · {brDate(movement.occurred_on)}</p>
        <p className="mt-2 text-lg font-black tabular-nums">{formatBRL(movement.amount_cents)}</p>
      </div>

      <Notice tone="warn" title="Excluir lançamento incorreto">
        {impacts[kind]}
        <p className="mt-2 font-bold">Use esta opção somente quando a movimentação não deveria existir na contabilidade. Se o dinheiro realmente entrou ou saiu da conta bancária, corrija a classificação em vez de excluí-lo.</p>
      </Notice>

      {!canRemoveCashMovement(movement.source_type) && <Notice tone="bad">Este tipo de movimentação só pode ser corrigido na origem, para preservar os vínculos financeiros.</Notice>}

      <Field label="Motivo da exclusão (obrigatório)">
        <textarea className={inputCls} rows={3} maxLength={500} value={reason}
          onChange={ev=>setReason(ev.target.value)}
          placeholder="Ex.: lançamento duplicado; estorno contábil indevido; pagamento não realizado" />
      </Field>

      <button className={btnDanger+' w-full'} disabled={busy||reason.trim().length<8||!canRemoveCashMovement(movement.source_type)}
        onClick={remove}><Trash2 size={16}/> Excluir lançamento do fluxo de caixa</button>

      <div className="flex flex-wrap gap-2">
        {kind==='entry'&&<button className={btnPrimary} disabled={busy||loadingEntry} onClick={openEdit}>
          {loadingEntry?'Abrindo…':<><Pencil size={16}/> Editar dados</>}
        </button>}
        {kind!=='entry'&&kind!=='history'&&<button className={btnGhost} disabled={busy} onClick={()=>navigate(destination)}>
          <ArrowUpRight size={16}/> Abrir {kind==='opening'?'conta':kind==='member'?'mensalidades':'origem'}
        </button>}
        <button className={btnGhost} disabled={busy} onClick={close}>Voltar</button>
      </div>
      <p className="flex items-start gap-1 text-[11px] text-stone-500"><AlertTriangle size={14} className="shrink-0"/> A exclusão não executa Pix, reembolso bancário ou apaga comprovantes e registros de auditoria.</p>
    </div>
  </Sheet>;
};
