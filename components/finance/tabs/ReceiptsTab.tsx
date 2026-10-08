/**
 * Fila de comprovantes enviados pelos sócios. A leitura automática (OCR) e a
 * conferência só SUGEREM: quem confirma o pagamento é o administrador, aqui.
 * Aprovar cria os pagamentos (com a divisão multa → juros → principal); recusar
 * exige motivo e deixa as cobranças em aberto. Tudo auditado.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CheckCheck, CheckCircle2, FileText, Link2, ShieldAlert } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { useConfirm } from '../../../hooks/useConfirm';
import { notifyFinanceError } from '../../../lib/finance/errors';
import {
  approveReceipt, chargeStatementsByIds, linkReceiptCharges, listCharges, rejectReceipt, receiptDetail, receiptQueue, signedUrl, startReceiptReview, RECEIPTS_BUCKET,
} from '../../../lib/finance/financeApi';
import type { ReceiptQueueRow } from '../../../lib/finance/types';
import { receiptStatusInfo, type ReceiptFlag } from '../../../lib/finance/receipts';
import { analyzeFromStatements } from '../../../lib/finance/batch';
import { brDate, monthLabel, type IsoDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { useAsync, useRequestKey, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import { Badge, Card, Empty, ErrorBlock, Field, MoneyInput, Notice, Row, SectionTabs, Sheet, Spinner, btnDanger, btnGhost, btnPrimary, inputCls } from '../ui';
import { BatchApproveSheet } from './ReceiptsBatch';

const METHODS = [['pix', 'Pix'], ['transfer', 'Transferência'], ['cash', 'Dinheiro'], ['card', 'Cartão'], ['other', 'Outro']] as const;
const FILTERS = [['pending', 'Pendentes'], ['approved', 'Aprovados'], ['rejected', 'Recusados']] as const;
type Filter = (typeof FILTERS)[number][0];

const flagTone = (f: ReceiptFlag) => (f.severity === 'block' ? 'bad' : f.severity === 'warn' ? 'warn' : 'info');

/** Cobranças em aberto do sócio que ainda não estão ligadas ao comprovante; o administrador escolhe e liga. */
const LinkChargesPanel: React.FC<{ submissionId: string; profileId: string; linked: string[]; onLinked: () => void }> = ({ submissionId, profileId, linked, onLinked }) => {
  const [open, setOpen] = useState(linked.length === 0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { key, renew } = useRequestKey();
  const list = useAsync(async () => {
    if (!open) return null;
    const all = await listCharges({ profileId }, 100, 0);
    return all.filter((c) => (c.stored_status === 'open' || c.stored_status === 'partial') && !linked.includes(c.charge_id));
  }, [open, profileId, linked.join(',')]);

  const link = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      await linkReceiptCharges(submissionId, chosen, key);
      notify.success(chosen.length === 1 ? 'Cobrança ligada ao comprovante.' : 'Cobranças ligadas ao comprovante.');
      setChosen([]); renew(); onLinked();
    } catch (e) { notifyFinanceError(e, 'Não foi possível ligar a cobrança.', 'finance_receipt_link_failed'); }
    finally { setBusy(false); }
  };

  if (!open) return <button className={btnGhost} onClick={() => setOpen(true)}><Link2 size={16} /> Ligar outra cobrança do sócio</button>;
  return (
    <div className="space-y-2 rounded-2xl border border-stone-200 p-3">
      <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Ligar cobrança ao comprovante</p>
      {linked.length === 0 && <Notice tone="warn">Este comprovante chegou sem cobrança ligada. Escolha a que ele paga para poder aprovar.</Notice>}
      {list.error ? <ErrorBlock error={list.error} onRetry={list.reload} /> : list.loading || !list.data ? <Spinner /> : list.data.length === 0 ? (
        <p className="text-sm text-stone-500">Este sócio não tem outra cobrança em aberto. Crie a pendência ou a mensalidade em Cobranças e volte aqui.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {list.data.map((c) => (
              <li key={c.charge_id}>
                <label className="flex min-h-11 items-center gap-3 rounded-xl border border-stone-200 px-3 py-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={chosen.includes(c.charge_id)}
                    onChange={(e) => setChosen((x) => e.target.checked ? [...x, c.charge_id] : x.filter((y) => y !== c.charge_id))} />
                  <span className="flex-1"><b className="capitalize">{monthLabel(c.competence_month)}</b> <span className="text-xs text-stone-500">· vence {brDate(c.due_date)}</span></span>
                  <span className="font-black tabular-nums">{formatBRL(c.total_due_cents)}</span>
                </label>
              </li>
            ))}
          </ul>
          <button className={btnPrimary} disabled={busy || chosen.length === 0} onClick={link}>Ligar ao comprovante</button>
        </>
      )}
    </div>
  );
};

interface ReviewProps { id: string | null; queue: ReceiptQueueRow[]; onClose: () => void; onDone: () => void }

const ReviewSheet: React.FC<ReviewProps> = ({ id, queue, onClose, onDone }) => {
  const today = useToday();
  const { accounts, settings } = useFinance();
  const confirm = useConfirm();
  const { key, renew } = useRequestKey();
  const row = queue.find((q) => q.id === id) ?? null;

  const detail = useAsync(async () => {
    if (!id) return null;
    const d = await receiptDetail(id);
    // Marca "em análise" para os outros administradores (melhor esforço; não decide nada).
    if (d.status === 'submitted') startReceiptReview(id).catch(() => undefined);
    return d;
  }, [id]);

  const ocr = (detail.data?.ocr ?? null) as { amount_cents?: number | null; paid_on?: string | null; identifier?: string | null; payee?: string | null } | null;
  const [paidOn, setPaidOn] = useState<IsoDate>(today);
  const [method, setMethod] = useState('pix');
  const [account, setAccount] = useState('');
  const [note, setNote] = useState('');
  const [alloc, setAlloc] = useState<Record<string, number | null>>({});
  const [waive, setWaive] = useState<Record<string, { on: boolean; reason: string }>>({});
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; image: boolean } | null>(null);

  useEffect(() => {
    if (!detail.data) return;
    const d = detail.data;
    setPaidOn((d.declared_paid_on ?? ocr?.paid_on ?? today) as IsoDate);
    setMethod('pix'); setNote(''); setReason(''); setRejecting(false); setPreview(null); setWaive({}); setAlloc({});
    setAccount(accounts.find((a) => a.is_default_receipts)?.id ?? accounts.find((a) => a.active)?.id ?? '');
    renew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data?.id]);

  // Extratos: na data do pagamento (para dividir) e hoje (para saber se já foi quitada).
  const stm = useAsync(async () => {
    const d = detail.data;
    if (!d || d.charge_ids.length === 0) return null;
    const [atPaid, now] = await Promise.all([chargeStatementsByIds(d.charge_ids, paidOn), chargeStatementsByIds(d.charge_ids)]);
    return { atPaid, now };
  }, [detail.data?.id, detail.data?.charge_ids.join(','), paidOn]);

  const analysis = useMemo(() => {
    const d = detail.data;
    if (!d || !stm.data) return null;
    const others = queue.filter((q) => q.id !== d.id).map((q) => ({
      amountCents: q.declared_amount_cents, paidOn: q.declared_paid_on, identifier: ((q.ocr ?? null) as { identifier?: string | null } | null)?.identifier ?? null,
    }));
    return analyzeFromStatements({ detail: d, atPaid: stm.data.atPaid, now: stm.data.now, others, payeeNames: settings?.payee_names ?? [], pixKey: settings?.pix_key, today });
  }, [detail.data, stm.data, queue, settings?.payee_names, today]);

  // Sugestão inicial da divisão (o administrador pode editar). A sobra vai para a última cobrança e vira crédito.
  useEffect(() => {
    if (!analysis) return;
    const next: Record<string, number | null> = {};
    analysis.allocation.forEach((a, i) => {
      next[a.chargeId] = a.amountCents + (i === analysis.allocation.length - 1 ? analysis.excessCents : 0);
    });
    setAlloc(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.amountCents, analysis?.paidOn, stm.data]);

  if (!id) return null;
  const d = detail.data;
  const charges = stm.data?.atPaid ?? [];
  const entries = charges.map((c) => ({ c, amount: alloc[c.charge_id] ?? 0, w: waive[c.charge_id] ?? { on: false, reason: '' } }));
  const totalAlloc = entries.reduce((s, e) => s + (e.amount ?? 0), 0);
  const waiverOk = entries.every((e) => !e.w.on || (e.w.reason.trim().length >= 5 && e.c.fees_due_cents > 0));
  const canApprove = !!d && ['submitted', 'in_review'].includes(d.status) && totalAlloc > 0 && !!account && waiverOk && paidOn <= today && !busy && analysis?.verdict !== undefined;
  const blocked = analysis?.verdict === 'blocked';
  const info = d ? receiptStatusInfo(d.status, { decisionReason: d.decision_reason }) : null;

  const openFile = async () => {
    if (!d?.storage_path) return;
    try { setPreview({ url: await signedUrl(RECEIPTS_BUCKET, d.storage_path, 120), image: d.content_type.startsWith('image/') }); }
    catch (e) { notifyFinanceError(e, 'Não foi possível abrir o arquivo.', 'finance_receipt_open_failed'); }
  };

  const approve = async () => {
    if (!d) return;
    const waivers = entries.filter((e) => e.w.on).map((e) => ({ chargeId: e.c.charge_id, amountCents: e.c.fees_due_cents, reason: e.w.reason.trim() }));
    const waivedTotal = waivers.reduce((s, w) => s + w.amountCents, 0);
    if (!await confirm({
      tone: blocked ? 'danger' : 'warning', title: 'Confirmar este pagamento?',
      description: `${formatBRL(totalAlloc)} em ${entries.filter((e) => e.amount).length} cobrança(s), com data de ${brDate(paidOn)}.${waivedTotal ? ` Encargos dispensados: ${formatBRL(waivedTotal)}.` : ''}${blocked ? ' ATENÇÃO: a conferência apontou bloqueios.' : ''} Fica registrado na auditoria.`,
      confirmLabel: 'Confirmar pagamento',
    })) return;
    setBusy(true);
    try {
      await approveReceipt(d.id, {
        paidOn, method, accountId: account, note: note.trim() || null,
        allocations: entries.filter((e) => e.amount).map((e) => ({ chargeId: e.c.charge_id, amountCents: e.amount! })), waivers,
      }, d.profile_id, key);
      notify.success('Comprovante aprovado e pagamento registrado.');
      renew(); onDone(); onClose();
    } catch (e) { notifyFinanceError(e, 'Não foi possível aprovar o comprovante.', 'finance_receipt_approve_failed'); }
    finally { setBusy(false); }
  };

  const reject = async () => {
    if (!d) return;
    setBusy(true);
    try { await rejectReceipt(d.id, reason.trim(), d.profile_id, key); notify.success('Comprovante recusado. O sócio foi avisado.'); renew(); onDone(); onClose(); }
    catch (e) { notifyFinanceError(e, 'Não foi possível recusar o comprovante.', 'finance_receipt_reject_failed'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={onClose} wide title={row ? `Comprovante de ${row.profile_name}` : 'Comprovante'} subtitle={d ? `Enviado em ${brDate(d.created_at.slice(0, 10))} · ${d.file_name}` : undefined}>
      {detail.loading || !d ? (detail.error ? <ErrorBlock error={detail.error} onRetry={detail.reload} /> : <Spinner />) : (
        <>
          {info && d.status !== 'submitted' && d.status !== 'in_review' && <Notice tone={d.status === 'approved' ? 'info' : 'warn'} title={info.label}>{info.nextStep}</Notice>}

          <div className="space-y-2">
            <button className={btnGhost} onClick={openFile}><FileText size={16} /> Ver comprovante</button>
            {preview && (preview.image
              ? <img src={preview.url} alt="Comprovante enviado" className="max-h-96 w-full rounded-2xl border border-stone-200 object-contain" />
              : <a href={preview.url} target="_blank" rel="noreferrer noopener" className="block text-sm font-bold text-saibro-700 underline">Abrir PDF em outra aba</a>)}
          </div>

          <dl className="space-y-1 rounded-2xl bg-stone-50 p-3 text-sm">
            <div className="flex justify-between"><dt className="text-stone-500">Valor informado pelo sócio</dt><dd className="font-bold">{d.declared_amount_cents === null ? '—' : formatBRL(d.declared_amount_cents)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Data informada</dt><dd className="font-bold">{d.declared_paid_on ? brDate(d.declared_paid_on) : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Leitura automática (sugestão)</dt><dd className="font-bold">{d.ocr_status === 'ok' ? `${ocr?.amount_cents != null ? formatBRL(ocr.amount_cents) : '—'} · ${ocr?.paid_on ? brDate(ocr.paid_on) : '—'}` : d.ocr_status === 'not_run' ? 'não executada' : 'não conseguiu ler'}</dd></div>
            {d.declared_reference && <div className="flex justify-between"><dt className="text-stone-500">Referência</dt><dd className="break-all font-mono text-xs">{d.declared_reference}</dd></div>}
            {d.member_note && <p className="border-t border-stone-200 pt-1.5 text-xs text-stone-600">Observação do sócio: {d.member_note}</p>}
          </dl>

          {analysis && (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Conferência (apenas orienta)</p>
              {analysis.flags.length === 0 && <Notice tone="info"><span className="flex items-center gap-1.5"><CheckCircle2 size={14} />Nada de estranho encontrado. Mesmo assim, confira o arquivo.</span></Notice>}
              {analysis.flags.map((f, i) => <Notice key={`${f.code}${i}`} tone={flagTone(f) === 'bad' ? 'bad' : flagTone(f) === 'warn' ? 'warn' : 'info'}>{f.message}</Notice>)}
            </div>
          )}

          {d.status !== 'submitted' && d.status !== 'in_review' ? null : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data do dinheiro" hint="Define os encargos devidos"><input type="date" className={inputCls} value={paidOn} max={today} onChange={(e) => e.target.value && setPaidOn(e.target.value)} /></Field>
                <Field label="Forma"><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
                <Field label="Conta onde entrou" className="col-span-2"><select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Escolha…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              </div>

              {stm.loading ? <Spinner /> : (
                <div className="space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Divisão do pagamento por cobrança</p>
                  {entries.map(({ c, amount, w }) => (
                    <Row key={c.charge_id}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-black capitalize">{monthLabel(c.competence_month)}</span>
                        <span className="text-xs text-stone-500">vence {brDate(c.due_date)} · {c.days_late > 0 ? `${c.days_late} dia(s) de atraso` : 'em dia'}</span>
                      </div>
                      <p className="mt-1 text-xs text-stone-500">Principal {formatBRL(c.principal_remaining_cents)}{c.fees_configured ? ` + encargos ${formatBRL(c.fees_due_cents)}` : ''} = <b>{formatBRL(c.total_due_cents)}</b> em {brDate(paidOn)}</p>
                      <div className="mt-2 grid grid-cols-2 items-end gap-2">
                        <Field label="Valor a lançar"><MoneyInput value={amount} onChange={(v) => setAlloc((a) => ({ ...a, [c.charge_id]: v }))} aria-label={`Valor para ${monthLabel(c.competence_month)}`} /></Field>
                        {c.fees_due_cents > 0 && (
                          <label className="flex min-h-11 items-center gap-2 text-xs font-bold text-stone-600">
                            <input type="checkbox" className="h-5 w-5" checked={w.on} onChange={(e) => setWaive((x) => ({ ...x, [c.charge_id]: { ...w, on: e.target.checked } }))} />
                            Dispensar {formatBRL(c.fees_due_cents)} de encargos
                          </label>
                        )}
                      </div>
                      {w.on && <Field label="Justificativa da dispensa (obrigatória)" className="mt-2"><input className={inputCls} value={w.reason} onChange={(e) => setWaive((x) => ({ ...x, [c.charge_id]: { ...w, reason: e.target.value } }))} /></Field>}
                    </Row>
                  ))}
                  <p className="text-sm font-black">Total lançado: {formatBRL(totalAlloc)}{analysis && analysis.amountCents !== null && analysis.amountCents !== totalAlloc && <span className="ml-2 text-xs font-bold text-amber-700">(comprovante: {formatBRL(analysis.amountCents)})</span>}</p>
                  {analysis && analysis.excessCents > 0 && <Notice tone="info">A sobra de {formatBRL(analysis.excessCents)} foi somada à última cobrança e ficará como <b>crédito do sócio</b>.</Notice>}
                </div>
              )}

              <LinkChargesPanel submissionId={d.id} profileId={d.profile_id} linked={d.charge_ids} onLinked={detail.reload} />

              <Field label="Observação interna (opcional)"><input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>

              {rejecting ? (
                <div className="space-y-2 rounded-2xl border border-red-200 p-3">
                  <Field label="Motivo da recusa (o sócio verá)" hint="Mínimo de 5 caracteres."><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                  <div className="flex gap-2"><button className={btnGhost} onClick={() => setRejecting(false)}>Voltar</button><button className={btnDanger} disabled={busy || reason.trim().length < 5} onClick={reject}>Recusar comprovante</button></div>
                </div>
              ) : (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button className={btnDanger} onClick={() => setRejecting(true)}>Recusar…</button>
                  <button className={btnPrimary} disabled={!canApprove} onClick={approve}>{blocked && <ShieldAlert size={16} />} Aprovar e registrar pagamento</button>
                </div>
              )}
              {blocked && <p className="text-xs text-red-700">Há bloqueios na conferência. Resolva ou recuse; aprovar mesmo assim exige confirmação extra.</p>}
            </>
          )}
        </>
      )}
    </Sheet>
  );
};

const ReceiptsTab: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const [filter, setFilter] = useState<Filter>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const q = useAsync(() => receiptQueue(filter, 200, 0), [filter]);
  const rows = q.data ?? [];
  const pendingTotal = rows.reduce((s, r) => s + (r.declared_amount_cents ?? 0), 0);

  return (
    <div className="space-y-4">
      <Notice tone="info" title="Como funciona">O sócio envia o comprovante; a leitura automática só sugere valor e data. <b>Nada é quitado até você aprovar.</b> Ao decidir, o sócio recebe o aviso.</Notice>
      <SectionTabs label="Situação" value={filter} onChange={(v) => setFilter(v as Filter)} items={FILTERS.map(([id, label]) => ({ id, label }))} />
      {filter === 'pending' && !q.error && !q.loading && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-saibro-200 bg-saibro-50/60 p-4">
          <div>
            <p className="text-sm font-black text-stone-800">{rows.length} comprovante{rows.length === 1 ? '' : 's'} aguardando · {formatBRL(pendingTotal)} informados</p>
            <p className="text-xs text-stone-500">Já conferiu o banco? Aprove todos os que bateram de uma vez.</p>
          </div>
          <button className={btnPrimary} onClick={() => setBatchOpen(true)}><CheckCheck size={16} /> Aprovar em lote</button>
        </div>
      )}
      {q.error ? <ErrorBlock error={q.error} onRetry={q.reload} /> : q.loading ? <Spinner /> : rows.length === 0 ? (
        <Empty title={filter === 'pending' ? 'Nenhum comprovante aguardando análise' : 'Nada por aqui ainda'} icon={<FileText size={28} />} />
      ) : (
        <Card>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Row onClick={() => setOpenId(r.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-stone-800">{r.profile_name}</p>
                      <p className="text-xs text-stone-500">{r.charge_count} cobrança(s) · enviado em {brDate(r.created_at.slice(0, 10))}</p>
                    </div>
                    <div className="text-right"><p className="text-sm font-black tabular-nums">{r.declared_amount_cents === null ? '—' : formatBRL(r.declared_amount_cents)}</p><p className="text-xs text-stone-500">{r.declared_paid_on ? brDate(r.declared_paid_on) : 'sem data'}</p></div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : r.status === 'in_review' ? 'warn' : 'info'}>{receiptStatusInfo(r.status).label}</Badge>
                    {r.possible_duplicate && <Badge tone="warn">Possível duplicado</Badge>}
                    {r.ocr_status !== 'ok' && r.ocr_status !== 'not_run' && <Badge tone="muted">Leitura falhou</Badge>}
                  </div>
                </Row>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <BatchApproveSheet open={batchOpen} queue={filter === 'pending' ? rows : []} onClose={() => setBatchOpen(false)} onDone={() => { q.reload(); onChanged?.(); }} onOpenOne={setOpenId} />
      <ReviewSheet id={openId} queue={rows} onClose={() => setOpenId(null)} onDone={() => { q.reload(); onChanged?.(); }} />
    </div>
  );
};

export default ReceiptsTab;
