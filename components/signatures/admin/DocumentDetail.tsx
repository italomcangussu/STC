/**
 * Acompanhamento de um documento publicado ou arquivado (administrador): quem assinou, quem falta, como
 * foi o aviso de cada um, e as ações que ainda valem depois de publicar (reenviar falhas, enviar avisos
 * agora, prazo, incluir sócios, nova versão, arquivar, conferir a integridade das assinaturas).
 *
 * Nada aqui decide regra: cada botão chama uma função do banco que confere o papel e o estado.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CalendarClock, CheckCircle2, FilePlus2, Loader2, RefreshCw, Send, ShieldCheck, UserPlus, UserX } from 'lucide-react';
import {
  addRecipients, adminErrorMessage, archiveDocument, drainNotifications, listRecipients, listSignableMembers, removeRecipient, resendFailed,
  updateDue, verifyIntegrity, type IntegrityResult, type MemberOption, type OverviewRow, type RecipientRow,
} from '../../../lib/signatures/admin';
import { downloadDocumentFile } from '../../../lib/signatures/documents';
import { dueInfo, endOfClubDay, formatDate, formatDateTime, toDateInput, todayInput } from '../../../lib/signatures/format';
import { supabase } from '../../../lib/supabase';
import { useConfirm } from '../../../hooks/useConfirm';
import { Badge, Notice, Spinner, btnGhost, btnPrimary, inputCls } from '../ui';

type Props = {
  doc: OverviewRow;
  onBack: () => void;
  /** O resumo da lista mudou (assinou, arquivou…): quem chama recarrega. */
  onChanged: () => void;
  onNewVersion: (doc: OverviewRow) => void;
};

type Filter = 'all' | 'missing' | 'signed';

const notificationLabel = (r: RecipientRow): { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } => {
  if (!r.phone?.trim()) return { text: 'Sem telefone', tone: 'warn' };
  switch (r.notification_status) {
    case 'sent': return { text: 'Aviso enviado', tone: 'good' };
    case 'queued': case 'sending': return { text: 'Aviso na fila', tone: 'neutral' };
    case 'failed': return { text: 'Falha no envio', tone: 'bad' };
    case 'skipped': return { text: 'Aviso não enviado', tone: 'warn' };
    default: return { text: 'Sem aviso', tone: 'neutral' };
  }
};

export const DocumentDetail: React.FC<Props> = ({ doc, onBack, onChanged, onNewVersion }) => {
  const confirm = useConfirm();
  const [rows, setRows] = useState<RecipientRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [editingDue, setEditingDue] = useState(false);
  const [dueValue, setDueValue] = useState(toDateInput(doc.due_at));
  const [adding, setAdding] = useState<MemberOption[] | null>(null);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());

  const published = doc.status === 'published';

  const load = useCallback(async () => {
    try { setRows(await listRecipients(doc.id)); setLoadError(null); } catch (e) { setLoadError(adminErrorMessage(e, 'Não foi possível carregar os destinatários.')); }
  }, [doc.id]);
  useEffect(() => { void load(); }, [load]);

  const signed = rows?.filter((r) => r.signed_at).length ?? doc.signed;
  const total = rows?.length ?? doc.recipients;
  const failed = rows?.filter((r) => !r.signed_at && r.notification_status === 'failed').length ?? doc.notifications_failed;
  const queued = rows?.filter((r) => !r.signed_at && (r.notification_status === 'queued' || r.notification_status === 'sending')).length ?? doc.notifications_pending;
  const shown = useMemo(() => (rows ?? []).filter((r) => filter === 'all' || (filter === 'signed' ? r.signed_at : !r.signed_at)), [rows, filter]);

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key); setMessage(null);
    try {
      const text = await action();
      if (text) setMessage({ tone: 'good', text });
      await load();
      onChanged();
    } catch (e) {
      setMessage({ tone: 'bad', text: adminErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const sendNow = () => run('send', async () => {
    const r = await drainNotifications();
    if (!r.configured) return 'O WhatsApp do clube não está configurado nas funções do servidor. Os avisos continuam na fila.';
    return r.finished
      ? `Fila esvaziada: ${r.sent} ${r.sent === 1 ? 'aviso enviado' : 'avisos enviados'}${r.failed ? `, ${r.failed} com falha` : ''}.`
      : `${r.sent} enviados nesta rodada. O restante sai pelo agendador a cada poucos minutos, ou toque de novo.`;
  });

  const resend = () => run('resend', async () => {
    const n = await resendFailed(doc.id);
    if (n === 0) return 'Nenhuma falha para reenviar.';
    const r = await drainNotifications();
    return `${n} ${n === 1 ? 'aviso voltou' : 'avisos voltaram'} para a fila; ${r.sent} enviados agora.`;
  });

  const archive = async () => {
    const ok = await confirm({
      title: 'Arquivar este documento?',
      description: `"${doc.title}" deixa de aparecer para quem ainda não assinou e os lembretes param.`,
      consequences: ['As assinaturas já feitas continuam valendo e visíveis para quem assinou.', 'Não dá para reabrir; para voltar a pedir assinaturas, crie uma nova versão.'],
      confirmLabel: 'Arquivar', tone: 'warning',
    });
    if (!ok) return;
    await run('archive', async () => { await archiveDocument(doc.id); return 'Documento arquivado.'; });
  };

  const removeOne = async (r: RecipientRow) => {
    const ok = await confirm({
      title: `Tirar ${r.name} da lista?`, description: 'Ele deixa de precisar assinar este documento e o aviso pendente é cancelado.',
      confirmLabel: 'Tirar da lista', tone: 'warning',
    });
    if (ok) await run(`rm-${r.profile_id}`, async () => { await removeRecipient(doc.id, r.profile_id); return `${r.name} saiu da lista.`; });
  };

  const saveDue = () => run('due', async () => {
    await updateDue(doc.id, endOfClubDay(dueValue));
    setEditingDue(false);
    return dueValue ? `Prazo alterado para ${formatDate(endOfClubDay(dueValue))}.` : 'Prazo removido.';
  });

  const openAdd = async () => {
    setMessage(null);
    try { setAdding(await listSignableMembers()); setToAdd(new Set()); } catch (e) { setMessage({ tone: 'bad', text: adminErrorMessage(e) }); }
  };
  const candidates = useMemo(() => (adding ?? []).filter((m) => !(rows ?? []).some((r) => r.profile_id === m.id)), [adding, rows]);
  const confirmAdd = () => run('add', async () => {
    const r = await addRecipients(doc.id, [...toAdd]);
    setAdding(null);
    const sent = await drainNotifications().catch(() => null);
    return `${r.added} ${r.added === 1 ? 'sócio incluído' : 'sócios incluídos'}${r.skippedNoPhone ? ` (${r.skippedNoPhone} sem telefone)` : ''}${sent ? `; ${sent.sent} avisos enviados.` : '; os avisos saem pelo agendador.'}`;
  });

  const checkIntegrity = () => run('integrity', async () => { setIntegrity(await verifyIntegrity(doc.id)); });

  const openPdf = () => run('pdf', async () => {
    const { data } = await supabase.from('sig_documents').select('storage_path').eq('id', doc.id).maybeSingle();
    const path = (data as { storage_path?: string } | null)?.storage_path;
    if (!path) throw new Error('SIG_NOT_FOUND');
    const bytes = await downloadDocumentFile(path);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });

  const due = dueInfo(doc.due_at);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <button type="button" className="min-h-9 text-xs font-black text-saibro-700" onClick={onBack}>← Todos os documentos</button>
          <h2 className="text-lg font-black leading-tight text-stone-800">{doc.title}</h2>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
            <Badge tone={published ? 'good' : 'neutral'}>{published ? 'Publicado' : 'Arquivado'}</Badge>
            versão {doc.version} · {doc.page_count} {doc.page_count === 1 ? 'página' : 'páginas'}
            {doc.published_at && <> · publicado em {formatDate(doc.published_at)}</>}
          </p>
        </div>
      </div>

      <section className="space-y-2 rounded-3xl border border-stone-100 bg-white p-4 shadow-sm" aria-label="Resumo">
        <div className="flex items-end justify-between">
          <p className="text-2xl font-black text-stone-800">{signed}<span className="text-base font-bold text-stone-400"> de {total} assinaram</span></p>
          {total > 0 && <span className="text-sm font-black text-saibro-700">{Math.round((signed / total) * 100)}%</span>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={signed} aria-label="Assinaturas">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${total ? (signed / total) * 100 : 0}%` }} />
        </div>
        <p className="text-xs text-stone-500">
          {due ? due.label : 'Sem prazo'}{doc.applies_to_new_members && ' · vale para sócio novo'}
        </p>
      </section>

      {message && <Notice tone={message.tone === 'bad' ? 'bad' : message.tone === 'good' ? 'good' : 'info'}>{message.text}</Notice>}
      {integrity && (
        <Notice tone={integrity.ok ? 'good' : 'bad'} title={integrity.ok ? 'Assinaturas íntegras' : 'Atenção: inconsistência nas assinaturas'}>
          {integrity.ok
            ? `${integrity.checked} ${integrity.checked === 1 ? 'assinatura conferida' : 'assinaturas conferidas'}: nenhuma foi alterada ou removida.`
            : `Foram encontrados ${integrity.problems.length} problemas (${integrity.problems.map((p) => `#${p.seq} ${p.problem}`).join(', ')}). Não altere nada e chame quem cuida do sistema.`}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Ações do documento">
        {published && failed > 0 && <button type="button" className={btnPrimary} onClick={() => void resend()} disabled={busy !== null}><RefreshCw size={16} aria-hidden /> Reenviar {failed} {failed === 1 ? 'falha' : 'falhas'}</button>}
        {published && queued > 0 && <button type="button" className={btnPrimary} onClick={() => void sendNow()} disabled={busy !== null}><Send size={16} aria-hidden /> Enviar {queued} {queued === 1 ? 'aviso' : 'avisos'} agora</button>}
        {published && <button type="button" className={btnGhost} onClick={() => setEditingDue((v) => !v)} disabled={busy !== null}><CalendarClock size={16} aria-hidden /> Prazo</button>}
        {published && <button type="button" className={btnGhost} onClick={() => void openAdd()} disabled={busy !== null}><UserPlus size={16} aria-hidden /> Incluir sócios</button>}
        <button type="button" className={btnGhost} onClick={() => onNewVersion(doc)} disabled={busy !== null}><FilePlus2 size={16} aria-hidden /> Nova versão</button>
        <button type="button" className={btnGhost} onClick={() => void openPdf()} disabled={busy !== null}>Ver PDF</button>
        <button type="button" className={btnGhost} onClick={() => void checkIntegrity()} disabled={busy !== null}>{busy === 'integrity' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ShieldCheck size={16} aria-hidden />} Conferir integridade</button>
        {published && <button type="button" className={btnGhost} onClick={() => void archive()} disabled={busy !== null}><Archive size={16} aria-hidden /> Arquivar</button>}
      </div>

      {editingDue && (
        <section className="space-y-2 rounded-3xl border border-stone-100 bg-white p-4" aria-label="Alterar prazo">
          <label className="block space-y-1 text-sm font-bold text-stone-700">Novo prazo
            <input type="date" className={inputCls} value={dueValue} min={todayInput()} onChange={(e) => setDueValue(e.target.value)} />
          </label>
          <p className="text-xs text-stone-500">Deixe vazio para tirar o prazo. Os lembretes passam a seguir a nova data.</p>
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} onClick={() => void saveDue()} disabled={busy !== null}>Salvar prazo</button>
            <button type="button" className={btnGhost} onClick={() => setEditingDue(false)}>Cancelar</button>
          </div>
        </section>
      )}

      {adding && (
        <section className="space-y-2 rounded-3xl border border-stone-100 bg-white p-4" aria-label="Incluir sócios">
          <p className="text-sm font-black text-stone-700">Quem mais deve assinar?</p>
          {candidates.length === 0 ? <p className="text-xs text-stone-500">Todos os sócios ativos já estão na lista.</p> : (
            <ul className="max-h-60 divide-y divide-stone-100 overflow-y-auto rounded-2xl border border-stone-100">
              {candidates.map((m) => (
                <li key={m.id}>
                  <label className="flex min-h-11 items-center gap-3 px-3 text-sm text-stone-700">
                    <input type="checkbox" className="h-4 w-4 accent-saibro-600" checked={toAdd.has(m.id)}
                      onChange={() => setToAdd((p) => { const n = new Set(p); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} />
                    <span className="min-w-0 flex-1 truncate font-bold">{m.name}</span>
                    {!m.phone?.trim() && <span className="text-[11px] font-bold text-amber-700">sem telefone</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={toAdd.size === 0 || busy !== null} onClick={() => void confirmAdd()}>Incluir e avisar ({toAdd.size})</button>
            <button type="button" className={btnGhost} onClick={() => setAdding(null)}>Cancelar</button>
          </div>
        </section>
      )}

      <section aria-label="Destinatários" className="space-y-2">
        <div className="flex gap-1.5" role="tablist" aria-label="Filtrar destinatários">
          {([['all', `Todos (${total})`], ['missing', `Faltam (${total - signed})`], ['signed', `Assinaram (${signed})`]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
              className={`min-h-10 rounded-full px-3 text-xs font-black transition ${filter === id ? 'bg-saibro-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>{label}</button>
          ))}
        </div>
        {loadError ? <Notice tone="bad" action={<button type="button" className={btnGhost} onClick={() => void load()}>Tentar de novo</button>}>{loadError}</Notice>
          : rows === null ? <Spinner label="Carregando destinatários…" /> : (
            <ul className="space-y-2">
              {shown.map((r) => {
                const n = notificationLabel(r);
                return (
                  <li key={r.profile_id} className="flex items-center gap-3 rounded-2xl border border-stone-100 bg-white p-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${r.signed_at ? 'bg-emerald-50 text-emerald-600' : 'bg-stone-100 text-stone-400'}`} aria-hidden>
                      {r.signed_at ? <CheckCircle2 size={18} /> : <span className="text-xs font-black">{r.name.slice(0, 1).toUpperCase()}</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black text-stone-800">{r.name}</span>
                      <span className="block text-xs text-stone-500">
                        {r.signed_at ? `Assinou em ${formatDateTime(r.signed_at)}`
                          : <>{n.text}{r.last_notified_at && ` em ${formatDateTime(r.last_notified_at)}`}{r.reminders_sent > 0 && ` · ${r.reminders_sent} ${r.reminders_sent === 1 ? 'lembrete' : 'lembretes'}`}</>}
                      </span>
                      {!r.signed_at && r.notification_status === 'failed' && r.notification_error && <span className="block truncate text-[11px] text-red-700">{r.notification_error}</span>}
                    </span>
                    {r.signed_at ? <Badge tone="good">Assinou</Badge> : <Badge tone={n.tone}>{n.tone === 'good' ? 'Pendente' : n.text}</Badge>}
                    {published && !r.signed_at && (
                      <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-400 transition hover:bg-red-50 hover:text-red-600" aria-label={`Tirar ${r.name} da lista`} onClick={() => void removeOne(r)} disabled={busy !== null}>
                        <UserX size={18} aria-hidden />
                      </button>
                    )}
                  </li>
                );
              })}
              {shown.length === 0 && <li className="rounded-2xl border border-dashed border-stone-200 p-6 text-center text-sm text-stone-400">Ninguém nesta lista.</li>}
            </ul>
          )}
      </section>
    </div>
  );
};
