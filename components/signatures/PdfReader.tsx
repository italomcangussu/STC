/**
 * Leitor do PDF com "leia até o fim".
 *
 * As páginas são desenhadas só quando chegam perto da tela e liberadas quando se afastam (um contrato
 * de 40 páginas num celular não cabe na memória se todas ficarem desenhadas). O que conta como lido é
 * decidido por `createReadingTracker`: todas as páginas apareceram na tela E o fim da última foi alcançado.
 *
 * Girar o celular não perde o progresso: o rastreio mora fora do efeito que redesenha as páginas.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { openPdf, type PdfHandle } from '../../lib/signatures/pdf';
import { createReadingTracker, pageCountsAsSeen, type ReadingSnapshot } from '../../lib/signatures/reading';
import { Notice, Spinner } from './ui';

export type PdfReaderProps = {
  /** Bytes do PDF, já conferidos pelo hash. */
  data: ArrayBuffer;
  /** Número de páginas cadastrado no documento: precisa bater com o arquivo. */
  expectedPages: number;
  /** `false` ao rever um documento já assinado (nada a rastrear). */
  track: boolean;
  /** A primeira página foi desenhada: o sócio começou a ler. */
  onReady?: () => void;
  onProgress?: (snapshot: ReadingSnapshot) => void;
  onError?: (error: unknown) => void;
};

/** Guarda o valor mais recente sem refazer efeitos quando uma função muda de identidade. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}

const PAD = 16;

export const PdfReader: React.FC<PdfReaderProps> = ({ data, expectedPages, track, onReady, onProgress, onError }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const [handle, setHandle] = useState<PdfHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const latest = useLatest({ onReady, onProgress, onError });

  const fail = (error: unknown) => {
    setFailed(true);
    latest.current.onError?.(error);
  };

  // 1) Abre o PDF.
  useEffect(() => {
    let alive = true;
    let opened: PdfHandle | null = null;
    setHandle(null);
    setFailed(false);
    openPdf(data).then((h) => {
      if (!alive) { void h.destroy(); return; }
      if (h.pageCount !== expectedPages) { void h.destroy(); fail(new Error('PAGE_COUNT_MISMATCH')); return; }
      opened = h;
      setHandle(h);
    }, (error) => { if (alive) fail(error); });
    return () => { alive = false; if (opened) void opened.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, expectedPages]);

  // 2) Largura disponível (muda ao girar o aparelho).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    // Sem layout medido (clientWidth 0), cai numa largura de celular comum.
    const measure = () => {
      const inner = Math.round(el.clientWidth) - PAD;
      setWidth(inner > 0 ? Math.max(200, inner) : 344);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // O rastreio sobrevive ao redesenho: só nasce de novo com outro arquivo.
  const tracker = useMemo(() => (handle ? createReadingTracker(handle.pageCount) : null), [handle]);

  // 3) Desenha as páginas que estão perto, solta as que se afastaram, e conta o que foi lido.
  useEffect(() => {
    const root = scrollRef.current;
    if (!handle || !tracker || !root || !width) return undefined;
    if (typeof IntersectionObserver === 'undefined') { fail(new Error('NO_INTERSECTION_OBSERVER')); return undefined; }

    const pageCanvases = canvases.current;
    let alive = true;
    let firstDrawn = false;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const visible = new Set<number>();
    const drawn = new Set<number>();
    const running = new Map<number, AbortController>();
    const emit = () => { if (track) latest.current.onProgress?.(tracker.snapshot()); };
    const pageOf = (el: Element) => Number((el as HTMLElement).dataset.page);
    const maybeSeen = (n: number) => { if (track && visible.has(n) && drawn.has(n) && tracker.markSeen(n)) emit(); };

    const draw = (n: number) => {
      const canvas = pageCanvases.get(n);
      if (!canvas || drawn.has(n) || running.has(n)) return;
      const ctl = new AbortController();
      running.set(n, ctl);
      handle.render(n, canvas, width, ratio, ctl.signal).then(() => {
        if (running.get(n) === ctl) running.delete(n);
        if (!alive || ctl.signal.aborted) return;
        drawn.add(n);
        if (!firstDrawn) { firstDrawn = true; latest.current.onReady?.(); }
        maybeSeen(n);
      }, (error) => {
        if (running.get(n) === ctl) running.delete(n);
        if (alive && !ctl.signal.aborted) fail(error);
      });
    };
    const release = (n: number) => {
      running.get(n)?.abort();
      running.delete(n);
      drawn.delete(n);
      const canvas = pageCanvases.get(n);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    };

    const renderObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const n = pageOf(e.target);
        if (!n) continue;
        if (e.isIntersecting) draw(n); else release(n);
      }
    }, { root, rootMargin: '150% 0px', threshold: 0 });

    const seenObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const n = pageOf(e.target);
        if (!n) continue;
        const ok = pageCountsAsSeen({
          isIntersecting: e.isIntersecting,
          visibleHeight: e.intersectionRect?.height ?? 0,
          pageHeight: e.boundingClientRect?.height ?? 0,
          viewportHeight: e.rootBounds?.height ?? root.clientHeight,
        });
        if (ok) visible.add(n); else visible.delete(n);
        maybeSeen(n);
      }
    }, { root, threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1] });

    const endObserver = new IntersectionObserver((entries) => {
      if (track && entries.some((e) => e.isIntersecting) && tracker.markEnd()) emit();
    }, { root, threshold: 0 });

    root.querySelectorAll('[data-page]').forEach((el) => { renderObserver.observe(el); seenObserver.observe(el); });
    const end = root.querySelector('[data-end]');
    if (end) endObserver.observe(end);
    emit();

    return () => {
      alive = false;
      renderObserver.disconnect();
      seenObserver.disconnect();
      endObserver.disconnect();
      running.forEach((ctl) => ctl.abort());
      pageCanvases.forEach((c) => { c.width = 0; c.height = 0; });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, tracker, width, track]);

  return (
    <div
      ref={scrollRef}
      data-testid="pdf-scroll"
      tabIndex={0}
      aria-label="Documento para leitura"
      className="relative h-[68dvh] min-h-[360px] overflow-y-auto overscroll-contain rounded-2xl border border-stone-200 bg-stone-100 p-2"
    >
      {failed ? (
        <Notice tone="bad" title="Não foi possível exibir o documento">
          O arquivo não abriu neste aparelho. Tente de novo e, se continuar, avise a administração do clube.
        </Notice>
      ) : !handle ? (
        <Spinner label="Abrindo o documento…" />
      ) : (
        <div className="flex flex-col gap-2">
          {handle.sizes.map((size, i) => (
            <div
              key={i}
              data-page={i + 1}
              className="relative w-full overflow-hidden rounded-lg bg-white shadow-sm"
              style={{ aspectRatio: `${size.width} / ${size.height}` }}
            >
              <canvas
                ref={(el) => { if (el) canvases.current.set(i + 1, el); else canvases.current.delete(i + 1); }}
                className="block h-full w-full"
                aria-label={`Página ${i + 1} de ${handle.pageCount}`}
              />
              <span className="pointer-events-none absolute bottom-1 right-2 rounded bg-black/40 px-1.5 text-[10px] font-bold text-white">{i + 1}/{handle.pageCount}</span>
            </div>
          ))}
          <div data-end className="h-2" aria-hidden />
        </div>
      )}
    </div>
  );
};
