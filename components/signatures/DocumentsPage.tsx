/**
 * Aba "Documentos e Assinaturas" (sócios e administradores, que também assinam).
 *
 * A lista mostra o que a pessoa deve assinar e o que já assinou. Cada documento tem link próprio
 * (`/#documentos/<id>`, o do WhatsApp): o link abre direto a leitura, e o botão voltar do aparelho
 * volta à lista. Só lê o que o banco entrega para esta pessoa (RLS); nada é decidido aqui.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, FileSignature, FileText, ListChecks } from 'lucide-react';
import type { User } from '../../types';
import { documentErrorMessage, listMyDocuments, type MyDocumentRow } from '../../lib/signatures/documents';
import { documentsHash, parseDocumentsHash } from '../../lib/signatures/routes';
import { SIGNATURES_CHANGED_EVENT } from '../../lib/signatures/usePendingSignatures';
import { dueInfo, formatDate } from '../../lib/signatures/format';
import { DocumentSigning } from './DocumentSigning';
import { Badge, Notice, Spinner, btnGhost } from './ui';

const currentDocumentId = () => (typeof window === 'undefined' ? null : parseDocumentsHash(window.location.hash)?.documentId ?? null);

const HowItWorks: React.FC = () => (
  <details className="rounded-2xl border border-stone-100 bg-white p-3 text-xs text-stone-600">
    <summary className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-black text-stone-700"><ListChecks size={16} aria-hidden /> Como funciona a assinatura?</summary>
    <ol className="mt-2 list-decimal space-y-1 pl-6 leading-relaxed">
      <li>Abra o documento e <b>leia até o fim</b>.</li>
      <li>Marque <b>"Li e concordo"</b> e confirme o seu CPF.</li>
      <li>Toque em <b>"Assinar digitalmente"</b>. Você receberá um código de 6 dígitos no WhatsApp.</li>
      <li>Digite o código no app. Pronto: a assinatura fica registrada com dia, hora e local.</li>
    </ol>
  </details>
);

const DocumentCard: React.FC<{ doc: MyDocumentRow; onOpen: () => void }> = ({ doc, onOpen }) => {
  const signed = Boolean(doc.signed_at);
  const due = signed ? null : dueInfo(doc.due_at);
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-3xl border border-stone-100 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] hover:border-saibro-200">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${signed ? 'bg-emerald-50 text-emerald-600' : 'bg-saibro-50 text-saibro-600'}`} aria-hidden>
        <FileText size={22} />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-sm font-black text-stone-800">{doc.title}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {signed ? <Badge tone="good">Assinado em {formatDate(doc.signed_at)}</Badge> : <Badge tone="warn">Pendente</Badge>}
          {due && <Badge tone={due.tone}>{due.label}</Badge>}
        </span>
        <span className="block text-[11px] text-stone-400">{doc.page_count} {doc.page_count === 1 ? 'página' : 'páginas'} · versão {doc.version}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-saibro-700">{signed ? 'Ver' : 'Ler e assinar'}<ChevronRight size={16} aria-hidden /></span>
    </button>
  );
};

export const DocumentsPage: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [documentId, setDocumentId] = useState<string | null>(currentDocumentId);
  const [docs, setDocs] = useState<MyDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMember = currentUser.role === 'socio' || currentUser.role === 'admin';

  const load = useCallback(async () => {
    try {
      setDocs(await listMyDocuments());
      setError(null);
    } catch (e) {
      setError(documentErrorMessage(e, 'Não foi possível carregar os seus documentos. Tente de novo.'));
    }
  }, []);

  useEffect(() => { if (isMember) void load(); }, [isMember, load]);

  // O link do WhatsApp e o botão voltar do aparelho mudam só o `#`.
  useEffect(() => {
    const sync = () => setDocumentId(currentDocumentId());
    window.addEventListener('hashchange', sync);
    window.addEventListener(SIGNATURES_CHANGED_EVENT, load);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener(SIGNATURES_CHANGED_EVENT, load); };
  }, [load]);

  const open = (id: string | null) => { window.location.hash = documentsHash(id); };

  if (!isMember) {
    return <Notice tone="warn" title="Só para sócios">Documentos para assinatura são enviados aos sócios do clube.</Notice>;
  }

  const selected = documentId && docs ? docs.find((d) => d.document_id === documentId) ?? null : null;

  if (documentId && selected) {
    return <DocumentSigning key={selected.document_id} doc={selected} currentUser={currentUser} onBack={() => open(null)} />;
  }

  const pending = (docs ?? []).filter((d) => !d.signed_at);
  const done = (docs ?? []).filter((d) => d.signed_at);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-black text-stone-800"><FileSignature size={22} className="text-saibro-600" aria-hidden /> Documentos e Assinaturas</h2>
        <p className="text-sm text-stone-500">Leia e assine, pelo celular, os documentos do clube.</p>
      </header>

      {documentId && docs && !selected && (
        <Notice tone="warn" title="Documento indisponível" action={<button type="button" className={btnGhost} onClick={() => open(null)}>Ver meus documentos</button>}>
          Este documento não está disponível para você. Ele pode ter sido encerrado, ou não ter sido enviado para o seu cadastro.
        </Notice>
      )}

      {error && <Notice tone="bad" action={<button type="button" className={btnGhost} onClick={() => void load()}>Tentar de novo</button>}>{error}</Notice>}
      {!docs && !error && <Spinner label="Carregando documentos…" />}

      {docs && (
        <>
          <HowItWorks />
          {docs.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-stone-200 px-4 py-10 text-center">
              <FileSignature className="text-stone-300" size={28} aria-hidden />
              <p className="text-sm font-bold text-stone-600">Nenhum documento por aqui</p>
              <p className="max-w-sm text-xs text-stone-400">Quando o clube enviar um documento para você assinar, ele aparece aqui e você recebe um aviso no WhatsApp.</p>
            </div>
          )}
          {pending.length > 0 && (
            <section className="space-y-2" aria-label="Documentos pendentes">
              <h3 className="text-[11px] font-black uppercase tracking-wider text-stone-400">Para assinar ({pending.length})</h3>
              {pending.map((d) => <DocumentCard key={d.document_id} doc={d} onOpen={() => open(d.document_id)} />)}
            </section>
          )}
          {docs.length > 0 && pending.length === 0 && <Notice tone="good">Tudo em dia: você não tem documentos pendentes.</Notice>}
          {done.length > 0 && (
            <section className="space-y-2" aria-label="Documentos assinados">
              <h3 className="text-[11px] font-black uppercase tracking-wider text-stone-400">Já assinados ({done.length})</h3>
              {done.map((d) => <DocumentCard key={d.document_id} doc={d} onOpen={() => open(d.document_id)} />)}
            </section>
          )}
        </>
      )}
    </div>
  );
};
