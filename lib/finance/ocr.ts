/**
 * Leitura automática (OCR) do comprovante, NO APARELHO do sócio.
 *
 *  - Imagens: `tesseract.js` (Apache-2.0), português + inglês.
 *  - PDF com texto: `pdfjs-dist` (Apache-2.0), extrai a camada de texto.
 *
 * Privacidade: o arquivo não sai do aparelho para ser lido; o texto lido vai
 * direto para `parseReceiptText` e é descartado — nunca é gravado nem logado.
 * Custo: nenhum serviço pago. Os dados de idioma/WASM do Tesseract são baixados
 * de um CDN público na 1ª leitura (não contêm dado do usuário); para hospedar
 * por conta própria, defina `VITE_OCR_ASSETS_URL` (ver docs/financeiro).
 *
 * As duas bibliotecas são carregadas só quando há leitura (import dinâmico):
 * não pesam no app de quem não envia comprovante. Falha, falta de rede ou PDF
 * escaneado viram `unreadable`/`failed` — o sócio informa os dados à mão.
 */
import { isReadable, parseReceiptText, toStoredOcr, type ExtractedReceipt } from './receiptText';
import type { ReceiptMime } from './receiptFile';

export type OcrOutcome =
  | { status: 'ok'; extracted: ExtractedReceipt; stored: Record<string, unknown> }
  | { status: 'unreadable' | 'failed'; extracted: null; stored: null };

const OCR_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ocr_timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function textFromPdf(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Junta por linha usando a posição vertical para preservar "rótulo ↵ valor".
    let lastY: number | null = null;
    let line = '';
    const lines: string[] = [];
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform ? Math.round(item.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
      line += (line && !line.endsWith(' ') ? ' ' : '') + item.str;
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  await task.destroy();
  return pages.join('\n');
}

async function textFromImage(blob: Blob, onProgress?: (pct: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const base = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_OCR_ASSETS_URL;
  const worker = await createWorker(['por', 'eng'], 1, {
    ...(base ? { workerPath: `${base}/worker.min.js`, corePath: base, langPath: base } : {}),
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') onProgress?.(Math.round(m.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(blob);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}

/** Lê o comprovante e devolve só campos estruturados sugeridos (nunca o texto). */
export async function readReceipt(file: Blob, type: ReceiptMime, onProgress?: (pct: number) => void): Promise<OcrOutcome> {
  try {
    const text = await withTimeout(
      type === 'application/pdf' ? file.arrayBuffer().then(textFromPdf) : textFromImage(file, onProgress),
      OCR_TIMEOUT_MS,
    );
    const extracted = parseReceiptText(text);
    // `text` sai de escopo aqui: nada dele é guardado ou registrado.
    if (!isReadable(extracted)) return { status: 'unreadable', extracted: null, stored: null };
    return { status: 'ok', extracted, stored: toStoredOcr(extracted, type === 'application/pdf' ? 'pdfjs' : 'tesseract') };
  } catch {
    // Sem detalhe no log de propósito: a mensagem poderia conter trecho do documento.
    return { status: 'failed', extracted: null, stored: null };
  }
}
