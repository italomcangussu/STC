import React, { useState } from 'react';
import { Check, Copy, Receipt, Wallet } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import type { ReceiptRow } from '../../../lib/finance/types';
import { headerSentence, receiptSummaryLine } from '../../../lib/finance/memberStatement';
import { brDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { receiptStatusInfo } from '../../../lib/finance/receipts';
import { Badge, Card, Spinner, btnGhost } from '../ui';

/** O topo da tela: quanto o sócio deve hoje e o atalho para enviar o comprovante. */
export const StatementHeader: React.FC<{ overdueCount: number; owedCents: number; canSend: boolean; pickedCount: number; onSend: () => void }> = ({ overdueCount, owedCents, canSend, pickedCount, onSend }) => (
  <header className="rounded-3xl bg-linear-to-br from-saibro-600 to-orange-500 p-5 text-white shadow-lg shadow-saibro-200/50">
    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-saibro-100"><Wallet size={14} /> Meu financeiro</div>
    <p className="mt-2 text-sm text-saibro-100">{headerSentence(overdueCount, owedCents)}</p>
    <p className="text-4xl font-black tabular-nums">{formatBRL(owedCents)}</p>
    <p className="mt-1 text-xs text-saibro-100">Total atualizado de hoje, com encargos de atraso quando houver.</p>
    <button className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-saibro-700 shadow-sm active:scale-95 disabled:opacity-60" disabled={!canSend} onClick={onSend}>
      <Receipt size={16} /> Enviar comprovante{pickedCount ? ` (${pickedCount})` : ''}
    </button>
  </header>
);

const COPIED_FEEDBACK_MS = 1600;

/** Copia a chave PIX; se o aparelho não deixar, mostra a chave para o sócio copiar à mão. */
const CopyPixButton: React.FC<{ pix: string }> = ({ pix }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pix);
      setCopied(true);
      notify.success('Chave PIX copiada.');
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch { notify.info(`PIX: ${pix}`); }
  };
  return <button className={btnGhost} onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar PIX'}</button>;
};

/** Pendências lançadas pelo clube: saldo, chave PIX e como enviar um único comprovante. */
export const PendenciesCard: React.FC<{ cents: number; pixKey: string | null | undefined }> = ({ cents, pixKey }) => (
  <Card title="Pendências financeiras" subtitle="Pendências lançadas pelo clube ficam aqui até a quitação.">
    <div className="flex items-end justify-between gap-3 rounded-2xl bg-stone-50 p-3">
      <div><p className="text-[10px] font-black uppercase tracking-wide text-stone-400">Saldo das pendências</p><p className="text-2xl font-black text-stone-900">{formatBRL(cents)}</p></div>
      {pixKey && <CopyPixButton pix={pixKey} />}
    </div>
    {pixKey && <p className="mt-2 break-all text-xs text-stone-500">PIX do clube: <b className="text-stone-700">{pixKey}</b></p>}
    <p className="mt-2 text-xs text-stone-500">Você pode selecionar uma ou mais pendências abaixo e enviar um único comprovante. Pagamento parcial mantém o saldo; valor excedente vira crédito.</p>
  </Card>
);

export const RulesCard: React.FC<{ rules: { due: string; fees: string } }> = ({ rules }) => (
  <Card title="Como funciona" subtitle="Regras do clube para a sua mensalidade">
    <ul className="space-y-1 text-xs leading-relaxed text-stone-600"><li>{rules.due}</li><li>{rules.fees}</li></ul>
  </Card>
);

/** O comprovante como a tela do sócio o recebe: com as cobranças que ele pagava. */
export type MyReceipt = ReceiptRow & { charge_ids: string[] };

const RECEIPT_TONE = { success: 'good', danger: 'bad', muted: 'muted' } as const;

const ReceiptItem: React.FC<{ receipt: MyReceipt; onResend: (receipt: MyReceipt) => void }> = ({ receipt: r, onResend }) => {
  const info = receiptStatusInfo(r.status, { decisionReason: r.decision_reason, reviewedOn: r.reviewed_at ? brDate(r.reviewed_at.slice(0, 10)) : null });
  const canResend = r.status === 'rejected' || r.status === 'submitted';
  return (
    <div className="rounded-2xl border border-stone-100 bg-stone-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-stone-700">{receiptSummaryLine(r)}</p>
        <Badge tone={RECEIPT_TONE[info.tone as keyof typeof RECEIPT_TONE] ?? 'info'}>{info.label}</Badge>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-stone-500">{info.nextStep}</p>
      {r.possible_duplicate && <p className="mt-1 text-[11px] text-amber-700">Este arquivo já tinha sido enviado antes.</p>}
      {canResend && <button className={`${btnGhost} mt-2`} onClick={() => onResend(r)}>Enviar novo comprovante</button>}
    </div>
  );
};

/** Comprovantes que o sócio já enviou, com o resultado da análise do clube. */
export const ReceiptsCard: React.FC<{ receipts: MyReceipt[] | null; loading: boolean; onResend: (receipt: MyReceipt) => void }> = ({ receipts, loading, onResend }) => {
  const list = receipts ?? [];
  return (
    <Card title="Meus comprovantes" subtitle="Acompanhe a análise do clube">
      {loading ? <Spinner /> : list.length === 0 ? <p className="text-sm text-stone-400">Você ainda não enviou comprovantes.</p> : (
        <div className="space-y-2">{list.map((r) => <ReceiptItem key={r.id} receipt={r} onResend={onResend} />)}</div>
      )}
    </Card>
  );
};

