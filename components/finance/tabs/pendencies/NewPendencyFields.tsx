import React from 'react';
import { Settings2 } from 'lucide-react';
import type { FinAccount, FinSettings, MemberPendencyKind } from '../../../../lib/finance/types';
import { PENDENCY_KINDS, type PendencyDraft } from '../../../../lib/finance/pendencies';
import { AccountSelect, MethodSelect } from '../../fields';
import { Field, MoneyInput, Notice, btnGhost, inputCls } from '../../ui';

export type Patch = (change: Partial<PendencyDraft>) => void;

interface FieldsProps { draft: PendencyDraft; patch: Patch }

export const MainFields: React.FC<FieldsProps & { members: Array<{ id: string; name: string }>; onKindChange: (kind: MemberPendencyKind) => void }> = ({ draft, patch, members, onKindChange }) => (
  <>
    <Field label="Sócio">
      <select className={inputCls} value={draft.profile} onChange={(e) => patch({ profile: e.target.value })}>
        <option value="">Escolha…</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </Field>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Motivo">
        <select className={inputCls} value={draft.kind} onChange={(e) => onKindChange(e.target.value as MemberPendencyKind)}>
          {PENDENCY_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </Field>
      <Field label="Valor"><MoneyInput value={draft.amount} onChange={(amount) => patch({ amount })} aria-label="Valor da pendência" /></Field>
    </div>
    <Field label="Descrição" hint="Explique de forma que o sócio entenda exatamente o que está sendo cobrado.">
      <textarea className={inputCls} rows={3} maxLength={300} value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Ex.: Day Card do convidado que esteve no clube em 05/10" />
    </Field>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Competência"><input type="month" className={inputCls} value={draft.competence.slice(0, 7)} onChange={(e) => patch({ competence: `${e.target.value}-01` })} /></Field>
      <Field label="Vencimento"><input type="date" className={inputCls} value={draft.due} onChange={(e) => patch({ due: e.target.value })} /></Field>
    </div>
  </>
);

/** Convidado e data da visita: só no Day Card, e opcionais. */
export const DayCardFields: React.FC<FieldsProps> = ({ draft, patch }) => {
  if (draft.kind !== 'day_card') return null;
  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
      <p className="mb-2 text-xs font-black uppercase tracking-wide text-blue-700">Detalhes do Day Card — opcionais</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Convidado"><input className={inputCls} value={draft.guestName} maxLength={120} onChange={(e) => patch({ guestName: e.target.value })} /></Field>
        <Field label="Data da visita"><input type="date" className={inputCls} value={draft.guestDate} onChange={(e) => patch({ guestDate: e.target.value })} /></Field>
      </div>
    </div>
  );
};

const CheckOption: React.FC<{ title: string; hint: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; className: string }> = ({ title, hint, checked, disabled, onChange, className }) => (
  <label className={`flex items-start gap-3 rounded-2xl border p-3 ${className}`}>
    <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span><b className="block text-sm">{title}</b><span className="text-xs text-stone-500">{hint}</span></span>
  </label>
);

const PaidFields: React.FC<FieldsProps & { accounts: FinAccount[]; today: string }> = ({ draft, patch, accounts, today }) => (
  <div className="grid grid-cols-1 gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3 sm:grid-cols-3">
    <Field label="Data do pagamento"><input type="date" max={today} className={inputCls} value={draft.paidOn} onChange={(e) => patch({ paidOn: e.target.value })} /></Field>
    <Field label="Forma"><MethodSelect value={draft.method} onChange={(method) => patch({ method })} /></Field>
    <Field label="Conta"><AccountSelect accounts={accounts} value={draft.account} onChange={(account) => patch({ account })} placeholder="Escolha…" /></Field>
  </div>
);

/** Como a pendência nasce: com cobrança automática, já paga ou já enviada ao sócio. */
export const CollectionFields: React.FC<FieldsProps & { accounts: FinAccount[]; today: string }> = ({ draft, patch, accounts, today }) => (
  <>
    <CheckOption className="border-stone-200" title="Cobrança automática habilitada" hint="A régua para automaticamente quando o saldo for quitado." checked={draft.collection} onChange={(collection) => patch({ collection })} />
    <CheckOption className="border-stone-200" title="Já foi pago" hint="Registra a entrada agora e não envia cobrança." checked={draft.alreadyPaid}
      onChange={(alreadyPaid) => patch(alreadyPaid ? { alreadyPaid, sendNow: false } : { alreadyPaid })} />
    {draft.alreadyPaid
      ? <PaidFields draft={draft} patch={patch} accounts={accounts} today={today} />
      : <CheckOption className="border-saibro-200 bg-saibro-50/50" title="Enviar cobrança agora" hint="O WhatsApp consolida todas as pendências abertas do sócio em uma única mensagem." checked={draft.sendNow} disabled={!draft.collection} onChange={(sendNow) => patch({ sendNow })} />}
  </>
);

/** O PIX que o sócio vai receber na cobrança; sem a chave, leva à configuração da régua. */
export const PixNotice: React.FC<{ settings: FinSettings | null; onConfigure: () => void }> = ({ settings, onConfigure }) => {
  if (settings?.pix_key?.trim()) {
    return <Notice tone="info">PIX do clube: <b className="break-all">{settings.pix_key}</b>. O comprovante pode gerar baixa parcial, quitar várias pendências e transformar excedente em crédito.</Notice>;
  }
  return (
    <Notice tone="warn" title="Configure a chave PIX na régua">Sem a chave, a cobrança chega ao sócio sem o PIX para pagar.
      <span className="mt-2 block"><button type="button" className={`${btnGhost} w-full sm:w-auto`} onClick={onConfigure}><Settings2 size={16} /> Configurar régua</button></span>
    </Notice>
  );
};
