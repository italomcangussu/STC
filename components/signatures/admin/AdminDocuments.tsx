/**
 * Seção "Documentos" do painel admin: lista dos documentos para assinatura, criação, publicação e
 * acompanhamento. A regra toda (papel, imutabilidade, fila de avisos) está no banco e na função de borda;
 * esta tela só conduz o administrador e mostra o resultado.
 *
 * Publicar = `sig_publish` (enfileira 1 WhatsApp por sócio) e, em seguida, despacha a fila em voltas. Se o
 * despacho falhar (função de borda fora do ar), o documento FICA publicado e os avisos seguem na fila: o
 * agendador os envia, ou o admin usa "Enviar avisos agora".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, FilePlus2, FileSignature, FileText } from 'lucide-react';
import {
  adminErrorMessage, deleteDraft, drainNotifications, listAdminDocuments, type OverviewRow, type PublishResult,
} from '../../../lib/signatures/admin';
import { dueInfo, formatDate } from '../../../lib/signatures/format';
import { useConfirm } from '../../../hooks/useConfirm';
import { Badge, Notice, Spinner, btnGhost, btnPrimary } from '../ui';
import { DocumentDetail } from './DocumentDetail';
import { DocumentForm, type FormTarget } from './DocumentForm';

type View = { kind: 'list' } | { kind: 'form'; target: FormTarget } | { kind: 'detail'; id: string };

const Card: React.FC<{ doc: OverviewRow; onOpen: () => void }> = ({ doc, onOpen }) => {
  const draft = doc.status === 'draft';
  const due = !draft && doc.status === 'published' ? dueInfo(doc.due_at) : null;
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-3xl border border-stone-100 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] hover:border-saibro-200">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-saibro-50 text-saibro-600" aria-hidden><FileText size={22} /></span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-sm font-black text-stone-800">{doc.title}</span>
        <span className="block text-xs text-stone-500">
          versão {doc.version} · {doc.page_count} {doc.page_count === 1 ? 'página' : 'páginas'}
          {draft ? ` · criado em ${formatDate(doc.created_at)}` : ` · ${doc.signed} de ${doc.recipients} assinaram`}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {draft && <Badge tone="neutral">Rascunho</Badge>}
          {doc.status === 'archived' && <Badge tone="neutral">Arquivado</Badge>}
          {!draft && doc.recipients > 0 && doc.signed === doc.recipients && <Badge tone="good">Todos assinaram</Badge>}
          {due && due.tone !== 'neutral' && <Badge tone={due.tone === 'bad' ? 'bad' : 'warn'}>{due.label.split(' (')[0]}</Badge>}
          {doc.notifications_failed > 0 && <Badge tone="bad">{doc.notifications_failed} {doc.notifications_failed === 1 ? 'falha de envio' : 'falhas de envio'}</Badge>}
          {doc.no_phone > 0 && <Badge tone="warn">{doc.no_phone} sem telefone</Badge>}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-stone-300" aria-hidden />
    </button>
  );
};

const Group: React.FC<{ label: string; docs: OverviewRow[]; onOpen: (d: OverviewRow) => void }> = ({ label, docs, onOpen }) => (
  docs.length === 0 ? null : (
    <section className="space-y-2" aria-label={label}>
      <h3 className="px-1 text-xs font-black uppercase tracking-wide text-stone-400">{label} ({docs.length})</h3>
      {docs.map((d) => <Card key={d.id} doc={d} onOpen={() => onOpen(d)} />)}
    </section>
  )
);

export const AdminDocuments: React.FC = () => {
  const confirm = useConfirm();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [docs, setDocs] = useState<OverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'warn' | 'bad'; text: string } | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setDocs(await listAdminDocuments()); setError(null); } catch (e) { setError(adminErrorMessage(e, 'Não foi possível carregar os documentos.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const back = () => { setView({ kind: 'list' }); void load(); };

  const afterPublish = async (id: string, result: PublishResult) => {
    await load();
    setView({ kind: 'detail', id });
    setPublishing('Publicado. Enviando os avisos pelo WhatsApp…');
    const head = `Documento publicado para ${result.recipients} ${result.recipients === 1 ? 'sócio' : 'sócios'}${result.skippedNoPhone ? ` (${result.skippedNoPhone} sem telefone, sem aviso)` : ''}.`;
    try {
      const r = await drainNotifications({ onProgress: (p) => setPublishing(`Publicado. Avisos enviados: ${p.sent}${p.failed ? ` · falhas: ${p.failed}` : ''}…`) });
      if (!r.configured) setNotice({ tone: 'warn', text: `${head} O WhatsApp do clube não está configurado no servidor: os avisos ficaram na fila.` });
      else setNotice({ tone: r.failed > 0 ? 'warn' : 'good', text: `${head} ${r.sent} ${r.sent === 1 ? 'aviso enviado' : 'avisos enviados'}${r.failed ? `, ${r.failed} com falha (use "Reenviar falhas")` : ''}${r.finished ? '.' : '; o restante sai pelo agendador.'}` });
    } catch (e) {
      setNotice({ tone: 'warn', text: `${head} Não foi possível enviar os avisos agora (${adminErrorMessage(e, 'função de envio indisponível')}). Eles continuam na fila e saem pelo agendador, ou toque em "Enviar avisos agora".` });
    } finally {
      setPublishing(null);
      void load();
    }
  };

  const discard = async (d: OverviewRow) => {
    const ok = await confirm({
      title: 'Apagar este rascunho?', description: `"${d.title}" ainda não foi publicado; nenhum sócio o viu.`,
      consequences: ['O rascunho e o PDF anexado serão apagados.'], confirmLabel: 'Apagar rascunho', tone: 'danger',
    });
    if (!ok) return;
    try { await deleteDraft(d.id); setNotice({ tone: 'good', text: 'Rascunho apagado.' }); } catch (e) { setNotice({ tone: 'bad', text: adminErrorMessage(e) }); }
    void load();
  };

  if (view.kind === 'form') {
    return (
      <DocumentForm
        target={view.target}
        onCancel={back}
        onSaved={() => { setNotice({ tone: 'good', text: 'Rascunho salvo. Ele só vai para os sócios quando você publicar.' }); setView({ kind: 'list' }); void load(); }}
        onPublished={(id, result) => void afterPublish(id, result)}
      />
    );
  }

  if (view.kind === 'detail') {
    const doc = docs?.find((d) => d.id === view.id);
    return (
      <div className="space-y-3">
        {publishing && <Notice tone="info">{publishing}</Notice>}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {doc ? <DocumentDetail key={doc.id} doc={doc} onBack={() => { setNotice(null); back(); }} onChanged={() => void load()} onNewVersion={(of) => { setNotice(null); setView({ kind: 'form', target: { kind: 'version', of } }); }} />
          : docs === null ? <Spinner /> : <Notice tone="warn" action={<button type="button" className={btnGhost} onClick={back}>Voltar</button>}>Documento não encontrado.</Notice>}
      </div>
    );
  }

  const drafts = (docs ?? []).filter((d) => d.status === 'draft');
  const published = (docs ?? []).filter((d) => d.status === 'published');
  const archived = (docs ?? []).filter((d) => d.status === 'archived');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-black text-stone-800"><FileSignature size={20} className="text-saibro-600" aria-hidden /> Documentos e Assinaturas</h2>
          <p className="text-sm text-stone-500">Publique um PDF e acompanhe quem já assinou. Cada sócio recebe o link no WhatsApp.</p>
        </div>
        <button type="button" className={`${btnPrimary} w-full sm:w-auto`} onClick={() => { setNotice(null); setView({ kind: 'form', target: { kind: 'new' } }); }}>
          <FilePlus2 size={16} aria-hidden /> Novo documento
        </button>
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {error && <Notice tone="bad" action={<button type="button" className={btnGhost} onClick={() => void load()}>Tentar de novo</button>}>{error}</Notice>}
      {docs === null && !error && <Spinner />}
      {docs !== null && docs.length === 0 && (
        <div className="rounded-3xl border border-dashed border-stone-200 p-8 text-center text-sm text-stone-500">
          Nenhum documento ainda. Toque em <b>Novo documento</b> para publicar o primeiro (termo, regimento, autorização…).
        </div>
      )}

      <Group label="Rascunhos" docs={drafts} onOpen={(d) => setView({ kind: 'form', target: { kind: 'draft', doc: d } })} />
      {drafts.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-1 text-xs" aria-label="Apagar rascunho">
          {drafts.map((d) => (
            <li key={d.id}><button type="button" className="min-h-9 font-bold text-red-700 underline-offset-2 hover:underline" onClick={() => void discard(d)}>Apagar rascunho "{d.title}"</button></li>
          ))}
        </ul>
      )}
      <Group label="Publicados" docs={published} onOpen={(d) => setView({ kind: 'detail', id: d.id })} />
      <Group label="Arquivados" docs={archived} onOpen={(d) => setView({ kind: 'detail', id: d.id })} />
    </div>
  );
};

export default AdminDocuments;
