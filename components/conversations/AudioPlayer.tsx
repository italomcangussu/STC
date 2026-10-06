import { useEffect, useRef, useState } from 'react';
import { Download, Mic, Pause, Play } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';

/**
 * Player de áudio do balão, portado do `CRMAudioPlayer` do CRM Ibiapaba (mesmo
 * desenho e controles). Sem a transcrição local de lá, que depende de um
 * modelo que o North Jato não carrega.
 */
type Props = { src: string | null; isOutbound: boolean; voiceNote?: boolean; seconds?: number };

const formatTime = (time: number) => {
  if (!Number.isFinite(time) || time < 0) return '0:00';
  return `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
};

export default function AudioPlayer({ src, isOutbound, voiceNote, seconds }: Props) {
  const [tocando, setTocando] = useState(false);
  const [erro, setErro] = useState(false);
  const [duracao, setDuracao] = useState<number | null>(seconds ?? null);
  const [atual, setAtual] = useState(0);
  const [velocidade, setVelocidade] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Pausa este áudio se outro começar a tocar na mesma tela
  useEffect(() => {
    const onOutroTocar = (e: Event) => {
      const outro = (e as CustomEvent<HTMLAudioElement>).detail;
      if (outro && outro !== audioRef.current && tocando) {
        audioRef.current?.pause();
        setTocando(false);
      }
    };
    window.addEventListener('nj-audio-play', onOutroTocar);
    return () => window.removeEventListener('nj-audio-play', onOutroTocar);
  }, [tocando]);

  async function alternar() {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (tocando) {
      audio.pause();
      setTocando(false);
      return;
    }
    setErro(false);
    // Notifica outros players para pausarem
    window.dispatchEvent(new CustomEvent('nj-audio-play', { detail: audio }));
    try {
      await audio.play();
      setTocando(true);
    } catch {
      setErro(true);
      setTocando(false);
    }
  }

  function trocarVelocidade() {
    const proxima = velocidade === 1 ? 1.5 : velocidade === 1.5 ? 2 : 1;
    setVelocidade(proxima);
    if (audioRef.current) audioRef.current.playbackRate = proxima;
  }

  function buscar(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duracao || duracao <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duracao;
    setAtual(audio.currentTime);
  }

  const progresso = duracao && duracao > 0 ? Math.min(1, atual / duracao) : 0;

  return (
    <div className={cx('w-64 max-w-full rounded-xl border p-2.5',
      isOutbound ? 'border-slate-200 bg-slate-50' : 'border-[#b7e4b0] bg-[#effce5]')}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void alternar()}
          disabled={!src}
          aria-label={tocando ? 'Pausar áudio' : 'Tocar áudio'}
          className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50',
            isOutbound ? 'bg-saibro-100 text-saibro-800 hover:bg-saibro-200' : 'bg-white/80 text-emerald-800 hover:bg-white')}
        >
          {tocando ? <Pause size={18} fill="currentColor" aria-hidden /> : <Play size={18} className="ml-0.5" fill="currentColor" aria-hidden />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-slate-500">
            <span className="flex items-center gap-1">{voiceNote && <Mic size={10} aria-hidden />}{formatTime(atual)}</span>
            <span>{duracao ? formatTime(duracao) : src ? '…' : 'baixando…'}</span>
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Progresso do áudio"
            aria-valuenow={Math.round(progresso * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            onClick={buscar}
            className={cx('h-2 w-full cursor-pointer overflow-hidden rounded-full py-0.5', isOutbound ? 'bg-slate-200' : 'bg-emerald-200/70')}
          >
            <div className={cx('h-full rounded-full transition-[width] duration-75', isOutbound ? 'bg-saibro-600' : 'bg-emerald-600')} style={{ width: `${Math.round(progresso * 100)}%` }} />
          </div>
        </div>
        <button type="button" onClick={trocarVelocidade} className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-white" aria-label="Velocidade">
          {velocidade}×
        </button>
      </div>
      {erro && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-medium text-red-600">
          <span>Não foi possível tocar este áudio.</span>
          {src && (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="inline-flex items-center gap-1 font-semibold underline hover:text-red-700"
            >
              <Download size={11} aria-hidden /> Baixar
            </a>
          )}
        </div>
      )}
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          playsInline
          className="hidden"
          onTimeUpdate={() => setAtual(audioRef.current?.currentTime ?? 0)}
          onLoadedMetadata={() => { const d = audioRef.current?.duration; if (d && Number.isFinite(d)) setDuracao(d); }}
          onEnded={() => {
            setTocando(false);
            setAtual(0);
          }}
          onError={() => { setErro(true); setTocando(false); }}
        />
      )}
    </div>
  );
}
