/**
 * "Meu financeiro" — a área do sócio. Mostra SÓ o que é dele (RLS no banco):
 * mensalidades com valor original, dias de atraso, multa e juros separados e
 * total atualizado; pagamentos; e o envio/acompanhamento de comprovantes.
 *
 * Enviar comprovante NÃO quita nada: o clube confere e confirma.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ChevronDown, ChevronUp, Copy, FileText, Loader2, Receipt, Wallet } from 'lucide-react';
import { User } from '../../types';
import { notify } from '../../lib/notifications';
import { notifyFinanceError } from '../../lib/finance/errors';
import {
  chargeHistory, chargeStatementsByIds, getMemberPaymentSettings, getPublicSettings, listCredits, listPendencyMeta, myCharges, myReceipts, newRequestId, submitReceipt,
} from '../../lib/finance/financeApi';
import type { ChargeStatementRow, MemberPendencyMeta, PublicSettings } from '../../lib/finance/types';
import { brDate, monthLabel, type IsoDate } from '../../lib/finance/dates';
import { formatBRL } from '../../lib/finance/money';
import { RECEIPT_MAX_BYTES, safeReceiptFileName, sha256Hex, validateReceiptFile, type ReceiptMime } from '../../lib/finance/receiptFile';
import { readReceipt } from '../../lib/finance/ocr';
import { analyzeReceipt, receiptStatusInfo, statementFromRow, type ReceiptFlag } from '../../lib/finance/receipts';
import { useAsync, useRequestKey, useToday } from './hooks';
import { Badge, Card, ChargeStatusBadge, Empty, ErrorBlock, Field, MoneyInput, Notice, SectionTabs, Sheet, Spinner, btnGhost, btnPrimary, inputCls } from './ui';

const DUE_RULE_LABEL: Record<PublicSettings['non_business_rule'], string> = {
  next_business_day: 'passa para o próximo dia útil', previous_business_day: 'passa para o dia útil anterior', keep: 'é mantido',
};

/** Descreve em português a regra de vencimento e de encargos em vigor. */
// eslint-disable-next-line react-refresh/only-export-components
export function describeRules(s: PublicSettings): { due: string; fees: string } {
  const due = `Vence no dia ${s.due_day} ${s.due_month_offset === 1 ? 'do mês seguinte ao período cobrado' : 'do mês do período cobrado'}; se cair em dia não útil, ${DUE_RULE_LABEL[s.non_business_rule]}.`;
  if (!s.late_fee_confirmed) return { due, fees: 'Os encargos de atraso ainda não foram definidos pelo clube: por enquanto nenhum encargo é cobrado.' };
  const parts: string[] = [];
  const fine = [s.fine_fixed_cents ? formatBRL(s.fine_fixed_cents) : null, s.fine_percent_bps ? `${(s.fine_percent_bps / 100).toLocaleString('pt-BR')}%` : null].filter(Boolean);
  const inter = [s.interest_daily_fixed_cents ? `${formatBRL(s.interest_daily_fixed_cents)} por dia` : null, s.interest_daily_percent_bps ? `${(s.interest_daily_percent_bps / 100).toLocaleString('pt-BR')}% ao dia sobre o valor em aberto` : null].filter(Boolean);
  if (fine.length) parts.push(`multa única de ${fine.join(' + ')} no 1º dia de atraso`);
  if (inter.length) parts.push(`juros de ${inter.join(' + ')}`);
  if (parts.length === 0) return { due, fees: 'O clube não cobra encargos de atraso.' };
  return { due, fees: `Em caso de atraso: ${parts.join(' e ')}${s.grace_days ? `, após ${s.grace_days} dia(s) de carência` : ''}. Juros simples — encargos não geram novos juros.` };
}

const ChargeCard: React.FC<{ c: ChargeStatementRow; meta?: MemberPendencyMeta | null; selected: boolean; selectable: boolean; onToggle: () => void }> = ({ c, meta, selected, selectable, onToggle }) => {
  const [open, setOpen] = useState(false);
  const hist = useAsync(() => (open ? chargeHistory(c.charge_id) : Promise.resolve(null)), [open, c.charge_id]);
  const payable = c.display_status !== 'paid' && c.display_status !== 'canceled';
  const isPendency = c.plan_id === null && !!meta;
  const title = isPendency ? meta!.description : `Mensalidade de ${monthLabel(c.competence_month)}`;
  return (
    <div className={`rounded-3xl border bg-white p-4 shadow-sm ${selected ? 'border-saibro-400 ring-2 ring-saibro-100' : 'border-stone-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-stone-800">{title}</p>
          <p className="text-xs text-stone-500">{isPendency ? `Pendência · competência ${monthLabel(c.competence_month)} · ` : ''}Vencimento em {brDate(c.due_date)}</p>
          {isPendency && (meta!.guest_name || meta!.guest_date) && <p className="mt-1 text-xs text-stone-400">{meta!.guest_name ? `Convidado: ${meta!.guest_name}` : ''}{meta!.guest_name && meta!.guest_date ? ' · ' : ''}{meta!.guest_date ? `Visita: ${brDate(meta!.guest_date)}` : ''}</p>}
        </div>
        <ChargeStatusBadge status={c.display_status} />
      </div>

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-stone-500">Valor original</dt><dd className="font-bold tabular-nums">{formatBRL(c.original_amount_cents)}</dd></div>
        {c.principal_base_cents !== c.original_amount_cents && (
          <div className="flex justify-between"><dt className="text-stone-500">Valor com ajustes</dt><dd className="font-bold tabular-nums">{formatBRL(c.principal_base_cents)}</dd></div>
        )}
        {c.principal_paid_cents > 0 && <div className="flex justify-between"><dt className="text-stone-500">Já pago</dt><dd className="font-bold tabular-nums text-emerald-600">− {formatBRL(c.principal_paid_cents)}</dd></div>}
        {payable && c.days_late > 0 && (
          <>
            <div className="flex justify-between"><dt className="text-stone-500">Dias de atraso</dt><dd className="font-bold text-red-600">{c.days_late}</dd></div>
            {c.fees_configured ? (
              <>
                <div className="flex justify-between"><dt className="text-stone-500">Multa</dt><dd className="tabular-nums">{formatBRL(c.fine_due_cents)}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">Juros</dt><dd className="tabular-nums">{formatBRL(c.interest_due_cents)}</dd></div>
              </>
            ) : <p className="text-xs text-stone-400">Encargos de atraso ainda não definidos pelo clube.</p>}
          </>
        )}
        {payable && (
          <div className="flex justify-between border-t border-stone-100 pt-1.5 text-base"><dt className="font-black text-stone-700">Total atualizado hoje</dt><dd className="font-black tabular-nums text-stone-900">{formatBRL(c.total_due_cents)}</dd></div>
        )}
      </dl>
      {c.in_review && <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-medium text-amber-800">Você enviou um comprovante para esta cobrança. O clube está conferindo — ela só muda de situação quando o pagamento for confirmado.</p>}
      {c.cancel_reason && <p className="mt-2 text-xs text-stone-400">Cancelada: {c.cancel_reason}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {selectable && payable && (
          <label className={`${selected ? btnPrimary : btnGhost} cursor-pointer`}>
            <input type="checkbox" className="sr-only" checked={selected} onChange={onToggle} aria-label={`Incluir ${title} no comprovante`} />
            {selected ? 'Incluída no comprovante' : 'Pagar esta'}
          </label>
        )}
        <button className={btnGhost} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />} Histórico</button>
      </div>

      {open && (
        <div className="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-xs text-stone-600">
          {hist.loading && <Spinner label="Carregando histórico…" />}
          {hist.data && hist.data.payments.length === 0 && hist.data.adjustments.length === 0 && <p className="text-stone-400">Nenhum pagamento ou ajuste ainda.</p>}
          {hist.data?.payments.map((p) => (
            <p key={p.id}>
              {brDate(p.paid_on)} — {p.kind === 'reversal' ? 'Estorno' : 'Pagamento'} de <b>{formatBRL(p.amount_cents)}</b>
              {p.kind === 'payment' && ` (principal ${formatBRL(p.principal_cents)}${p.fine_cents + p.interest_cents > 0 ? `, encargos ${formatBRL(p.fine_cents + p.interest_cents)}` : ''}${p.excess_cents > 0 ? `, crédito ${formatBRL(p.excess_cents)}` : ''})`}
            </p>
          ))}
          {hist.data?.adjustments.map((a) => (
            <p key={a.id}>
              {brDate(a.created_at.slice(0, 10))} — {a.kind === 'discount' ? 'Desconto' : a.kind === 'increase' ? 'Acréscimo' : 'Dispensa de encargos'} de <b>{formatBRL(a.amount_cents)}</b>: {a.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------
// Envio do comprovante
// ------------------------------------------------------------------
interface SendSheetProps {
  open: boolean;
  onClose: () => void;
  user: User;
  payable: ChargeStatementRow[];
  preselected: string[];
  replaces: string | null;
  pendencyMeta: Map<string, MemberPendencyMeta>;
  onSent: () => void;
}

const SendReceiptSheet: React.FC<SendSheetProps> = ({ open, onClose, user, payable, preselected, replaces, pendencyMeta, onSent }) => {
  const today = useToday();
  const { key, renew } = useRequestKey();
  const submissionId = useRef(newRequestId());
  const [chosen, setChosen] = useState<string[]>(preselected);
  const [file, setFile] = useState<{ file: File; type: ReceiptMime; hash: string; name: string } | null>(null);
  const [ocr, setOcr] = useState<{ status: 'idle' | 'reading' | 'ok' | 'unreadable' | 'failed'; pct: number; stored: Record<string, unknown> | null; identifier: string | null }>({ status: 'idle', pct: 0, stored: null, identifier: null });
  const [amount, setAmount] = useState<number | null>(null);
  const [paidOn, setPaidOn] = useState<IsoDate | ''>('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flags, setFlags] = useState<ReceiptFlag[]>([]);

  useEffect(() => {
    if (!open) return;
    setChosen(preselected);
    submissionId.current = newRequestId();
    setFile(null); setOcr({ status: 'idle', pct: 0, stored: null, identifier: null }); setAmount(null); setPaidOn('');
    setReference(''); setNote(''); setFileError(null); setFlags([]);
  }, [open, preselected]);

  const selectedCharges = useMemo(() => payable.filter((c) => chosen.includes(c.charge_id)), [payable, chosen]);
  const totalToday = selectedCharges.reduce((s, c) => s + c.total_due_cents, 0);

  // Conferência para o próprio sócio (só orienta; quem decide é o clube).
  useEffect(() => {
    let alive = true;
    if (!open || selectedCharges.length === 0 || !paidOn) { setFlags([]); return; }
    chargeStatementsByIds(selectedCharges.map((c) => c.charge_id), paidOn).then((atPaid) => {
      if (!alive) return;
      const ctxs = atPaid.map((r) => {
        const nowRow = selectedCharges.find((c) => c.charge_id === r.charge_id)!;
        return { id: r.charge_id, competenceMonth: r.competence_month, dueDate: r.due_date, statementAtPaid: statementFromRow(r), statementToday: statementFromRow(nowRow) };
      });
      const a = analyzeReceipt({
        declared: { amountCents: amount, paidOn: paidOn || null }, extracted: null, ocrStatus: ocr.status === 'idle' || ocr.status === 'reading' ? 'not_run' : ocr.status,
        charges: ctxs, today, possibleDuplicate: false,
      });
      setFlags(a.flags.filter((f) => f.severity !== 'info' || f.code === 'amount_matches_total'));
    }).catch(() => { if (alive) setFlags([]); });
    return () => { alive = false; };
  }, [open, selectedCharges, paidOn, amount, ocr.status, today]);

  const pick = async (f: File | null) => {
    if (!f) return;
    setFileError(null);
    const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    const check = validateReceiptFile({ name: f.name, type: f.type, size: f.size }, head);
    if ('reason' in check) { setFileError(check.reason); setFile(null); return; }
    const hash = await sha256Hex(await f.arrayBuffer());
    setFile({ file: f, type: check.type, hash, name: safeReceiptFileName(f.name, check.type) });
    setOcr({ status: 'reading', pct: 0, stored: null, identifier: null });
    const out = await readReceipt(f, check.type, (pct) => setOcr((o) => ({ ...o, pct })));
    if (out.status === 'ok') {
      setOcr({ status: 'ok', pct: 100, stored: out.stored, identifier: out.extracted.identifier });
      if (out.extracted.amountCents !== null) setAmount(out.extracted.amountCents);
      if (out.extracted.paidOn && out.extracted.paidOn <= today) setPaidOn(out.extracted.paidOn);
      if (out.extracted.identifier) setReference(out.extracted.identifier);
    } else setOcr({ status: out.status, pct: 0, stored: null, identifier: null });
  };

  const canSend = !!file && chosen.length > 0 && amount !== null && amount > 0 && !!paidOn && !busy;

  const send = async () => {
    if (!file || amount === null || !paidOn) return;
    setBusy(true);
    try {
      const res = await submitReceipt({
        userId: user.id, submissionId: submissionId.current, requestId: key, file: file.file, type: file.type, safeName: file.name, sha256: file.hash,
        chargeIds: chosen, declaredAmountCents: amount, declaredPaidOn: paidOn, reference: reference.trim() || null, note: note.trim() || null,
        ocrStatus: ocr.status === 'ok' ? 'ok' : ocr.status === 'unreadable' ? 'unreadable' : ocr.status === 'failed' ? 'failed' : 'not_run', ocr: ocr.stored, replaces,
      });
      notify.success(res.auto_approved ? 'Pagamento identificado e baixado!' : 'Comprovante enviado!', {
        description: res.auto_approved
          ? 'O OCR conferiu os dados e o financeiro atualizou automaticamente suas pendências.'
          : res.possible_duplicate
            ? 'Este arquivo já tinha sido enviado antes; o clube vai conferir.'
            : 'O clube vai conferir o pagamento e você será avisado.',
      });
      renew();
      onSent();
      onClose();
    } catch (e) {
      notifyFinanceError(e, 'Não foi possível enviar o comprovante.', 'finance_receipt_submit_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open} onClose={onClose} title={replaces ? 'Enviar novo comprovante' : 'Enviar comprovante'}
      subtitle="O OCR pode confirmar automaticamente pendências quando valor, data e favorecido conferirem; qualquer dúvida vai para análise."
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={!canSend} onClick={send}>{busy ? <Loader2 className="animate-spin" size={16} /> : <Receipt size={16} />} Enviar comprovante</button></>}
    >
      <Field label="1. Quais cobranças você pagou?">
        <div className="space-y-2">
          {payable.length === 0 && <p className="text-sm text-stone-400">Você não tem cobranças em aberto.</p>}
          {payable.map((c) => (
            <label key={c.charge_id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-stone-200 p-3 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-orange-600" checked={chosen.includes(c.charge_id)} onChange={() => setChosen((s) => (s.includes(c.charge_id) ? s.filter((x) => x !== c.charge_id) : [...s, c.charge_id]))} />
              <span className="flex-1">{pendencyMeta.get(c.charge_id)?.description ?? `Mensalidade · ${monthLabel(c.competence_month)}`}</span>
              <span className="font-bold tabular-nums">{formatBRL(c.total_due_cents)}</span>
            </label>
          ))}
          {selectedCharges.length > 0 && <p className="text-xs text-stone-500">Total devido hoje: <b>{formatBRL(totalToday)}</b> (o valor muda se você pagou em outra data).</p>}
        </div>
      </Field>

      <Field label="2. Foto ou PDF do comprovante" hint={`Imagem (JPG, PNG, WEBP, HEIC) ou PDF, até ${RECEIPT_MAX_BYTES / 1024 / 1024} MB. O arquivo fica privado: só você e o clube veem.`}>
        <div className="grid grid-cols-2 gap-2">
          <label className={`${btnGhost} cursor-pointer`}><Camera size={16} /> Tirar foto<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} /></label>
          <label className={`${btnGhost} cursor-pointer`}><FileText size={16} /> Escolher arquivo<input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} /></label>
        </div>
        {file && <p className="mt-1 truncate text-xs text-stone-500">{file.name} ({(file.file.size / 1024).toFixed(0)} KB)</p>}
        {fileError && <p role="alert" className="mt-1 text-xs font-bold text-red-600">{fileError}</p>}
      </Field>

      {ocr.status === 'reading' && <Notice title="Lendo o comprovante…">Isso acontece no seu aparelho e leva alguns segundos{ocr.pct > 0 ? ` (${ocr.pct}%)` : ''}.</Notice>}
      {ocr.status === 'ok' && <Notice tone="warn" title="Preenchemos o que conseguimos ler">A leitura automática pode errar. Confira o valor e a data antes de enviar.</Notice>}
      {(ocr.status === 'unreadable' || ocr.status === 'failed') && <Notice tone="warn" title="Não conseguimos ler o comprovante">Sem problema: preencha o valor e a data à mão. O clube vai conferir o arquivo.</Notice>}

      <div className="grid grid-cols-2 gap-3">
        <Field label="3. Valor pago"><MoneyInput value={amount} onChange={setAmount} aria-label="Valor pago" /></Field>
        <Field label="Data do pagamento"><input type="date" className={inputCls} value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} aria-label="Data do pagamento" /></Field>
      </div>
      <Field label="Identificador do Pix/transação (opcional)"><input className={inputCls} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} /></Field>
      <Field label="Observação para o clube (opcional)"><textarea className={inputCls} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>

      {flags.length > 0 && (
        <Notice tone="warn" title="Confira antes de enviar">
          <ul className="list-disc space-y-0.5 pl-4">{flags.map((f, i) => <li key={`${f.code}-${i}`}>{f.message}</li>)}</ul>
          <p className="mt-1 text-[11px] opacity-80">Isto é só uma orientação. Você pode enviar mesmo assim; o clube decide.</p>
        </Notice>
      )}
    </Sheet>
  );
};

// ------------------------------------------------------------------
// Tela
// ------------------------------------------------------------------
export const MemberFinance: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const charges = useAsync(() => myCharges(), []);
  const receipts = useAsync(() => myReceipts(), []);
  const credits = useAsync(() => listCredits(currentUser.id), [currentUser.id]);
  const settings = useAsync(() => getPublicSettings(), []);
  const paySettings = useAsync(() => getMemberPaymentSettings(), []);
  const pendencies = useAsync(() => listPendencyMeta(currentUser.id), [currentUser.id]);
  const [tab, setTab] = useState('pay');
  const [send, setSend] = useState<{ open: boolean; replaces: string | null; pre: string[] }>({ open: false, replaces: null, pre: [] });
  const [picked, setPicked] = useState<string[]>([]);

  const list = useMemo(() => charges.data ?? [], [charges.data]);
  const pendencyById = useMemo(() => new Map((pendencies.data ?? []).map((p) => [p.id, p])), [pendencies.data]);
  const groups = useMemo(() => ({
    pay: list.filter((c) => ['overdue', 'open', 'partial', 'in_review'].includes(c.display_status)),
    forecast: list.filter((c) => c.display_status === 'forecast'),
    paid: list.filter((c) => c.display_status === 'paid'),
    canceled: list.filter((c) => c.display_status === 'canceled'),
  }), [list]);
  const payable = [...groups.pay, ...groups.forecast].filter((c) => c.total_due_cents > 0);
  const owedNow = groups.pay.reduce((s, c) => s + c.total_due_cents, 0);
  const overdue = groups.pay.filter((c) => c.display_status === 'overdue');
  const rules = settings.data ? describeRules(settings.data) : null;
  const openCredit = (credits.data ?? []).filter((c) => c.status === 'open').reduce((s, c) => s + c.remaining_cents, 0);
  const openPendencyRows = list.filter((c) => pendencyById.has(c.charge_id) && !['paid', 'canceled'].includes(c.display_status));
  const openPendencyCents = openPendencyRows.reduce((sum, c) => sum + c.total_due_cents, 0);
  const [pixCopied, setPixCopied] = useState(false);
  const copyPix = async () => {
    const pix = paySettings.data?.pix_key;
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix);
      setPixCopied(true);
      notify.success('Chave PIX copiada.');
      setTimeout(() => setPixCopied(false), 1600);
    } catch { notify.info(`PIX: ${pix}`); }
  };

  const refresh = () => { charges.reload(); receipts.reload(); credits.reload(); pendencies.reload(); };
  const shown = tab === 'pay' ? groups.pay : tab === 'forecast' ? groups.forecast : tab === 'paid' ? groups.paid : groups.canceled;

  return (
    <div className="space-y-4 pb-6">
      <header className="rounded-3xl bg-linear-to-br from-saibro-600 to-orange-500 p-5 text-white shadow-lg shadow-saibro-200/50">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-saibro-100"><Wallet size={14} /> Meu financeiro</div>
        <p className="mt-2 text-sm text-saibro-100">{overdue.length > 0 ? `Você tem ${overdue.length} cobrança${overdue.length > 1 ? 's' : ''} vencida${overdue.length > 1 ? 's' : ''}` : owedNow > 0 ? 'Valor em aberto hoje' : 'Tudo em dia'}</p>
        <p className="text-4xl font-black tabular-nums">{formatBRL(owedNow)}</p>
        <p className="mt-1 text-xs text-saibro-100">Total atualizado de hoje, com encargos de atraso quando houver.</p>
        <button className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-black text-saibro-700 shadow-sm active:scale-95 disabled:opacity-60" disabled={payable.length === 0} onClick={() => setSend({ open: true, replaces: null, pre: picked })}>
          <Receipt size={16} /> Enviar comprovante{picked.length ? ` (${picked.length})` : ''}
        </button>
      </header>

      {openPendencyRows.length > 0 && (
        <Card title="Pendências financeiras" subtitle="Pendências lançadas pelo clube ficam aqui até a quitação.">
          <div className="flex items-end justify-between gap-3 rounded-2xl bg-stone-50 p-3">
            <div><p className="text-[10px] font-black uppercase tracking-wide text-stone-400">Saldo das pendências</p><p className="text-2xl font-black text-stone-900">{formatBRL(openPendencyCents)}</p></div>
            {paySettings.data?.pix_key && <button className={btnGhost} onClick={copyPix}>{pixCopied ? <Check size={15} /> : <Copy size={15} />} {pixCopied ? 'Copiado' : 'Copiar PIX'}</button>}
          </div>
          {paySettings.data?.pix_key && <p className="mt-2 break-all text-xs text-stone-500">PIX do clube: <b className="text-stone-700">{paySettings.data.pix_key}</b></p>}
          <p className="mt-2 text-xs text-stone-500">Você pode selecionar uma ou mais pendências abaixo e enviar um único comprovante. Pagamento parcial mantém o saldo; valor excedente vira crédito.</p>
        </Card>
      )}

      {rules && (
        <Card title="Como funciona" subtitle="Regras do clube para a sua mensalidade">
          <ul className="space-y-1 text-xs leading-relaxed text-stone-600"><li>{rules.due}</li><li>{rules.fees}</li></ul>
        </Card>
      )}

      {openCredit > 0 && (
        <Notice tone="info" title={`Você tem ${formatBRL(openCredit)} de crédito`}>
          Houve pagamento a mais ou repetido. O clube vai aplicar o crédito numa próxima cobrança ou devolver o valor — nada se perde.
        </Notice>
      )}

      {charges.error ? <ErrorBlock error={charges.error} onRetry={charges.reload} /> : (
        <>
          <SectionTabs label="Cobranças" value={tab} onChange={setTab} items={[
            { id: 'pay', label: 'A pagar', badge: groups.pay.length }, { id: 'forecast', label: 'Previstas', badge: groups.forecast.length },
            { id: 'paid', label: 'Pagas' }, { id: 'canceled', label: 'Canceladas' },
          ]} />
          {charges.loading ? <Spinner /> : shown.length === 0 ? (
            <Empty title={list.length === 0 ? 'Você ainda não tem mensalidade cadastrada' : 'Nada por aqui'} hint={list.length === 0 ? 'Se acha que deveria ter, fale com a secretaria do clube.' : undefined} />
          ) : (
            <div className="space-y-3">
              {shown.map((c) => (
                <ChargeCard key={c.charge_id} c={c} meta={pendencyById.get(c.charge_id)} selectable={tab === 'pay' || tab === 'forecast'} selected={picked.includes(c.charge_id)}
                  onToggle={() => setPicked((p) => (p.includes(c.charge_id) ? p.filter((x) => x !== c.charge_id) : [...p, c.charge_id]))} />
              ))}
            </div>
          )}
        </>
      )}

      <Card title="Meus comprovantes" subtitle="Acompanhe a análise do clube">
        {receipts.loading ? <Spinner /> : (receipts.data ?? []).length === 0 ? (
          <p className="text-sm text-stone-400">Você ainda não enviou comprovantes.</p>
        ) : (
          <div className="space-y-2">
            {(receipts.data ?? []).map((r) => {
              const info = receiptStatusInfo(r.status, { decisionReason: r.decision_reason, reviewedOn: r.reviewed_at ? brDate(r.reviewed_at.slice(0, 10)) : null });
              return (
                <div key={r.id} className="rounded-2xl border border-stone-100 bg-stone-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-stone-700">{r.declared_amount_cents ? formatBRL(r.declared_amount_cents) : 'Valor não informado'}{r.declared_paid_on ? ` · ${brDate(r.declared_paid_on)}` : ''}</p>
                    <Badge tone={info.tone === 'success' ? 'good' : info.tone === 'danger' ? 'bad' : info.tone === 'muted' ? 'muted' : 'info'}>{info.label}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-stone-500">{info.nextStep}</p>
                  {r.possible_duplicate && <p className="mt-1 text-[11px] text-amber-700">Este arquivo já tinha sido enviado antes.</p>}
                  {(r.status === 'rejected' || r.status === 'submitted') && (
                    <button className={`${btnGhost} mt-2`} onClick={() => setSend({ open: true, replaces: r.id, pre: r.charge_ids })}>Enviar novo comprovante</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <SendReceiptSheet open={send.open} onClose={() => setSend((s) => ({ ...s, open: false }))} user={currentUser} payable={payable} preselected={send.pre} replaces={send.replaces}
        pendencyMeta={pendencyById} onSent={() => { setPicked([]); refresh(); }} />
    </div>
  );
};

export default MemberFinance;

