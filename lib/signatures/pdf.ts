// Leitura do PDF na tela (pdfjs-dist, a mesma biblioteca que o comprovante já usa).
//
// A biblioteca só é baixada quando alguém abre um documento (import dinâmico): quem nunca assina nada
// não paga esse peso. O que a tela enxerga é só `PdfHandle`: tamanhos das páginas, desenhar uma página
// num canvas e encerrar. Assim a tela é testável sem o pdfjs.

export type PdfPageSize = { width: number; height: number };

export type PdfHandle = {
  pageCount: number;
  /** Tamanho de cada página (em pontos, escala 1): a tela reserva o espaço antes de desenhar. */
  sizes: PdfPageSize[];
  /** Desenha a página (1…N) com `cssWidth` px de largura. Resolve quando termina ou é cancelado por `signal`. */
  render(page: number, canvas: HTMLCanvasElement, cssWidth: number, pixelRatio: number, signal?: AbortSignal): Promise<void>;
  destroy(): Promise<void>;
};

/** Abre o PDF a partir dos bytes (já conferidos pelo hash). Rejeita se o arquivo não for um PDF legível. */
export async function openPdf(data: ArrayBuffer): Promise<PdfHandle> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  // O pdfjs entrega os bytes ao worker (a cópia original fica inutilizada): trabalha numa cópia.
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const doc = await task.promise;

  const sizes: PdfPageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const view = (await doc.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ width: view.width, height: view.height });
  }

  return {
    pageCount: doc.numPages,
    sizes,
    async render(pageNumber, canvas, cssWidth, pixelRatio, signal) {
      const page = await doc.getPage(pageNumber);
      if (signal?.aborted) return;
      const scale = (cssWidth / page.getViewport({ scale: 1 }).width) * pixelRatio;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const rendering = page.render({ canvas, viewport });
      const stop = () => rendering.cancel();
      signal?.addEventListener('abort', stop, { once: true });
      try {
        await rendering.promise;
      } catch (error) {
        // Cancelar (a página saiu de perto da tela) não é falha.
        if ((error as { name?: string } | null)?.name !== 'RenderingCancelledException') throw error;
      } finally {
        signal?.removeEventListener('abort', stop);
      }
    },
    destroy: () => task.destroy(),
  };
}
