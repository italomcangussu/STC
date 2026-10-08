import React from 'react';
import { Camera, FileText } from 'lucide-react';
import type { ChargeStatementRow, MemberPendencyMeta } from '../../../lib/finance/types';
import { monthLabel, type IsoDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { RECEIPT_MAX_BYTES } from '../../../lib/finance/receiptFile';
import type { ReceiptFlag } from '../../../lib/finance/receipts';
import { Field, MoneyInput, Notice, btnGhost, inputCls } from '../ui';
import type { ReceiptDraft } from './useReceiptDraft';

interface Patch { patch: (change: Partial<ReceiptDraft>) => void }

/** Passo 1: quais cobranças o comprovante paga. */
export const ChargePicker: React.FC<{ payable: ChargeStatementRow[]; selected: ChargeStatementRow[]; chosen: string[]; pendencyMeta: Map<string, MemberPendencyMeta>; onToggle: (chargeId: string) => void }> = ({ payable, selected, chosen, pendencyMeta, onToggle }) => {
  const totalToday = selected.reduce((sum, c) => sum + c.total_due_cents, 0);
  return (
    <Field label="1. Quais cobranças você pagou?">
      <div className="space-y-2">
        {payable.length === 0 && <p className="text-sm text-stone-400">Você não tem cobranças em aberto.</p>}
        {payable.map((c) => (
          <label key={c.charge_id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-stone-200 p-3 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-orange-600" checked={chosen.includes(c.charge_id)} onChange={() => onToggle(c.charge_id)} />
            <span className="flex-1">{pendencyMeta.get(c.charge_id)?.description ?? `Mensalidade · ${monthLabel(c.competence_month)}`}</span>
            <span className="font-bold tabular-nums">{formatBRL(c.total_due_cents)}</span>
          </label>
        ))}
        {selected.length > 0 && <p className="text-xs text-stone-500">Total devido hoje: <b>{formatBRL(totalToday)}</b> (o valor muda se você pagou em outra data).</p>}
      </div>
    </Field>
  );
};

/** Passo 2: foto ou PDF. O tipo é conferido pelos primeiros bytes, não pelo nome do arquivo. */
export const FilePicker: React.FC<{ file: ReceiptDraft['file']; error: string | null; onPick: (file: File | null) => void }> = ({ file, error, onPick }) => (
  <Field label="2. Foto ou PDF do comprovante" hint={`Imagem (JPG, PNG, WEBP, HEIC) ou PDF, até ${RECEIPT_MAX_BYTES / 1024 / 1024} MB. O arquivo fica privado: só você e o clube veem.`}>
    <div className="grid grid-cols-2 gap-2">
      <label className={`${btnGhost} cursor-pointer`}><Camera size={16} /> Tirar foto<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onPick(e.target.files?.[0] ?? null)} /></label>
      <label className={`${btnGhost} cursor-pointer`}><FileText size={16} /> Escolher arquivo<input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => onPick(e.target.files?.[0] ?? null)} /></label>
    </div>
    {file && <p className="mt-1 truncate text-xs text-stone-500">{file.name} ({(file.file.size / 1024).toFixed(0)} KB)</p>}
    {error && <p role="alert" className="mt-1 text-xs font-bold text-red-600">{error}</p>}
  </Field>
);

/** O que a leitura automática do comprovante fez: lendo, preencheu ou não conseguiu. */
export const OcrNotice: React.FC<{ ocr: ReceiptDraft['ocr'] }> = ({ ocr }) => {
  if (ocr.status === 'reading') return <Notice title="Lendo o comprovante…">Isso acontece no seu aparelho e leva alguns segundos{ocr.pct > 0 ? ` (${ocr.pct}%)` : ''}.</Notice>;
  if (ocr.status === 'ok') return <Notice tone="warn" title="Preenchemos o que conseguimos ler">A leitura automática pode errar. Confira o valor e a data antes de enviar.</Notice>;
  if (ocr.status === 'unreadable' || ocr.status === 'failed') return <Notice tone="warn" title="Não conseguimos ler o comprovante">Sem problema: preencha o valor e a data à mão. O clube vai conferir o arquivo.</Notice>;
  return null;
};

/** Passo 3: valor, data e os campos opcionais. */
export const PaymentFields: React.FC<{ draft: ReceiptDraft; today: IsoDate } & Patch> = ({ draft, today, patch }) => (
  <>
    <div className="grid grid-cols-2 gap-3">
      <Field label="3. Valor pago"><MoneyInput value={draft.amount} onChange={(amount) => patch({ amount })} aria-label="Valor pago" /></Field>
      <Field label="Data do pagamento"><input type="date" className={inputCls} value={draft.paidOn} max={today} onChange={(e) => patch({ paidOn: e.target.value })} aria-label="Data do pagamento" /></Field>
    </div>
    <Field label="Identificador do Pix/transação (opcional)"><input className={inputCls} value={draft.reference} maxLength={120} onChange={(e) => patch({ reference: e.target.value })} /></Field>
    <Field label="Observação para o clube (opcional)"><textarea className={inputCls} rows={2} maxLength={500} value={draft.note} onChange={(e) => patch({ note: e.target.value })} /></Field>
  </>
);

export const HintsNotice: React.FC<{ flags: ReceiptFlag[] }> = ({ flags }) => {
  if (flags.length === 0) return null;
  return (
    <Notice tone="warn" title="Confira antes de enviar">
      <ul className="list-disc space-y-0.5 pl-4">{flags.map((f, i) => <li key={`${f.code}-${i}`}>{f.message}</li>)}</ul>
      <p className="mt-1 text-[11px] opacity-80">Isto é só uma orientação. Você pode enviar mesmo assim; o clube decide.</p>
    </Notice>
  );
};
