/**
 * Corrigir na própria lista do Fluxo de Caixa.
 * Não apagar lançamentos contabilizados fisicamente: estorno + cancelamento
 * auditáveis; movimentos automáticos só podem ser corrigidos na sua origem.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Pencil, Undo2 } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { useConfirm } from '../../../hooks/useConfirm';
import { entryForCashMovement, reversePayment } from '../../../lib/finance/financeApi';
import { notifyFinanceError } from '../../../lib/finance/errors';
import { formatBRL } from '../../../lib/finance/money';
import type { FinEntry, MovementRow } from '../../../lib/finance/types';
import { brDate } from '../../../lib/finance/dates';
import { useRequestKey } from '../hooks';
import { useFinance } from '../FinanceContext';
import { EntrySheet } from './entries/EntrySheets';
import { Field, Notice, Sheet, Spinner, btnDanger, btnGhost, btnPrimary, inputCls } from '../ui';

type Props = { movement: MovementRow | null; onClose: () => void; onChanged: () => void };
type CorrectionKind = 'entry' | 'member' | 'student' | 'daycard' | 'opening' | 'history';

export function cashCorrectionKind(m: Pick<MovementRow,'source_type'>): CorrectionKind {
  switch (m.source_type) {
    case 'entry_payment': return 'entry';
    case 'member_payment': return 'member';
    case 'student_payment': return 'student';
    case 'day_card': return 'daycard';
    case 'opening': return 'opening';
    default: return 'history';
  }
}

export const CashMovementActions: React.FC<Props> = ({movement,onClose,onChanged}) => {
  const {go}=useFinance();
  const confirm=useConfirm();
  const {key,renew}=useRequestKey();
  const [entry,setEntry]=useState<FinEntry | null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string | null>(null);
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const kind=movement?cashCorrectionKind(movement):'history';

  useEffect(()=>{
    setEntry(null);
    setError(null);
    setReason('');
    renew();
    if(!movement||kind!=='entry')return;
    let active=true;
    setLoading(true);
    entryForCashMovement(movement.source_id).then(e=>{
      if(active)setEntry(e);
    }).catch(e=>{
      if(active)setError(e instanceof Error?e.message:'Não foi possível localizar a origem do pagamento.');
    }).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
    // O ID da origem é a chave do carregamento; não buscar novamente a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[movement?.source_id,kind]);

  if(!movement)return null;
  const close=()=>{if(!busy)onClose();};
  const navigate=(tab:string)=>{onClose();go(tab);};

  if(kind==='entry'){
    if(entry)return <EntrySheet key={entry.id} entry={entry} onClose={close} onChanged={()=>{
      onChanged();onClose();
    }}/>;
    return <Sheet open onClose={close} title="Corrigir lançamento">
      {loading?<Spinner label="Abrindo lançamento e seus pagamentos…" />:
        <Notice tone="bad">{error||'Não foi possível localizar o documento. Nenhum registro foi modificado.'}</Notice>}
      <button className={btnGhost} onClick={close}>Fechar</button>
    </Sheet>;
  }

  const removeMemberPayment=async()=>{
    if(!movement||reason.trim().length<8)return;
    const ok=await confirm({
      tone:'danger',
      title:'Estornar pagamento de mensalidade?',
      description:'A baixa será desfeita, a cobrança voltará a ficar em aberto conforme o saldo efetivo e o histórico manterá o pagamento e seu estorno. Não há transferência bancária automática.',
      confirmLabel:'Confirmar estorno',
    });
    if(!ok)return;
    setBusy(true);
    try{
      await reversePayment(movement.source_id,reason.trim(),key);
      notify.success('Baixa anulada e estorno registrado no fluxo de caixa.');
      renew();onChanged();onClose();
    }catch(e){notifyFinanceError(e,'Não foi possível estornar a baixa.','finance_cash_payment_reverse_failed');}
    finally{setBusy(false);}
  };

  const destination=kind==='opening'?'accounts':kind==='member'?'members':'students';
  return <Sheet open onClose={close} title="Corrigir movimento" subtitle={brDate(movement.occurred_on)}>
    <div className="space-y-3">
      <div className="rounded-2xl bg-stone-50 p-3">
        <p className="text-sm font-black text-stone-800">{movement.description}</p>
        <p className="mt-1 text-xs text-stone-500">{movement.account_name} · {movement.source_type}</p>
        <p className="mt-2 text-lg font-black tabular-nums">{formatBRL(movement.amount_cents)}</p>
      </div>
      {kind==='member' && <>
        <Notice tone="warn" title="Pagamento de sócio">
          É possível anular esta baixa, mas não apagar o comprovante ou reescrever o registro original. O estorno irá refletir no saldo hoje. Se for apenas um valor incorreto, faça uma nova baixa correta depois.
        </Notice>
        <Field label="Motivo do estorno (obrigatório)">
          <textarea className={inputCls} rows={3} maxLength={500} value={reason}
            onChange={e=>setReason(e.target.value)}
            placeholder="Ex.: comprovante era uma doação para a campanha, não mensalidade" />
        </Field>
        <button className={btnDanger} disabled={busy||reason.trim().length<8} onClick={removeMemberPayment}>
          <Undo2 size={16}/> Anular baixa incorreta
        </button>
      </>}
      {kind==='student' && <Notice tone="warn" title="Recebimento de aluno">
        Esse valor vem do Card Mensal ou da aula avulsa registrados no cadastro do aluno. Corrija ou cancele o pagamento no Painel de alunos; não crie uma exclusão duplicada no caixa.
      </Notice>}
      {kind==='daycard' && <Notice tone="warn" title="Day Card derivado">
        Este movimento é calculado pela reserva e pela configuração de cobrança. Para corrigir um Day Card que não foi recebido, revise a isenção/cobrança no Painel de alunos. Ele não é uma baixa financeira independente.
      </Notice>}
      {kind==='opening' && <Notice tone="warn" title="Saldo inicial">
        Este valor pertence ao saldo de abertura da conta, não a uma receita. Corrigir o saldo inicial altera toda a evolução histórica do saldo. Faça isso em Contas, conferindo com o extrato.
      </Notice>}
      {kind==='history' && <Notice tone="info" title="Movimento de auditoria">
        Esta linha é um estorno, compensação ou evento histórico. Não é permitido apagá-la para evitar desbalanceamento; confira o lançamento original e sua contrapartida.
      </Notice>}
      <div className="flex flex-wrap gap-2">
        {kind!=='history'&&<button className={btnPrimary} disabled={busy} onClick={()=>navigate(destination)}>
          {kind==='opening'?<Pencil size={16}/>:<ArrowUpRight size={16}/>}
          Abrir {kind==='opening'?'conta':kind==='member'?'mensalidades':'origem'}
        </button>}
        <button className={btnGhost} onClick={close} disabled={busy}>Fechar</button>
      </div>
      <p className="flex items-center gap-1 text-[11px] text-stone-500"><AlertTriangle size={13}/> Correções financeiras mantêm rastreabilidade e não executam Pix automaticamente.</p>
    </div>
  </Sheet>;
};
