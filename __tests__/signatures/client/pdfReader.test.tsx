import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingSnapshot } from '../../../lib/signatures/reading';

const openPdf = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/signatures/pdf', () => ({ openPdf }));

import { PdfReader } from '../../../components/signatures/PdfReader';

// ---- IntersectionObserver controlável ------------------------------------------------------------
type Entry = Partial<IntersectionObserverEntry> & { target: Element };
class FakeObserver {
  static all: FakeObserver[] = [];
  targets = new Set<Element>();
  disconnected = false;
  constructor(public callback: (entries: Entry[]) => void, public options: IntersectionObserverInit = {}) { FakeObserver.all.push(this); }
  observe(el: Element) { this.targets.add(el); }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.disconnected = true; this.targets.clear(); }
  /** Observador que decide quando desenhar (margem de 150%), quando contar página vista, e o do "fim". */
  static get render() { return FakeObserver.live().find((o) => o.options.rootMargin === '150% 0px')!; }
  static get seen() { return FakeObserver.live().find((o) => Array.isArray(o.options.threshold))!; }
  static get end() { return FakeObserver.live().find((o) => o.options.threshold === 0 && !o.options.rootMargin)!; }
  static live() { return FakeObserver.all.filter((o) => !o.disconnected); }
}

const page = (n: number) => document.querySelector(`[data-page="${n}"]`)!;
const endMarker = () => document.querySelector('[data-end]')!;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

// Os observadores nascem num efeito, logo depois de a página aparecer: espera por eles antes de agir.
const observersReady = () => vi.waitFor(() => expect(FakeObserver.live()).toHaveLength(3));

const intoRenderZone = async (n: number, isIntersecting = true) => {
  await observersReady();
  await act(async () => { FakeObserver.render.callback([{ target: page(n), isIntersecting }]); await Promise.resolve(); await Promise.resolve(); });
};
const onScreen = async (n: number, visibleHeight = 400) => {
  await observersReady();
  await act(async () => {
    FakeObserver.seen.callback([{
      target: page(n), isIntersecting: visibleHeight > 0,
      intersectionRect: { height: visibleHeight } as DOMRectReadOnly, boundingClientRect: { height: 500 } as DOMRectReadOnly, rootBounds: { height: 600 } as DOMRectReadOnly,
    }]);
  });
};
const reachEnd = async () => {
  await observersReady();
  await act(async () => { FakeObserver.end.callback([{ target: endMarker(), isIntersecting: true }]); });
};

function fakePdf(pageCount = 3) {
  const render = vi.fn(async () => undefined);
  const destroy = vi.fn(async () => undefined);
  const handle = { pageCount, sizes: Array.from({ length: pageCount }, () => ({ width: 600, height: 800 })), render, destroy };
  openPdf.mockResolvedValue(handle);
  return handle;
}

const bytes = new ArrayBuffer(8);
const last = (fn: ReturnType<typeof vi.fn>): ReadingSnapshot => fn.mock.calls.at(-1)![0];

beforeEach(() => {
  FakeObserver.all = [];
  openPdf.mockReset();
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('leitor de PDF', () => {
  it('reserva o espaço de todas as páginas e desenha só as que chegam perto da tela', async () => {
    const pdf = fakePdf(3);
    render(<PdfReader data={bytes} expectedPages={3} track onProgress={vi.fn()} />);
    expect(await screen.findByLabelText('Página 1 de 3')).toBeInTheDocument();
    expect(document.querySelectorAll('canvas')).toHaveLength(3);
    expect(pdf.render).not.toHaveBeenCalled();

    await intoRenderZone(2);
    expect(pdf.render).toHaveBeenCalledTimes(1);
    expect(pdf.render.mock.calls[0][0]).toBe(2);
  });

  it('avisa quando a primeira página aparece (o servidor carimba "começou a ler")', async () => {
    fakePdf(2);
    const onReady = vi.fn();
    render(<PdfReader data={bytes} expectedPages={2} track onReady={onReady} />);
    await screen.findByLabelText('Página 1 de 2');
    await intoRenderZone(1);
    await intoRenderZone(2);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('libera a memória da página que se afastou e cancela o desenho em andamento', async () => {
    const pdf = fakePdf(2);
    let signal: AbortSignal | undefined;
    pdf.render.mockImplementation(async (_n: number, _c: HTMLCanvasElement, _w: number, _r: number, s?: AbortSignal) => { signal = s; return new Promise<void>(() => undefined); });
    render(<PdfReader data={bytes} expectedPages={2} track />);
    await screen.findByLabelText('Página 1 de 2');
    const canvas = document.querySelector('canvas')!;
    canvas.width = 500;

    await intoRenderZone(1);
    await intoRenderZone(1, false);

    expect(signal?.aborted).toBe(true);
    expect(canvas.width).toBe(0);
  });

  describe('regra "leia até o fim"', () => {
    const setup = async (pages = 3) => {
      fakePdf(pages);
      const onProgress = vi.fn();
      render(<PdfReader data={bytes} expectedPages={pages} track onProgress={onProgress} />);
      await screen.findByLabelText(`Página 1 de ${pages}`);
      return onProgress;
    };

    it('só conta como lido com TODAS as páginas vistas E o fim alcançado', async () => {
      const onProgress = await setup(3);
      for (const n of [1, 2, 3]) { await intoRenderZone(n); await onScreen(n); }
      expect(last(onProgress)).toMatchObject({ pagesSeen: 3, endReached: false, complete: false });

      await reachEnd();
      expect(last(onProgress)).toMatchObject({ pagesSeen: 3, endReached: true, complete: true, percent: 100 });
    });

    it('pular para o fim sem passar pelas páginas do meio NÃO conclui', async () => {
      const onProgress = await setup(3);
      await intoRenderZone(1); await onScreen(1);
      await intoRenderZone(3); await onScreen(3);
      await reachEnd();
      expect(last(onProgress)).toMatchObject({ pagesSeen: 2, endReached: true, complete: false });
    });

    it('página visível mas AINDA em branco (não desenhada) não conta', async () => {
      const onProgress = await setup(1);
      await onScreen(1);                       // apareceu, mas não foi desenhada
      await reachEnd();
      expect(last(onProgress)).toMatchObject({ pagesSeen: 0, complete: false });

      await intoRenderZone(1);                 // ao terminar de desenhar, conta (ainda está na tela)
      expect(last(onProgress)).toMatchObject({ pagesSeen: 1, complete: true });
    });

    it('só um pedacinho da página na tela não conta como vista', async () => {
      const onProgress = await setup(1);
      await intoRenderZone(1);
      await onScreen(1, 50);                   // 50 de 500 px: menos de 40%
      await reachEnd();
      expect(last(onProgress)).toMatchObject({ pagesSeen: 0, complete: false });
    });

    it('o progresso sobrevive ao redesenho (girar o aparelho muda a largura)', async () => {
      let resized: (() => void) | undefined;
      vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resized = cb; } observe() {} disconnect() {} });
      const onProgress = await setup(2);
      for (const n of [1, 2]) { await intoRenderZone(n); await onScreen(n); }
      expect(last(onProgress).pagesSeen).toBe(2);

      const antes = FakeObserver.live();
      Object.defineProperty(document.querySelector('[data-testid="pdf-scroll"]')!, 'clientWidth', { value: 900, configurable: true });
      await act(async () => { resized!(); });

      // os observadores foram refeitos para a nova largura…
      expect(antes.every((o) => o.disconnected)).toBe(true);
      expect(FakeObserver.live()).toHaveLength(3);
      // …mas as páginas já vistas continuam valendo: só falta chegar ao fim
      await reachEnd();
      expect(last(onProgress)).toMatchObject({ pagesSeen: 2, endReached: true, complete: true });
    });
  });

  it('ao rever um documento já assinado não rastreia nada', async () => {
    fakePdf(1);
    const onProgress = vi.fn();
    render(<PdfReader data={bytes} expectedPages={1} track={false} onProgress={onProgress} />);
    await screen.findByLabelText('Página 1 de 1');
    await intoRenderZone(1); await onScreen(1); await reachEnd();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('PDF com número de páginas diferente do cadastro é recusado (a leitura nunca fecharia)', async () => {
    const pdf = fakePdf(4);
    const onError = vi.fn();
    render(<PdfReader data={bytes} expectedPages={3} track onError={onError} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível exibir o documento');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'PAGE_COUNT_MISMATCH' }));
    expect(pdf.destroy).toHaveBeenCalled();
  });

  it('arquivo ilegível mostra o aviso e informa a tela', async () => {
    openPdf.mockRejectedValue(new Error('Invalid PDF'));
    const onError = vi.fn();
    render(<PdfReader data={bytes} expectedPages={1} track onError={onError} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('erro ao desenhar uma página bloqueia (não dá para "ler" o que não aparece)', async () => {
    const pdf = fakePdf(1);
    pdf.render.mockRejectedValue(new Error('canvas'));
    const onError = vi.fn();
    render(<PdfReader data={bytes} expectedPages={1} track onError={onError} />);
    await screen.findByLabelText('Página 1 de 1');
    await intoRenderZone(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('encerra o pdfjs ao sair da tela', async () => {
    const pdf = fakePdf(1);
    const { unmount } = render(<PdfReader data={bytes} expectedPages={1} track />);
    await screen.findByLabelText('Página 1 de 1');
    unmount();
    expect(pdf.destroy).toHaveBeenCalled();
  });
});
