/**
 * Aprovação de comprovantes em lote.
 *
 * Fluxo pensado para o dia em que todos os sócios já enviaram: o administrador abre
 * o extrato do banco, confere os créditos contra esta lista, marca os que bateram
 * (ou "Selecionar todos") e aprova de uma vez. Nada vem marcado de início, e só
 * entram na lista de aprovação os comprovantes que a conferência liberou; o resto
 * fica separado para ser aberto e decidido um a um. Cada aprovação é uma chamada
 * própria à mesma RPC da aprovação individual (auditada e idempotente): uma falha
 * não desfaz as outras e é mostrada ao lado do sócio.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, FileText, ShieldAlert } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { useConfirm } from '../../../hooks/useConfirm';
import { financeErrorInfo } from '../../../lib/finance/errors';
import { approveReceipt, chargeStatementsByIds, newRequestId, receiptDetail, signedUrl, RECEIPTS_BUCKET } from '../../../lib/finance/financeApi';
import type { ReceiptAnalysis } from '../../../lib/finance/receipts';
import type { ReceiptQueueRow } from '../../../lib/finance/types';
import { analyzeFromStatements, batchReadiness, duplicateCandidates, mapLimit, runSequential, type BatchReadiness } from '../../../lib/finance/batch';
import { brDate, monthLabel, type IsoDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { useAsync, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import { Badge, Empty, ErrorBlock, Field, Notice, Row, Sheet, Spinner, btnGhost, btnPrimary, inputCls } from '../ui';

const METHODS = [['pix', 'Pix'], ['transfer', 'Transferência'], ['cash', 'Dinheiro'], ['card', 'Cartão'], ['other', 'Outro']] as const;
const CONCURRENT_READS = 4;

interface Item {
  row: ReceiptQueueRow;
  storagePath: string;
  contentType: string;
  analysis: ReceiptAnalysis;
  readiness: BatchReadiness;
  /** Competências cobertas, para o administrador reconhecer o pagamento no extrato. */
  months: string[];
}
type Loaded = { items: Item[]; failed: ReceiptQueueRow[] };

export const BatchApproveSheet: React.FC<{ open: boolean; queue: ReceiptQueueRow[]; onClose: () => void; onDone: () => void; onOpenOne: (id: string) => void }> = ({ open, queue, onClose, onDone, onOpenOne }) => {
  const today = useToday();
  const { accounts, settings } = useFinance();
  const confirm = useConfirm();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState('pix');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ id: string; url: string; image: boolean } | null>(null);
  // Uma chave por comprovante, mantida até dar certo: repetir depois de uma falha de rede não duplica o pagamento.
  const keys = useRef(new Map<string, string>());

  // Cada abertura começa limpa: nada marcado, sem avisos de uma tentativa anterior.
  useEffect(() => { if (open) { setSelected(new Set()); setFailures({}); setPreview(null); } }, [open]);

  const queueKey = queue.map((q) => q.id).join(',');
  const payeeNames = settings?.payee_names;
  const pixKey = settings?.pix_key;
  const data = useAsync<Loaded>(async () => {
    if (!open) return { items: [], failed: [] };
    setProgress({ done: 0, total: queue.length });
    const res = await mapLimit(queue, CONCURRENT_READS, async (row): Promise<Item | ReceiptQueueRow> => {
      try {
        const d = await receiptDetail(row.id);
        const ocr = (d.ocr ?? null) as { paid_on?: string | null } | null;
        const paidOn = (d.declared_paid_on ?? ocr?.paid_on ?? today) as IsoDate;
        const [atPaid, now] = d.charge_ids.length === 0 ? [[], []] : await Promise.all([chargeStatementsByIds(d.charge_ids, paidOn), chargeStatementsByIds(d.charge_ids)]);
        const analysis = analyzeFromStatements({ detail: d, atPaid, now, others: duplicateCandidates(queue, row), payeeNames: payeeNames ?? [], pixKey, today });
        return { row, storagePath: d.storage_path, contentType: d.content_type, analysis, readiness: batchReadiness(analysis), months: atPaid.map((c) => monthLabel(c.competence_month)) };
      } catch { return row; }
    }, (done, total) => setProgress({ done, total }));
    setProgress(null);
    return { items: res.filter((r): r is Item => 'analysis' in r), failed: res.filter((r): r is ReceiptQueueRow => !('analysis' in r)) };
  }, [open, queueKey, payeeNames, pixKey]);

  const items = useMemo(() => data.data?.items ?? [], [data.data]);
  const ready = useMemo(() => items.filter((i) => i.readiness.status === 'ready'), [items]);
  const others = useMemo(() => items.filter((i) => i.readiness.status !== 'ready'), [items]);
  const failedReads = data.data?.failed ?? [];
  const chosen = ready.filter((i) => selected.has(i.row.id));
  const total = chosen.reduce((s, i) => s + (i.analysis.amountCents ?? 0), 0);
  const allSelected = ready.length > 0 && chosen.length === ready.length;
  const accountId = account || accounts.find((a) => a.is_default_receipts)?.id || accounts.find((a) => a.active)?.id || '';
  const accountName = accounts.find((a) => a.id === accountId)?.name ?? '';

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ready.map((i) => i.row.id)));

  const showFile = async (it: Item) => {
    if (preview?.id === it.row.id) { setPreview(null); return; }
    try { setPreview({ id: it.row.id, url: await signedUrl(RECEIPTS_BUCKET, it.storagePath, 120), image: it.contentType.startsWith('image/') }); }
    catch (e) { notify.error(financeErrorInfo(e, 'Não foi possível abrir o arquivo.').message); }
  };

  const approve = async () => {
    if (chosen.length === 0 || !accountId || busy) return;
    if (!await confirm({
      tone: 'warning', title: `Aprovar ${chosen.length} pagamento${chosen.length === 1 ? '' : 's'}?`,
      description: `Total de ${formatBRL(total)}, entrando em “${accountName}”. Confirme que este total e cada valor da lista batem com o extrato do banco. Cada aprovação fica registrada na auditoria e os sócios são avisados.`,
      confirmLabel: `Aprovar ${chosen.length}`,
    })) return;
    setBusy(true); setFailures({});
    const results = await runSequential(chosen, (it) => {
      if (!keys.current.has(it.row.id)) keys.current.set(it.row.id, newRequestId());
      return approveReceipt(it.row.id, {
        paidOn: it.analysis.paidOn!, method, accountId, note: null, waivers: [],
        allocations: it.analysis.allocation.filter((a) => a.amountCents > 0).map((a) => ({ chargeId: a.chargeId, amountCents: a.amountCents })),
      }, it.row.profile_id, keys.current.get(it.row.id));
    }, (done, totalCount) => setProgress({ done, total: totalCount }));
    setProgress(null); setBusy(false);

    const okIds = results.filter((r) => r.ok).map((r) => r.item.row.id);
    okIds.forEach((id) => keys.current.delete(id));
    const bad = results.filter((r) => !r.ok);
    setFailures(Object.fromEntries(bad.map((r) => [r.item.row.id, financeErrorInfo(r.error, 'Não foi possível aprovar.').message])));
    setSelected((s) => { const n = new Set(s); okIds.forEach((id) => n.delete(id)); return n; });
    if (okIds.length > 0) {
      notify.success(`${okIds.length} pagamento${okIds.length === 1 ? '' : 's'} aprovado${okIds.length === 1 ? '' : 's'}.`, { description: bad.length ? `${bad.length} não ${bad.length === 1 ? 'passou' : 'passaram'}: veja o motivo na lista.` : undefined });
      onDone();
    } else notify.error('Nenhum pagamento foi aprovado.', { description: 'Veja o motivo ao lado de cada sócio.' });
    if (bad.length === 0) onClose();
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} wide closeOnBackdrop={false} title="Aprovar comprovantes em lote"
      subtitle="Confira no extrato do banco, marque os que bateram e aprove de uma vez."
      footer={(
        <>
          <p className="self-center text-sm font-black text-stone-700 sm:mr-auto" aria-live="polite">
            {chosen.length === 0 ? 'Nenhum selecionado' : `${chosen.length} selecionado${chosen.length === 1 ? '' : 's'} · ${formatBRL(total)}`}
          </p>
          <button className={btnGhost} onClick={onClose} disabled={busy}>Fechar</button>
          <button className={btnPrimary} disabled={busy || chosen.length === 0 || !accountId} onClick={approve}><CheckCheck size={16} /> {busy && progress ? `Aprovando ${progress.done} de ${progress.total}…` : chosen.length === 0 ? 'Aprovar selecionados' : `Aprovar ${chosen.length} selecionado${chosen.length === 1 ? '' : 's'}`}</button>
        </>
      )}>
      {data.error ? <ErrorBlock error={data.error} onRetry={data.reload} /> : data.loading ? (
        <Spinner label={progress ? `Conferindo comprovantes… ${progress.done} de ${progress.total}` : 'Conferindo comprovantes…'} />
      ) : (
        <>
          <Notice tone="info" title="Como usar">
            A leitura automática só confere; <b>quem confirma é você</b>, olhando o banco. Aqui aparecem prontos os comprovantes cujo valor é igual ao devido na data do pagamento. Os demais precisam ser abertos um a um.
          </Notice>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Conta onde entrou" hint="Vale para todos os selecionados"><select className={inputCls} value={accountId} onChange={(e) => setAccount(e.target.value)} disabled={busy}><option value="">Escolha…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Forma"><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)} disabled={busy}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          </div>

          {ready.length === 0 ? (
            <Empty title="Nenhum comprovante pronto para o lote" hint={others.length ? 'Os que aguardam estão logo abaixo, para conferência individual.' : 'Quando os sócios enviarem, eles aparecem aqui.'} icon={<FileText size={28} />} />
          ) : (
            <div className="space-y-2">
              <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-saibro-200 bg-saibro-50/60 px-3 text-sm font-black text-stone-800">
                <input type="checkbox" className="h-5 w-5" checked={allSelected} onChange={toggleAll} disabled={busy} />
                Selecionar todos os prontos ({ready.length}) · {formatBRL(ready.reduce((s, i) => s + (i.analysis.amountCents ?? 0), 0))}
              </label>
              <ul className="space-y-2">
                {ready.map((it) => (
                  <li key={it.row.id}>
                    <Row>
                      <div className="flex items-start gap-3">
                        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={selected.has(it.row.id)} onChange={() => toggle(it.row.id)} disabled={busy} aria-label={`Selecionar comprovante de ${it.row.profile_name}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-stone-800">{it.row.profile_name}</p>
                              <p className="text-xs capitalize text-stone-500">{it.months.join(', ')}</p>
                            </div>
                            <div className="text-right"><p className="text-sm font-black tabular-nums">{formatBRL(it.analysis.amountCents ?? 0)}</p><p className="text-xs text-stone-500">{it.analysis.paidOn ? brDate(it.analysis.paidOn) : '—'}</p></div>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <Badge tone="good">Valor confere</Badge>
                            {it.analysis.flags.some((f) => f.code === 'paid_after_due') && <Badge tone="warn">Pago após o vencimento</Badge>}
                            {it.analysis.flags.some((f) => f.code === 'amount_edited') && <Badge tone="warn">Valor corrigido pelo sócio</Badge>}
                            <button className="min-h-11 px-1 text-xs font-bold text-saibro-700 underline" onClick={() => showFile(it)}>{preview?.id === it.row.id ? 'Ocultar comprovante' : 'Ver comprovante'}</button>
                          </div>
                          {failures[it.row.id] && <p className="mt-1 text-xs font-bold text-red-700" role="alert">Não aprovado: {failures[it.row.id]}</p>}
                          {preview?.id === it.row.id && (preview.image
                            ? <img src={preview.url} alt={`Comprovante de ${it.row.profile_name}`} className="mt-2 max-h-80 w-full rounded-2xl border border-stone-200 object-contain" />
                            : <a href={preview.url} target="_blank" rel="noreferrer noopener" className="mt-2 block text-sm font-bold text-saibro-700 underline">Abrir PDF em outra aba</a>)}
                        </div>
                      </div>
                    </Row>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(others.length > 0 || failedReads.length > 0) && (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Conferir individualmente ({others.length + failedReads.length})</p>
              {others.map((it) => (
                <Row key={it.row.id} onClick={() => { onClose(); onOpenOne(it.row.id); }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-black text-stone-800">{it.row.profile_name}</p><p className="text-xs text-stone-500">{it.row.declared_amount_cents === null ? 'sem valor informado' : formatBRL(it.row.declared_amount_cents)}</p></div>
                    <Badge tone={it.readiness.status === 'blocked' ? 'bad' : 'warn'}>{it.readiness.status === 'blocked' ? 'Bloqueado' : 'Conferir'}</Badge>
                  </div>
                  {it.readiness.reason && <p className="mt-1 flex items-start gap-1 text-xs text-stone-600">{it.readiness.status === 'blocked' && <ShieldAlert size={14} className="mt-0.5 shrink-0 text-red-600" />}{it.readiness.reason}</p>}
                </Row>
              ))}
              {failedReads.map((r) => (
                <Row key={r.id} onClick={() => { onClose(); onOpenOne(r.id); }}>
                  <p className="text-sm font-black text-stone-800">{r.profile_name}</p>
                  <p className="text-xs text-stone-600">Não foi possível conferir agora. Abra o comprovante para decidir.</p>
                </Row>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
};
