import { useEffect, useRef, useState } from 'react';
import { FileText, Mic, Paperclip, Pencil, Reply, SendHorizontal, X, Zap } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';
import AudioRecorder from './AudioRecorder';
import { QuickReplyMenu } from './ConversationDialogs';
import { fillTemplate, MAX_UPLOAD_BYTES, type ConversationMessage, type QuickReply } from '../../lib/conversations/api';

/**
 * Campo de mensagem com tudo o que o WhatsApp tem: responder citando, editar,
 * anexar (botão, colar ou arrastar — com prévia e legenda), gravar áudio de
 * voz e respostas rápidas por `/`. O texto é controlado de fora para que o
 * rascunho continue sendo por conversa.
 */

export type Pendente = { file: File; url: string };

type Props = {
  contactName: string;
  value: string;
  onChange: (v: string) => void;
  replyTo: ConversationMessage | null;
  editing: ConversationMessage | null;
  onCancelContext: () => void;
  quickReplies: QuickReply[];
  onManageQuickReplies: () => void;
  onSendText: (body: string) => void;
  onSaveEdit: (body: string) => void;
  onSendFiles: (files: File[], caption: string) => Promise<void>;
  onSendVoice: (blob: Blob, mime: string, seconds: number) => Promise<void>;
  onTyping: (typing: boolean) => void;
  onRecording: (recording: boolean) => void;
  onError: (message: string) => void;
  /** Arquivos soltos na conversa (arrastar e soltar), vindos da página. */
  droppedFiles: File[] | null;
  onDroppedConsumed: () => void;
};

const ACEITOS = 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.zip';

export default function Composer(p: Props) {
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [anexos, setAnexos] = useState<Pendente[]>([]);
  const [gravando, setGravando] = useState(false);
  const [enviandoMidia, setEnviandoMidia] = useState(false);

  // Campo cresce com o texto até ~6 linhas.
  useEffect(() => {
    const el = campoRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [p.value]);

  useEffect(() => { if (p.replyTo || p.editing) campoRef.current?.focus(); }, [p.replyTo, p.editing]);

  useEffect(() => {
    if (p.droppedFiles?.length) { adicionar(p.droppedFiles); p.onDroppedConsumed(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.droppedFiles]);

  useEffect(() => () => anexos.forEach((a) => URL.revokeObjectURL(a.url)), [anexos]);

  function adicionar(files: File[]) {
    const grandes = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (grandes.length) p.onError(`${grandes.length === 1 ? 'Um arquivo passa' : 'Alguns arquivos passam'} de 16 MB, o limite do WhatsApp.`);
    const ok = files.filter((f) => f.size <= MAX_UPLOAD_BYTES).slice(0, 10 - anexos.length);
    setAnexos((a) => [...a, ...ok.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  const barra = p.value.match(/^\/([a-z0-9_-]*)$/i);

  function enviar() {
    if (anexos.length) {
      const legenda = p.value.trim();
      setEnviandoMidia(true);
      void p.onSendFiles(anexos.map((a) => a.file), legenda).finally(() => {
        setEnviandoMidia(false);
        setAnexos([]);
      });
      p.onChange('');
      return;
    }
    const corpo = p.value.replace(/\s+$/, '');
    if (!corpo.trim()) return;
    if (p.editing) p.onSaveEdit(corpo); else p.onSendText(corpo);
  }

  if (gravando) {
    return (
      <div className="flex items-center gap-2 border-t border-stone-200 bg-white p-2 md:p-3">
        <AudioRecorder
          isSending={enviandoMidia}
          onError={p.onError}
          onRecording={p.onRecording}
          onCancel={() => setGravando(false)}
          onStop={(blob, mime, seconds) => {
            setEnviandoMidia(true);
            void p.onSendVoice(blob, mime, seconds).finally(() => { setEnviandoMidia(false); setGravando(false); });
          }}
        />
      </div>
    );
  }

  const contexto = p.editing ?? p.replyTo;

  return (
    <div className="relative border-t border-stone-200 bg-white">
      {contexto && (
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          {p.editing ? <Pencil size={16} className="shrink-0 text-saibro-600" aria-hidden /> : <Reply size={16} className="shrink-0 text-saibro-600" aria-hidden />}
          <div className="min-w-0 flex-1 border-l-4 border-saibro-400 pl-2">
            <p className="text-xs font-semibold text-saibro-700">{p.editing ? 'Editando mensagem' : `Respondendo ${contexto.direction === 'inbound' ? p.contactName : 'você'}`}</p>
            <p className="truncate text-xs text-slate-600">{contexto.body || 'Mídia'}</p>
          </div>
          <button type="button" onClick={p.onCancelContext} aria-label="Cancelar" className="grid h-8 w-8 place-items-center rounded-full hover:bg-slate-100"><X size={16} aria-hidden /></button>
        </div>
      )}

      {anexos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-3 py-2">
          {anexos.map((a, i) => (
            <div key={a.url} className="relative shrink-0">
              {a.file.type.startsWith('image/') ? (
                <img src={a.url} alt={a.file.name} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
              ) : a.file.type.startsWith('video/') ? (
                <video src={a.url} className="h-20 w-20 rounded-lg border border-slate-200 bg-black object-cover" muted />
              ) : (
                <div className="flex h-20 w-32 flex-col justify-center rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                  <FileText size={18} className="text-slate-500" aria-hidden />
                  <span className="mt-1 line-clamp-2 break-all">{a.file.name}</span>
                </div>
              )}
              <button type="button" aria-label={`Remover ${a.file.name}`}
                onClick={() => setAnexos((x) => { URL.revokeObjectURL(x[i].url); return x.filter((_, j) => j !== i); })}
                className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-white"><X size={12} aria-hidden /></button>
            </div>
          ))}
        </div>
      )}

      {barra && <QuickReplyMenu query={barra[1]} replies={p.quickReplies} onPick={(r) => p.onChange(fillTemplate(r.body, p.contactName))} />}

      <form className="chat-composer-form flex items-end gap-1.5 p-2 md:p-3" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        {!p.editing && (
          <>
            <input ref={arquivoRef} type="file" multiple accept={ACEITOS} className="hidden"
              onChange={(e) => { if (e.target.files) adicionar(Array.from(e.target.files)); e.target.value = ''; }} />
            <button type="button" onClick={() => arquivoRef.current?.click()} aria-label="Anexar arquivo"
              className="outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300 grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100"><Paperclip size={20} aria-hidden /></button>
            <button type="button" onClick={p.onManageQuickReplies} aria-label="Respostas rápidas"
              className="outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300 hidden h-11 w-11 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100 sm:grid"><Zap size={19} aria-hidden /></button>
          </>
        )}
        <label className="min-w-0 flex-1">
          <span className="sr-only">Mensagem para {p.contactName}</span>
          <textarea
            ref={campoRef}
            rows={1}
            value={p.value}
            onChange={(e) => { p.onChange(e.target.value); p.onTyping(e.target.value.length > 0); }}
            onFocus={() => {
              if (window.scrollY !== 0) window.scrollTo(0, 0);
              setTimeout(() => { if (window.scrollY !== 0) window.scrollTo(0, 0); }, 30);
              setTimeout(() => { if (window.scrollY !== 0) window.scrollTo(0, 0); }, 100);
            }}
            onBlur={() => p.onTyping(false)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files ?? []);
              if (files.length) { e.preventDefault(); adicionar(files); }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && contexto) { e.preventDefault(); p.onCancelContext(); return; }
              // Enter envia no computador; no celular, Enter quebra linha.
              const toque = window.matchMedia?.('(pointer: coarse)').matches;
              if (e.key === 'Enter' && !e.shiftKey && !toque && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); }
            }}
            placeholder={anexos.length ? 'Legenda (opcional)' : p.editing ? 'Edite a mensagem' : 'Mensagem'}
            title="Digite / para respostas rápidas"
            className="outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300 block max-h-40 min-h-11 w-full resize-none rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm leading-snug"
          />
        </label>
        {p.value.trim() || anexos.length || p.editing ? (
          <button type="submit" aria-label={p.editing ? 'Salvar edição' : 'Enviar mensagem'} disabled={enviandoMidia}
            className="outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-saibro-600 text-white transition-colors hover:bg-saibro-700 disabled:bg-slate-300">
            <SendHorizontal size={18} aria-hidden />
          </button>
        ) : (
          <button type="button" aria-label="Gravar áudio" onClick={() => setGravando(true)}
            className={cx('outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white transition-colors hover:bg-emerald-700')}>
            <Mic size={19} aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
