import { useEffect, useMemo, useState } from 'react';
import { Check, Forward, MessageCirclePlus, Pencil, Plus, Search, Trash2, X, Zap } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';
import { formatWhatsAppDisplay, maskPhone } from '../../lib/conversations/phone';
import {
  deleteQuickReply, describeConversationError, listInbox, openConversation, saveQuickReply, searchOpenTargets,
  type ConversationSummary, type OpenTarget, type QuickReply,
} from '../../lib/conversations/api';
import { Avatar, displayName } from './ConversationCard';
import { Button, InlineAlert, LoadingSpinner, Sheet, fieldCls } from './ui';

/* ---------------------------- Nova conversa ---------------------------- */

/** Um número novo ou um sócio/aluno com telefone: abre a conversa e devolve o id. */
export function NewConversationDialog({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (id: string) => void }) {
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<OpenTarget[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [telefone, setTelefone] = useState('');
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);

  useEffect(() => {
    if (!open || busca.trim().length < 2) { setAchados([]); return; }
    setCarregando(true);
    const t = setTimeout(() => {
      searchOpenTargets(busca).then(setAchados).catch(() => setAchados([])).finally(() => setCarregando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [busca, open]);

  async function abrir(chave: string, phone: string, name?: string) {
    setAbrindo(chave);
    setErro(null);
    try {
      const id = await openConversation(phone, name);
      onOpened(id);
      setBusca(''); setTelefone(''); setNome('');
    } catch (e) {
      setErro(describeConversationError(e));
    } finally {
      setAbrindo(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} closeOnBackdrop={false} title="Nova conversa" subtitle="Abre (ou retoma) a conversa com o número.">
      {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}
      <form className="grid gap-2 rounded-xl border border-dashed border-stone-200 p-3"
        onSubmit={(e) => { e.preventDefault(); void abrir('numero', telefone, nome); }}>
        <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Para um número</p>
        <input value={telefone} onChange={(e) => setTelefone(maskPhone(e.target.value))} inputMode="tel" placeholder="(88) 99999-0000" className={fieldCls} aria-label="WhatsApp" />
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (opcional)" maxLength={120} className={fieldCls} aria-label="Nome do contato" />
        <Button type="submit" variant="primary" disabled={telefone.replace(/\D/g, '').length < 10} loading={abrindo === 'numero'}>
          <MessageCirclePlus size={16} aria-hidden /> Abrir conversa
        </Button>
      </form>

      <div className="grid gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Sócios e alunos</p>
        <label className="relative block">
          <span className="sr-only">Buscar por nome</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden />
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome (mínimo 2 letras)" className={cx(fieldCls, 'pl-9')} />
        </label>
        {carregando ? <div className="grid place-items-center py-6"><LoadingSpinner /></div> : (
          <ul className="grid gap-1">
            {achados.map((c) => (
              <li key={c.key}>
                <button type="button" disabled={abrindo !== null} onClick={() => void abrir(c.key, c.phone, c.name)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-stone-50 disabled:opacity-60">
                  <Avatar name={c.name} url={null} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.name}</span>
                    <span className="block text-xs text-stone-500">{c.hint} · {formatWhatsAppDisplay(c.phone)}</span>
                  </span>
                  {abrindo === c.key && <LoadingSpinner text="" />}
                </button>
              </li>
            ))}
            {busca.trim().length >= 2 && achados.length === 0 && <li className="py-4 text-center text-xs text-stone-500">Ninguém com telefone cadastrado com esse nome.</li>}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------------------- Encaminhar ---------------------------- */

export function ForwardDialog({ open, onClose, onForward, excludeId }: {
  open: boolean; onClose: () => void; excludeId: string | null;
  onForward: (conversationIds: string[]) => Promise<void>;
}) {
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<ConversationSummary[]>([]);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!open) { setMarcadas([]); setBusca(''); return; }
    const t = setTimeout(() => { listInbox('open', busca).then(setLista).catch(() => setLista([])); }, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, busca]);

  const alternar = (id: string) => setMarcadas((m) => m.includes(id) ? m.filter((x) => x !== id) : m.length >= 5 ? m : [...m, id]);

  return (
    <Sheet open={open} onClose={onClose} title="Encaminhar para…" subtitle="Até 5 conversas."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={marcadas.length === 0} loading={enviando}
          onClick={async () => { setEnviando(true); try { await onForward(marcadas); onClose(); } finally { setEnviando(false); } }}>
          <Forward size={15} aria-hidden /> Encaminhar{marcadas.length > 1 ? ` (${marcadas.length})` : ''}
        </Button>
      </>}>
      <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conversa" className={fieldCls} aria-label="Buscar conversa" />
      <ul className="-mx-2 grid gap-0.5">
        {lista.filter((c) => c.id !== excludeId && c.kind === 'direct').map((c) => {
          const on = marcadas.includes(c.id);
          return (
            <li key={c.id}>
              <button type="button" aria-pressed={on} onClick={() => alternar(c.id)}
                className={cx('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left', on ? 'bg-saibro-50' : 'hover:bg-stone-50')}>
                <Avatar name={c.title} url={c.avatar_url} size={36} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{displayName(c)}</span>
                <span className={cx('grid h-6 w-6 place-items-center rounded-full border', on ? 'border-saibro-600 bg-saibro-600 text-white' : 'border-stone-300')}>
                  {on && <Check size={14} aria-hidden />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/* ---------------------------- Respostas rápidas ---------------------------- */

export function QuickRepliesDialog({ open, onClose, replies, onChanged }: {
  open: boolean; onClose: () => void; replies: QuickReply[]; onChanged: () => void;
}) {
  const vazio = { shortcut: '', title: '', body: '' };
  const [editando, setEditando] = useState<(Omit<QuickReply, 'id'> & { id?: string }) | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!editando) return;
    setErro(null);
    try { await saveQuickReply(editando); setEditando(null); onChanged(); } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao salvar.'); }
  }

  return (
    <Sheet open={open} onClose={onClose} closeOnBackdrop={false} title="Respostas rápidas">
      <p className="text-xs text-stone-600">Digite <kbd className="rounded bg-stone-100 px-1 font-mono">/</kbd> no campo da mensagem para usar. <code className="rounded bg-stone-100 px-1">{'{nome}'}</code> vira o primeiro nome do contato.</p>
      {erro && <InlineAlert tone="error" title={erro} onDismiss={() => setErro(null)} />}
      {editando ? (
        <form className="grid gap-2 rounded-xl border border-stone-200 p-3" onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
          <div className="grid grid-cols-[8rem_1fr] gap-2">
            <input value={editando.shortcut} onChange={(e) => setEditando({ ...editando, shortcut: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
              placeholder="atalho" maxLength={30} required className={fieldCls} aria-label="Atalho" />
            <input value={editando.title} onChange={(e) => setEditando({ ...editando, title: e.target.value })} placeholder="Título" maxLength={80} required className={fieldCls} aria-label="Título" />
          </div>
          <textarea value={editando.body} onChange={(e) => setEditando({ ...editando, body: e.target.value })} rows={4} maxLength={4096} required
            placeholder="Olá, {nome}! …" className={cx(fieldCls, 'py-2')} aria-label="Texto" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button variant="primary" type="submit">Salvar</Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" className="justify-self-start" onClick={() => setEditando(vazio)}><Plus size={14} aria-hidden /> Nova resposta</Button>
      )}
      <ul className="grid gap-2">
        {replies.map((r) => (
          <li key={r.id} className="rounded-xl border border-stone-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold"><span className="font-mono text-saibro-700">/{r.shortcut}</span> · {r.title}</span>
              <span className="flex gap-1">
                <button type="button" aria-label={`Editar ${r.title}`} onClick={() => setEditando(r)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-100"><Pencil size={14} aria-hidden /></button>
                <button type="button" aria-label={`Apagar ${r.title}`} onClick={() => void deleteQuickReply(r.id).then(onChanged).catch((e) => setErro(e.message))}
                  className="grid h-9 w-9 place-items-center rounded-full text-red-600 hover:bg-red-50"><Trash2 size={14} aria-hidden /></button>
              </span>
            </div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-stone-600">{r.body}</p>
          </li>
        ))}
        {replies.length === 0 && <li className="py-4 text-center text-xs text-stone-500"><Zap size={16} className="mx-auto mb-1" aria-hidden />Nenhuma resposta rápida ainda.</li>}
      </ul>
    </Sheet>
  );
}

/** Sugestões ao digitar `/atalho` no campo. */
export function QuickReplyMenu({ query, replies, onPick }: { query: string; replies: QuickReply[]; onPick: (r: QuickReply) => void }) {
  const filtradas = useMemo(() => {
    const q = query.toLowerCase();
    return replies.filter((r) => r.shortcut.includes(q) || r.title.toLowerCase().includes(q)).slice(0, 6);
  }, [query, replies]);
  if (filtradas.length === 0) return null;
  return (
    <ul role="listbox" aria-label="Respostas rápidas" className="absolute bottom-full left-2 right-2 mb-2 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
      {filtradas.map((r) => (
        <li key={r.id}>
          <button type="button" role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); onPick(r); }}
            className="block w-full px-3 py-2 text-left hover:bg-saibro-50">
            <span className="text-sm font-semibold"><span className="font-mono text-saibro-700">/{r.shortcut}</span> · {r.title}</span>
            <span className="block truncate text-xs text-stone-500">{r.body}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------- Foto ampliada ---------------------------- */

export function ImageViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!url) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [url, onClose]);
  if (!url) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Foto ampliada" className="fixed inset-0 z-[1000] grid place-items-center bg-black/85 p-4" onClick={onClose}>
      <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
      <div className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex gap-2">
        <a href={url} target="_blank" rel="noopener noreferrer" download onClick={(e) => e.stopPropagation()}
          className="rounded-full bg-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/25">Baixar</a>
        <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"><X size={20} aria-hidden /></button>
      </div>
    </div>
  );
}
