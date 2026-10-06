/**
 * Contas a pagar e lançamentos pontuais: despesas, receitas avulsas, aportes,
 * retiradas e transferências entre contas, com anexos (nota fiscal, boleto).
 *
 * Mensalidades, Card Mensal, Aula avulsa, Day Card, descontos e multas
 * NÃO se lançam aqui (categorias reservadas): já nascem dos seus módulos, e
 * lançar de novo contaria o valor duas vezes.
 */
import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Paperclip, Plus, Search } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { useConfirm } from '../../../hooks/useConfirm';
import { notifyFinanceError } from '../../../lib/finance/errors';
import {
  cancelEntry, createEntry, DOCS_BUCKET, listAttachments, listEntries, listEntryPayments, payEntry, removeAttachment, reverseEntryPayment, signedUrl, updateEntry,
  uploadAttachment, type EntryFilters,
} from '../../../lib/finance/financeApi';
import type { EntryKind, FinEntry } from '../../../lib/finance/types';
import { ENTRY_KIND_LABEL, entriesSpec } from '../../../lib/finance/export';
import { safeReceiptFileName, validateReceiptFile } from '../../../lib/finance/receiptFile';
import { brDate, type IsoDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { useAsync, useRequestKey, useToday } from '../hooks';
import { categoryLabel, useFinance } from '../FinanceContext';
import { Badge, Card, Empty, ErrorBlock, ExportButtons, Field, MoneyInput, Notice, Row, SectionTabs, Sheet, Spinner, btnDanger, btnGhost, btnPrimary, inputCls } from '../ui';

const STATUS_FILTERS = [['open', 'Em aberto'], ['overdue', 'Vencidas'], ['paid', 'Pagas'], ['canceled', 'Canceladas'], ['all', 'Todas']] as const;
const STATUS_TONE = { pending: 'info', partial: 'warn', paid: 'good', canceled: 'muted', overdue: 'bad' } as const;
const STATUS_LABEL = { pending: 'Pendente', partial: 'Parcial', paid: 'Paga', canceled: 'Cancelada', overdue: 'Vencida' } as const;
const CREATE_KINDS: EntryKind[] = ['expense', 'revenue', 'contribution', 'withdrawal', 'transfer'];

// ------------------------------------------------------------------
// Novo lançamento
// ------------------------------------------------------------------
const NewEntrySheet: React.FC<{ open: boolean; onClose: () => void; onDone: () => void }> = ({ open, onClose, onDone }) => {
  const today = useToday();
  const { accounts, categories } = useFinance();
  const { key, renew } = useRequestKey();
  const [kind, setKind] = useState<EntryKind>('expense');
  const [desc, setDesc] = useState('');
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [competence, setCompetence] = useState<IsoDate>(today);
  const [due, setDue] = useState<IsoDate>(today);
  const [paidNow, setPaidNow] = useState(false);
  const [paidOn, setPaidOn] = useState<IsoDate>(today);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [account, setAccount] = useState('');
  const [counter, setCounter] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const isDoc = kind === 'expense' || kind === 'revenue';
  const cats = categories.filter((c) => c.active && !c.system_key && c.kind === kind && c.dre_line !== 'none');
  const paid = !isDoc || paidNow;
  const valid = desc.trim().length >= 2 && !!amount && amount > 0 && (!isDoc || !!category) && (!paid || !!account) && (kind !== 'transfer' || (!!counter && counter !== account)) && (paid || !!due);

  const save = async () => {
    setBusy(true);
    try {
      await createEntry({
        kind, description: desc.trim(), supplier: supplier.trim() || null, category_id: isDoc ? category : null, amount_cents: amount,
        competence_date: competence, due_date: isDoc ? due : null, status: paid ? 'paid' : 'pending', paid_on: paid ? paidOn : null,
        paid_amount_cents: isDoc && paidNow ? paidAmount ?? amount : null, account_id: account || null, counter_account_id: kind === 'transfer' ? counter : null, notes: notes.trim() || null,
      }, key);
      notify.success('Lançamento registrado.');
      renew(); onDone(); onClose();
      setDesc(''); setSupplier(''); setAmount(null); setNotes(''); setPaidAmount(null); setPaidNow(false);
    } catch (e) { notifyFinanceError(e, 'Não foi possível registrar o lançamento.', 'finance_entry_create_failed'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Novo lançamento" subtitle="Despesa, receita avulsa, aporte, retirada ou transferência"
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy || !valid} onClick={save}>Registrar</button></>}>
      <Field label="Tipo"><select className={inputCls} value={kind} onChange={(e) => { setKind(e.target.value as EntryKind); setCategory(''); }}>{CREATE_KINDS.map((k) => <option key={k} value={k}>{ENTRY_KIND_LABEL[k]}</option>)}</select></Field>
      {kind === 'transfer' && <Notice tone="info">Transferência move dinheiro entre contas do clube. Não é receita nem despesa e não entra no DRE.</Notice>}
      {(kind === 'contribution' || kind === 'withdrawal') && <Notice tone="info">{kind === 'contribution' ? 'Aporte' : 'Retirada'} movimenta o caixa, mas não é receita nem despesa: aparece à parte no DRE.</Notice>}
      <Field label="Descrição"><input className={inputCls} maxLength={140} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      {isDoc && <Field label="Fornecedor / origem (opcional)"><input className={inputCls} value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>}
      {isDoc && (
        <Field label="Categoria" hint="Categorias automáticas (mensalidade, Card Mensal, Day Card…) não aparecem: elas nascem sozinhas.">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Escolha…</option>{cats.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id, categories)}</option>)}</select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Competência" hint="Mês a que pertence"><input type="date" className={inputCls} value={competence} onChange={(e) => setCompetence(e.target.value)} /></Field>
        {isDoc && <Field label="Vencimento"><input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
      </div>
      {isDoc && <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-stone-700"><input type="checkbox" className="h-5 w-5" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} />Já foi {kind === 'expense' ? 'paga' : 'recebida'}</label>}
      {paid && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'transfer' ? 'Data' : 'Data do dinheiro'}><input type="date" className={inputCls} value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          {isDoc && <Field label={`Valor ${kind === 'expense' ? 'pago' : 'recebido'}`} hint="Se diferir do documento, a diferença vira juros/desconto."><MoneyInput value={paidAmount ?? amount} onChange={setPaidAmount} /></Field>}
          <Field label={kind === 'transfer' ? 'Conta de origem' : 'Conta'}><select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Escolha…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          {kind === 'transfer' && <Field label="Conta de destino"><select className={inputCls} value={counter} onChange={(e) => setCounter(e.target.value)}><option value="">Escolha…</option>{accounts.filter((a) => a.active && a.id !== account).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
        </div>
      )}
      <Field label="Observações (opcional)"><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
};

// ------------------------------------------------------------------
// Detalhe: pagar, estornar, editar, cancelar, anexos
// ------------------------------------------------------------------
type Mode = null | 'pay' | 'edit' | 'cancel';

const EntrySheet: React.FC<{ entry: FinEntry | null; onClose: () => void; onChanged: () => void }> = ({ entry, onClose, onChanged }) => {
  const today = useToday();
  const { accounts, categories } = useFinance();
  const confirm = useConfirm();
  const { key, renew } = useRequestKey();
  const [mode, setMode] = useState<Mode>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<IsoDate>(today);
  const [account, setAccount] = useState('');
  const [settle, setSettle] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [desc, setDesc] = useState('');
  const [due, setDue] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tick, setTick] = useState(0);

  const payments = useAsync(() => (entry ? listEntryPayments(entry.id) : Promise.resolve([])), [entry?.id, tick]);
  const attachments = useAsync(() => (entry ? listAttachments(entry.id) : Promise.resolve([])), [entry?.id, tick]);
  if (!entry) return null;
  const e = entry;
  const isDoc = e.kind === 'expense' || e.kind === 'revenue';
  const live = e.status !== 'canceled';
  const hasPayments = e.paid_cents !== 0;
  const reasonOk = reason.trim().length >= 5;
  const after = () => { renew(); setMode(null); setReason(''); setTick((t) => t + 1); onChanged(); };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); notify.success(ok); after(); }
    catch (err) { notifyFinanceError(err, 'Não foi possível concluir a operação.', 'finance_entry_action_failed'); }
    finally { setBusy(false); }
  };
  const start = (m: Mode) => {
    renew(); setMode(m); setReason(''); setNote(''); setSettle(false); setDate(today);
    setAmount(e.remaining_cents > 0 ? e.remaining_cents : null);
    setAccount(e.account_id ?? accounts.find((a) => a.is_default_receipts)?.id ?? accounts.find((a) => a.active)?.id ?? '');
    setDesc(e.description); setDue(e.due_date ?? ''); setCategory(e.category_id ?? '');
  };

  const upload = async (f: File | null) => {
    if (!f) return;
    const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    const check = validateReceiptFile({ name: f.name, type: f.type, size: f.size }, head);
    if ('reason' in check) { notify.error(check.reason); return; }
    setBusy(true);
    try { await uploadAttachment(e.id, f, check.type, safeReceiptFileName(f.name, check.type)); notify.success('Anexo enviado.'); setTick((t) => t + 1); }
    catch (err) { notifyFinanceError(err, 'Não foi possível enviar o anexo.', 'finance_attachment_failed'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const openAttachment = async (path: string) => {
    try { window.open(await signedUrl(DOCS_BUCKET, path, 120), '_blank', 'noopener,noreferrer'); }
    catch (err) { notifyFinanceError(err, 'Não foi possível abrir o anexo.', 'finance_attachment_open_failed'); }
  };

  const reversible = (payments.data ?? []).filter((p) => p.kind === 'payment' && !(payments.data ?? []).some((r) => r.reverses_payment_id === p.id));

  return (
    <Sheet open onClose={onClose} wide title={e.description} subtitle={`${ENTRY_KIND_LABEL[e.kind]} · competência ${brDate(e.competence_date)}${e.due_date ? ` · vence ${brDate(e.due_date)}` : ''}`}>
      <div className="flex items-center justify-between"><Badge tone={STATUS_TONE[e.display_status]}>{STATUS_LABEL[e.display_status]}</Badge>{isDoc && <span className="text-xs text-stone-500">{categoryLabel(e.category_id, categories)}</span>}</div>
      <dl className="space-y-1 rounded-2xl bg-stone-50 p-3 text-sm">
        <div className="flex justify-between"><dt className="text-stone-500">Valor do documento</dt><dd className="font-bold tabular-nums">{formatBRL(e.amount_cents)}</dd></div>
        {isDoc && <div className="flex justify-between"><dt className="text-stone-500">Pago / recebido</dt><dd className="font-bold tabular-nums">{formatBRL(e.paid_cents)}</dd></div>}
        {isDoc && e.adjustment_cents !== 0 && <div className="flex justify-between"><dt className="text-stone-500">Juros (+) ou desconto (−)</dt><dd className="font-bold tabular-nums">{formatBRL(e.adjustment_cents)}</dd></div>}
        {isDoc && <div className="flex justify-between border-t border-stone-200 pt-1 text-base font-black"><dt>Em aberto</dt><dd className="tabular-nums">{formatBRL(e.remaining_cents)}</dd></div>}
        {e.supplier && <div className="flex justify-between"><dt className="text-stone-500">Fornecedor</dt><dd>{e.supplier}</dd></div>}
        {e.notes && <p className="border-t border-stone-200 pt-1 text-xs text-stone-600">{e.notes}</p>}
        {e.cancel_reason && <p className="border-t border-stone-200 pt-1 text-xs text-red-700">Cancelada: {e.cancel_reason}</p>}
      </dl>

      {mode === null && live && (
        <div className="grid grid-cols-2 gap-2">
          {isDoc && ['pending', 'partial'].includes(e.status) && <button className={btnPrimary} onClick={() => start('pay')}>{e.kind === 'expense' ? 'Pagar' : 'Receber'}</button>}
          {e.kind !== 'transfer' && <button className={btnGhost} onClick={() => start('edit')}>Editar</button>}
          {!hasPayments && <button className={btnDanger} onClick={() => start('cancel')}>Cancelar lançamento</button>}
        </div>
      )}

      {mode === 'pay' && (
        <div className="space-y-3 rounded-2xl border border-saibro-200 p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} /></Field>
            <Field label="Data do dinheiro"><input type="date" className={inputCls} value={date} max={today} onChange={(ev) => setDate(ev.target.value)} /></Field>
            <Field label="Conta" className="col-span-2"><select className={inputCls} value={account} onChange={(ev) => setAccount(ev.target.value)}><option value="">Escolha…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          </div>
          <label className="flex min-h-11 items-start gap-2 text-xs font-bold text-stone-600"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={settle} onChange={(ev) => setSettle(ev.target.checked)} />Dar baixa mesmo que o valor seja diferente do documento (a diferença vira juros/multa ou desconto)</label>
          <Field label="Observação (opcional)"><input className={inputCls} value={note} onChange={(ev) => setNote(ev.target.value)} /></Field>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setMode(null)}>Voltar</button>
            <button className={btnPrimary} disabled={busy || !amount || !account} onClick={() => run(() => payEntry(e.id, e.version, { amount_cents: amount, paid_on: date, account_id: account, note: note.trim() || null, settle }, key), 'Pagamento registrado.')}>Confirmar</button></div>
        </div>
      )}

      {mode === 'edit' && (
        <div className="space-y-3 rounded-2xl border border-saibro-200 p-3">
          <Field label="Descrição"><input className={inputCls} value={desc} onChange={(ev) => setDesc(ev.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            {isDoc && <Field label="Vencimento"><input type="date" className={inputCls} value={due} onChange={(ev) => setDue(ev.target.value)} /></Field>}
            {isDoc && <Field label="Valor" hint={hasPayments ? 'Com pagamento, estorne antes de mudar o valor.' : undefined}><MoneyInput value={amount} onChange={setAmount} disabled={hasPayments} /></Field>}
          </div>
          {isDoc && <Field label="Categoria"><select className={inputCls} value={category} onChange={(ev) => setCategory(ev.target.value)}>{categories.filter((c) => (c.active || c.id === e.category_id) && c.kind === e.kind && (!c.system_key || c.id === e.category_id)).map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id, categories)}</option>)}</select></Field>}
          {hasPayments && <Field label="Justificativa (obrigatória: o lançamento já tem pagamento)"><input className={inputCls} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>}
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setMode(null)}>Voltar</button>
            <button className={btnPrimary} disabled={busy || desc.trim().length < 2 || (hasPayments && !reasonOk)} onClick={() => run(() => updateEntry(e.id, e.version, {
              description: desc.trim(), ...(isDoc ? { due_date: due || null, category_id: category || null } : {}),
              ...(isDoc && !hasPayments && amount && amount !== e.amount_cents ? { amount_cents: amount } : {}),
            }, hasPayments ? reason.trim() : null, key), 'Lançamento atualizado.')}>Salvar</button></div>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="space-y-3 rounded-2xl border border-red-200 p-3">
          <p className="text-sm font-black text-red-700">Cancelar lançamento</p>
          <p className="text-xs text-stone-500">Só sem dinheiro movimentado. O histórico fica; o valor deixa de contar.</p>
          <Field label="Motivo (obrigatório)"><textarea className={inputCls} rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setMode(null)}>Voltar</button>
            <button className={btnDanger} disabled={busy || !reasonOk} onClick={() => run(() => cancelEntry(e.id, e.version, reason.trim(), key), 'Lançamento cancelado.')}>Cancelar lançamento</button></div>
        </div>
      )}

      {(payments.data ?? []).length > 0 && (
        <div className="space-y-1.5 border-t border-stone-100 pt-3 text-xs">
          <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Pagamentos</p>
          {payments.data!.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <span>{brDate(p.paid_on)} — {p.kind === 'reversal' ? <b className="text-red-600">Estorno</b> : 'Pagamento'}{p.note ? ` · ${p.note}` : ''}</span>
              <span className="flex items-center gap-2"><b className="tabular-nums">{formatBRL(p.amount_cents)}</b>
                {live && reversible.some((r) => r.id === p.id) && (
                  <button className="min-h-11 px-2 font-bold text-red-600" onClick={async () => {
                    if (!reasonOk) { notify.error('Escreva o motivo do estorno no campo abaixo (mínimo de 5 caracteres).'); return; }
                    if (await confirm({ tone: 'danger', title: 'Estornar este pagamento?', description: 'Cria uma linha de estorno; o histórico fica.', confirmLabel: 'Estornar' })) await run(() => reverseEntryPayment(p.id, reason.trim(), key), 'Pagamento estornado.');
                  }}>estornar</button>)}
              </span>
            </div>
          ))}
          {reversible.length > 0 && live && mode === null && <Field label="Motivo do estorno"><input className={inputCls} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>}
        </div>
      )}

      <div className="space-y-2 border-t border-stone-100 pt-3">
        <div className="flex items-center justify-between"><p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Anexos (nota, boleto, recibo)</p>
          {live && <button className={btnGhost} disabled={busy} onClick={() => fileRef.current?.click()}><Paperclip size={16} /> Anexar</button>}</div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="hidden" aria-label="Anexar arquivo" onChange={(ev) => upload(ev.target.files?.[0] ?? null)} />
        {(attachments.data ?? []).length === 0 ? <p className="text-xs text-stone-400">Nenhum anexo. Imagem ou PDF de até 10 MB, em armazenamento privado.</p> : (
          <ul className="space-y-1.5">
            {attachments.data!.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                <button className="min-h-11 truncate text-left font-bold text-saibro-700 underline" onClick={() => openAttachment(a.storage_path)}>{a.file_name}</button>
                <button className="min-h-11 px-2 font-bold text-red-600" onClick={async () => {
                  if (!reasonOk) { notify.error('Escreva o motivo da remoção no campo de motivo (mínimo de 5 caracteres).'); return; }
                  if (await confirm({ tone: 'warning', title: 'Remover este anexo?', description: 'O arquivo deixa de aparecer; a remoção fica registrada.', confirmLabel: 'Remover' })) await run(() => removeAttachment(a.id, reason.trim(), key), 'Anexo removido.');
                }}>remover</button>
              </li>
            ))}
          </ul>
        )}
        {(attachments.data ?? []).length > 0 && mode === null && <Field label="Motivo (para remover anexo)"><input className={inputCls} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Field>}
      </div>
    </Sheet>
  );
};

// ------------------------------------------------------------------
// Lista
// ------------------------------------------------------------------
const BillsTab: React.FC = () => {
  const { categories } = useFinance();
  const [status, setStatus] = useState<NonNullable<EntryFilters['status']>>('open');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const filters: EntryFilters = { status, kind: kind || undefined, search, dueFrom: dueFrom || undefined, dueTo: dueTo || undefined, limit: 300 };
  const data = useAsync(() => listEntries(filters), [status, kind, search, dueFrom, dueTo]);
  const rows = useMemo(() => data.data ?? [], [data.data]);
  const selected = rows.find((r) => r.id === openId) ?? null;
  const live = useMemo(() => rows.filter((r) => r.status !== 'canceled'), [rows]);
  const openPayable = live.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.remaining_cents, 0);

  const specFilters = [
    { label: 'Situação', value: STATUS_FILTERS.find((s) => s[0] === status)?.[1] ?? status },
    ...(kind ? [{ label: 'Tipo', value: ENTRY_KIND_LABEL[kind as EntryKind] }] : []),
    ...(search.trim() ? [{ label: 'Busca', value: search.trim() }] : []),
    ...(dueFrom ? [{ label: 'Vencimento a partir de', value: brDate(dueFrom) }] : []),
    ...(dueTo ? [{ label: 'Vencimento até', value: brDate(dueTo) }] : []),
  ];

  return (
    <div className="space-y-4">
      <Card title="Contas a pagar e lançamentos" right={<button className={btnPrimary} onClick={() => setCreating(true)}><Plus size={16} /> Novo</button>}>
        <SectionTabs label="Situação" value={status} onChange={(v) => setStatus(v as typeof status)} items={STATUS_FILTERS.map(([id, label]) => ({ id, label }))} />
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="relative col-span-2"><Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-stone-300" /><input className={`${inputCls} pl-9`} placeholder="Buscar pela descrição" aria-label="Buscar pela descrição" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <select className={inputCls} aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Todos os tipos</option>{(['expense', 'revenue', 'contribution', 'withdrawal', 'transfer'] as EntryKind[]).map((k) => <option key={k} value={k}>{ENTRY_KIND_LABEL[k]}</option>)}</select>
          <div className="flex gap-2"><input type="date" className={inputCls} aria-label="Vencimento a partir de" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} /><input type="date" className={inputCls} aria-label="Vencimento até" value={dueTo} onChange={(e) => setDueTo(e.target.value)} /></div>
        </div>
      </Card>

      {data.error ? <ErrorBlock error={data.error} onRetry={data.reload} /> : data.loading ? <Spinner /> : rows.length === 0 ? (
        <Empty title="Nenhum lançamento com esses filtros" icon={<ArrowLeftRight size={28} />} action={<button className={btnPrimary} onClick={() => setCreating(true)}><Plus size={16} /> Novo lançamento</button>} />
      ) : (
        <Card title={`${rows.length} lançamento(s)`} subtitle={`Despesas em aberto nesta lista: ${formatBRL(openPayable)}`} right={<ExportButtons getSpec={() => entriesSpec(rows, { period: null, filters: specFilters, generatedAt: new Date().toISOString(), categoryName: (id) => categoryLabel(id, categories) })} />}>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Row onClick={() => setOpenId(r.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-black text-stone-800">{r.description}</p><p className="text-xs text-stone-500">{ENTRY_KIND_LABEL[r.kind]}{r.due_date ? ` · vence ${brDate(r.due_date)}` : ''}{r.recurrence_id ? ' · recorrente' : ''}</p></div>
                    <div className="text-right"><p className="text-sm font-black tabular-nums">{formatBRL(r.amount_cents)}</p>{r.remaining_cents > 0 && r.paid_cents > 0 && <p className="text-[11px] text-stone-400">faltam {formatBRL(r.remaining_cents)}</p>}</div>
                  </div>
                  <div className="mt-1"><Badge tone={STATUS_TONE[r.display_status]}>{STATUS_LABEL[r.display_status]}</Badge></div>
                </Row>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <NewEntrySheet open={creating} onClose={() => setCreating(false)} onDone={data.reload} />
      <EntrySheet key={selected?.id ?? 'none'} entry={selected} onClose={() => setOpenId(null)} onChanged={data.reload} />
    </div>
  );
};

export default BillsTab;
