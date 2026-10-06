import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';

/**
 * Gravador de áudio de voz, portado do `CRMAudioRecorder` do CRM Ibiapaba.
 * Prefere OGG/Opus (o formato do áudio de voz do WhatsApp); o navegador que
 * só grava WebM/Opus ou MP4 envia assim mesmo e a UazAPI converte no `ptt`.
 */
type Props = {
  onStop: (blob: Blob, mime: string, seconds: number) => void;
  onCancel: () => void;
  onError: (message: string) => void;
  isSending: boolean;
  /** Avisa o cliente que estamos gravando (presença). */
  onRecording?: (active: boolean) => void;
};

const TIPOS = ['audio/ogg;codecs=opus', 'audio/ogg', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export default function AudioRecorder({ onStop, onCancel, onError, isSending, onRecording }: Props) {
  const [duracao, setDuracao] = useState(0);
  const [parado, setParado] = useState(false);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const mimeRef = useRef('audio/ogg;codecs=opus');
  const paradoRef = useRef(false);
  const duracaoRef = useRef(0);

  const limparTimer = useCallback(() => {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelado) { stream.getTracks().forEach((t) => t.stop()); return; }
        const tipo = typeof MediaRecorder !== 'undefined' ? TIPOS.find((t) => MediaRecorder.isTypeSupported(t)) ?? '' : '';
        mimeRef.current = tipo || 'audio/webm';
        const gravador = tipo ? new MediaRecorder(stream, { mimeType: tipo }) : new MediaRecorder(stream);
        gravadorRef.current = gravador;
        pedacosRef.current = [];
        gravador.ondataavailable = (e) => { if (e.data.size > 0) pedacosRef.current.push(e.data); };
        gravador.start();
        onRecording?.(true);
        timerRef.current = setInterval(() => {
          if (!paradoRef.current) { duracaoRef.current += 1; setDuracao(duracaoRef.current); }
        }, 1000);
      } catch {
        onError('Não foi possível usar o microfone. Libere o acesso nas permissões do navegador.');
        onCancel();
      }
    })();
    return () => {
      cancelado = true;
      limparTimer();
      onRecording?.(false);
      const g = gravadorRef.current;
      if (g && g.state !== 'inactive') { g.stop(); g.stream.getTracks().forEach((t) => t.stop()); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parar = useCallback(() => {
    const g = gravadorRef.current;
    if (!g || paradoRef.current) return;
    paradoRef.current = true;
    setParado(true);
    limparTimer();
    onRecording?.(false);
    g.onstop = () => onStop(new Blob(pedacosRef.current, { type: mimeRef.current }), mimeRef.current, duracaoRef.current);
    if (g.state !== 'inactive') { g.stop(); g.stream.getTracks().forEach((t) => t.stop()); }
  }, [onStop, limparTimer, onRecording]);

  const ocupado = parado || isSending;
  const tempo = `${Math.floor(duracao / 60)}:${(duracao % 60).toString().padStart(2, '0')}`;

  return (
    <div className={cx('flex min-h-11 flex-1 items-center gap-3 rounded-2xl border px-4 py-1.5',
      ocupado ? 'border-emerald-200 bg-emerald-50' : 'border-red-100 bg-red-50')}>
      {ocupado ? <Loader2 className="h-3 w-3 animate-spin text-emerald-600" aria-hidden /> : <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" aria-hidden />}
      <span className={cx('flex-1 font-medium tabular-nums', ocupado ? 'text-emerald-700' : 'text-red-700')} aria-live="polite">
        {ocupado ? `Enviando ${tempo}…` : `Gravando ${tempo}`}
      </span>
      <button type="button" onClick={onCancel} disabled={ocupado} aria-label="Descartar áudio"
        className="outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300 grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-30">
        <Trash2 size={18} aria-hidden />
      </button>
      <button type="button" onClick={parar} disabled={ocupado} aria-label="Enviar áudio"
        className="outline-hidden focus-visible:ring-2 focus-visible:ring-saibro-300 grid h-10 w-10 place-items-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
        {ocupado ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
      </button>
    </div>
  );
}
