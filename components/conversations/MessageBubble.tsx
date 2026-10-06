/* eslint-disable react-refresh/only-export-components -- helpers puros exportados junto do componente (padrão do módulo financeiro) */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, AtSign, Ban, Check, CheckCheck, Clock, Copy, Download, FileText, Forward, Lock, MapPin, MoreVertical,
  Bot, Pencil, Reply, RotateCw, Send, Trash2, User,
} from 'lucide-react';
import { cx } from '../../lib/conversations/cx';
import { parseWhatsAppTextBlocks, renderWhatsAppTextBlocks } from '../../lib/conversations/whatsappTextFormatter';
import AudioPlayer from './AudioPlayer';
import type { ConversationMessage, MessageStatus } from '../../lib/conversations/api';

/**
 * Balão de mensagem, no desenho do `MessageBubble` do North Jato (que veio do CRM
 * Ibiapaba): cores do WhatsApp, tiques, formatação de texto, mídia (foto, vídeo, áudio de voz,
 * documento, figurinha, localização, contato), resposta citada, reações,
 * "editada", "apagada" e o mesmo menu de ações.
 */

const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit' });
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EDIT_WINDOW_MS = 15 * 60 * 1000;

const STATUS_LABEL: Record<MessageStatus, string> = {
  queued: 'Enviando', sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Não enviada', received: 'Recebida',
};

function StatusIcon({ status, pending }: { status: MessageStatus; pending?: boolean }) {
  if (pending || status === 'queued') return <Clock className="h-3 w-3 text-gray-400" aria-hidden />;
  if (status === 'failed') return <AlertTriangle className="h-3 w-3 text-red-500" aria-hidden />;
  if (status === 'sent') return <Check className="h-3 w-3 text-gray-400" aria-hidden />;
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 text-gray-400" aria-hidden />;
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-blue-500" aria-hidden />;
  return null;
}

export type BubbleActions = {
  onReply?: (m: ConversationMessage) => void;
  onReact?: (m: ConversationMessage, emoji: string) => void;
  onForward?: (m: ConversationMessage) => void;
  onEdit?: (m: ConversationMessage) => void;
  onDelete?: (m: ConversationMessage) => void;
  onRetry?: (m: ConversationMessage) => void;
  onSync?: (m: ConversationMessage) => Promise<unknown> | void;
  onOpenImage?: (url: string, m: ConversationMessage) => void;
};

type Props = BubbleActions & {
  message: ConversationMessage;
  /** URL assinada da mídia, quando já baixada. */
  mediaUrl?: string | null;
  highlight?: boolean;
  canWrite: boolean;
  /** Conversa em grupo: mostra quem falou e a classificação de menção. */
  isGroup?: boolean;
};

function Midia({ m, url, isOutbound, onOpenImage }: { m: ConversationMessage; url: string | null; isOutbound: boolean; onOpenImage?: Props['onOpenImage'] }) {
  const carregando = !url && m.kind !== 'location' && m.kind !== 'contact';
  switch (m.kind) {
    case 'image':
    case 'sticker':
      return url ? (
        <button type="button" onClick={() => onOpenImage?.(url, m)} className="block overflow-hidden rounded-lg" aria-label="Abrir foto">
          <img src={url} alt={m.body || 'Foto'} loading="lazy"
            className={cx('object-cover', m.kind === 'sticker' ? 'h-32 w-32 bg-transparent object-contain' : 'max-h-72 w-full max-w-72 border border-black/5')} />
        </button>
      ) : <Placeholder texto={m.kind === 'sticker' ? '🌟 Figurinha' : '📷 Foto'} carregando={carregando} />;
    case 'video':
      return url
        ? <video src={url} controls preload="metadata" className="max-h-72 w-full max-w-72 rounded-lg bg-black" />
        : <Placeholder texto="🎥 Vídeo" carregando={carregando} />;
    case 'audio':
    case 'ptt':
      // `key`: arquivo novo (baixou agora) recomeça o player do zero.
      return <AudioPlayer key={url ?? 'pendente'} src={url} isOutbound={isOutbound} voiceNote={m.kind === 'ptt'} seconds={Number(m.meta.seconds) || undefined} />;
    case 'document':
      return (
        <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" download={m.mediaName ?? undefined}
          className={cx('flex min-w-52 items-center gap-2 rounded-lg border p-2.5 text-sm', url ? 'hover:bg-black/5' : 'pointer-events-none opacity-70',
            isOutbound ? 'border-slate-200 bg-slate-50' : 'border-emerald-900/10 bg-white/50')}>
          <FileText size={22} className="shrink-0 text-slate-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{m.mediaName || 'Documento'}</span>
          {url ? <Download size={16} className="shrink-0 text-slate-500" aria-hidden /> : <span className="text-[10px] text-slate-500">baixando…</span>}
        </a>
      );
    case 'location': {
      const lat = Number(m.meta.latitude); const lng = Number(m.meta.longitude);
      const ok = Number.isFinite(lat) && Number.isFinite(lng);
      return (
        <a href={ok ? `https://www.google.com/maps?q=${lat},${lng}` : undefined} target="_blank" rel="noopener noreferrer"
          className="flex min-w-52 items-center gap-2 rounded-lg border border-black/10 bg-white/60 p-2.5 text-sm hover:bg-white">
          <MapPin size={20} className="shrink-0 text-red-500" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{String(m.meta.name || 'Localização')}</span>
            {ok && <span className="block text-xs text-slate-500">Abrir no mapa</span>}
          </span>
        </a>
      );
    }
    case 'contact':
      return (
        <div className="flex min-w-52 items-center gap-2 rounded-lg border border-black/10 bg-white/60 p-2.5 text-sm">
          <User size={20} className="shrink-0 text-slate-500" aria-hidden />
          <span className="truncate font-medium">{String(m.meta.displayName || m.body || 'Contato')}</span>
        </div>
      );
    default:
      return null;
  }
}

function Placeholder({ texto, carregando }: { texto: string; carregando: boolean }) {
  return (
    <div className="flex h-24 w-56 max-w-full items-center justify-center rounded-lg bg-black/5 text-sm text-slate-600">
      {texto}{carregando && <span className="ml-1 text-xs text-slate-500">· baixando…</span>}
    </div>
  );
}

function MessageBubble({ message: m, mediaUrl, highlight, canWrite, isGroup, ...acoes }: Props) {
  const isOutbound = m.direction === 'outbound';
  const [menu, setMenu] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  // Relógio de quando o balão apareceu: decide se ainda dá para editar.
  const [agora] = useState(() => Date.now());
  const menuRef = useRef<HTMLDivElement>(null);
  const apagada = Boolean(m.deletedAt);
  const isUndecryptable = !apagada && Boolean(m.body?.includes('[Undecryptable]'));
  const failed = m.status === 'failed' && !m.pending;
  const blocks = useMemo(() => parseWhatsAppTextBlocks(apagada || isUndecryptable ? '' : m.body || ''), [m.body, apagada, isUndecryptable]);
  const quando = hora.format(new Date(m.sentAt || m.createdAt));
  const temMidia = m.kind !== 'text' && m.kind !== 'other';
  const url = m.localUrl ?? mediaUrl ?? null;
  const enviada = ['sent', 'delivered', 'read'].includes(m.status) && Boolean(m.providerId);
  const podeEditar = canWrite && isOutbound && enviada && m.kind === 'text' && !apagada
    && agora - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
  const podeApagar = canWrite && isOutbound && enviada && !apagada;
  const reacoes = [m.reactions.customer, m.reactions.staff].filter(Boolean) as string[];

  useEffect(() => {
    if (!menu) return;
    const fechar = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fechar); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const agir = (fn?: (m: ConversationMessage) => void) => () => { setMenu(false); fn?.(m); };

  return (
    <div
      className={cx('group/bubble flex w-full min-w-0 px-1', isOutbound ? 'justify-end' : 'justify-start', highlight && 'rounded-lg bg-amber-100/70')}
      aria-label={`Mensagem de ${isOutbound ? 'você' : (m.senderName ?? 'contato')} às ${quando}`}
    >
      <div className="relative min-w-0 max-w-[84%] md:max-w-[72%]">
        <div
          className={cx(
            'relative rounded-2xl px-3 py-2',
            failed
              ? 'border border-red-300 bg-red-50 text-slate-900 shadow-sm'
              : isOutbound
                ? 'border border-slate-200 bg-white text-slate-900 shadow-sm'
                : 'border border-[#b7e4b0] bg-[#dcf8c6] text-[#17301c] shadow-sm shadow-emerald-200/80',
            m.pending && 'opacity-80',
            !apagada && !m.pending && 'pr-8',
          )}
        >
          {!apagada && !m.pending && (
            <div ref={menuRef} className="absolute right-1 top-1 z-10">
              <button
                type="button"
                onClick={() => setMenu((v) => !v)}
                aria-label="Ações da mensagem"
                aria-expanded={menu}
                className="grid h-7 w-7 place-items-center rounded-full text-slate-500 opacity-60 transition-opacity hover:bg-black/5 group-hover/bubble:opacity-100 focus-visible:opacity-100 md:opacity-0"
              >
                <MoreVertical size={15} aria-hidden />
              </button>
              {menu && (
                <div role="menu" className={cx('absolute z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg', isOutbound ? 'right-0' : 'left-0')}>
                  {canWrite && (
                    <div className="flex justify-between px-2 pb-1 pt-0.5">
                      {QUICK_REACTIONS.map((e) => (
                        <button key={e} type="button" role="menuitem" aria-label={`Reagir com ${e}`}
                          onClick={() => { setMenu(false); acoes.onReact?.(m, m.reactions.staff === e ? '' : e); }}
                          className={cx('grid h-9 w-9 place-items-center rounded-full text-lg hover:bg-slate-100', m.reactions.staff === e && 'bg-saibro-50 ring-1 ring-saibro-300')}>
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                  {canWrite && <Item icon={Reply} label="Responder" onClick={agir(acoes.onReply)} />}
                  {isUndecryptable && acoes.onSync && <Item icon={RotateCw} label="Sincronizar do WhatsApp" onClick={agir(acoes.onSync)} />}
                  {m.body && <Item icon={Copy} label="Copiar texto" onClick={() => { setMenu(false); void navigator.clipboard?.writeText(m.body ?? ''); }} />}
                  {canWrite && <Item icon={Forward} label="Encaminhar" onClick={agir(acoes.onForward)} />}
                  {podeEditar && <Item icon={Pencil} label="Editar" onClick={agir(acoes.onEdit)} />}
                  {podeApagar && <Item icon={Trash2} label="Apagar para todos" danger onClick={agir(acoes.onDelete)} />}
                </div>
              )}
            </div>
          )}

          {isGroup && !isOutbound && m.senderName && !apagada && (
            <p className="mb-0.5 truncate text-xs font-bold text-saibro-700">{m.senderName}</p>
          )}
          {m.origin === 'ai' && !apagada && (
            <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
              <Bot size={11} aria-hidden /> IA
            </span>
          )}
          {m.origin === 'automation' && !apagada && (
            <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
              <Send size={11} aria-hidden /> Automação
            </span>
          )}
          {apagada ? (
            <p className="flex items-center gap-1.5 text-sm italic text-slate-500"><Ban size={14} aria-hidden /> Mensagem apagada</p>
          ) : isUndecryptable ? (
            <div className="space-y-2 py-0.5 min-w-[200px] max-w-sm">
              <div className="flex items-start gap-2 rounded-lg border border-amber-300/80 bg-amber-50/90 p-2.5 text-xs text-amber-900 shadow-xs">
                <Lock size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
                <div className="space-y-1">
                  <p className="font-semibold text-amber-950">Aguardando chave do WhatsApp</p>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    Esta mensagem chegou cifrada antes do WhatsApp sincronizar as chaves. Abra o WhatsApp no celular e toque abaixo para sincronizar.
                  </p>
                </div>
              </div>
              {acoes.onSync && (
                <button
                  type="button"
                  disabled={sincronizando}
                  onClick={async () => {
                    setSincronizando(true);
                    try {
                      await acoes.onSync?.(m);
                    } finally {
                      setSincronizando(false);
                    }
                  }}
                  className="outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 shadow-xs hover:bg-amber-50 active:scale-98 transition disabled:opacity-50"
                >
                  <RotateCw size={13} className={cx('text-amber-700', sincronizando && 'animate-spin')} aria-hidden />
                  {sincronizando ? 'Sincronizando…' : 'Sincronizar mensagem'}
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-1.5">
              {m.replyPreview && (
                <div className={cx('rounded-lg border-l-4 px-2 py-1 text-xs', isOutbound ? 'border-saibro-400 bg-slate-100 text-slate-700' : 'border-emerald-600 bg-white/50 text-emerald-900')}>
                  <span className="line-clamp-2">{m.replyPreview}</span>
                </div>
              )}
              {temMidia && <Midia m={m} url={url} isOutbound={isOutbound} onOpenImage={acoes.onOpenImage} />}
              {blocks.length > 0 && (
                <div className="space-y-1 break-words">{renderWhatsAppTextBlocks(blocks, { tone: isOutbound ? 'agent' : 'customer' })}</div>
              )}
              {!temMidia && blocks.length === 0 && <span className="text-sm italic text-slate-500">Mensagem sem texto</span>}
            </div>
          )}
        </div>

        {reacoes.length > 0 && !apagada && (
          <div className={cx('relative z-10 -mt-2 flex gap-0.5 px-2', isOutbound ? 'justify-end' : 'justify-start')}>
            <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[13px] leading-none shadow-sm" aria-label={`Reações: ${reacoes.join(' ')}`}>
              {reacoes.join(' ')}
            </span>
          </div>
        )}

        <div className={cx('mt-0.5 flex items-center gap-1 px-1 text-[11px] text-slate-500', isOutbound && 'justify-end')}>
          {isGroup && !isOutbound && (
            <span className={cx('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', m.mentionDirect ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-500')}
              title={m.mentionEvidence ? `Classificação: ${m.mentionEvidence}` : undefined}>
              <AtSign size={10} aria-hidden /> {m.mentionDirect ? 'chamou o STC' : 'sem menção direta'}
            </span>
          )}
          {m.editedAt && !apagada && <span className="italic">editada ·</span>}
          <span className="tabular-nums">{quando}</span>
          {isOutbound && (
            <span className="inline-flex items-center" title={STATUS_LABEL[m.pending ? 'queued' : m.status]}>
              <StatusIcon status={m.status} pending={m.pending} />
              <span className="sr-only">{STATUS_LABEL[m.pending ? 'queued' : m.status]}</span>
            </span>
          )}
        </div>
        {failed && acoes.onRetry && (
          <button type="button" onClick={() => acoes.onRetry?.(m)}
            className="outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300 ml-auto mt-1 flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold text-red-700 hover:bg-red-50">
            <RotateCw size={12} aria-hidden /> Não enviada — tentar de novo
          </button>
        )}
      </div>
    </div>
  );
}

function Item({ icon: Icon, label, onClick, danger }: { icon: typeof Reply; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className={cx('flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-slate-50', danger ? 'text-red-700' : 'text-slate-800')}>
      <Icon size={15} aria-hidden /> {label}
    </button>
  );
}

export default memo(MessageBubble);
