/**
 * Validação do arquivo do comprovante — tipo, tamanho e CONTEÚDO (bytes mágicos),
 * não só a extensão. Roda no aparelho antes de qualquer envio; o bucket repete
 * o limite de tamanho e a lista de tipos no servidor.
 *
 * Limite: o servidor valida o `Content-Type` e o tamanho, mas não os bytes —
 * por isso a checagem de conteúdo acontece aqui.
 */
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type ReceiptMime = (typeof RECEIPT_TYPES)[number];

const EXT: Record<ReceiptMime, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
};

export type FileCheck = { ok: true; type: ReceiptMime } | { ok: false; reason: string };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

/** Tipo REAL do arquivo pelos primeiros bytes (ou `null` se não for aceito). */
export function sniffReceiptType(head: Uint8Array): ReceiptMime | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(head, 8, 12))) return 'image/heic';
  return null;
}

export function validateReceiptFile(file: { name: string; type: string; size: number }, head: Uint8Array): FileCheck {
  if (!file.size || file.size <= 0) return { ok: false, reason: 'O arquivo está vazio.' };
  if (file.size > RECEIPT_MAX_BYTES) return { ok: false, reason: 'O arquivo passa de 10 MB. Envie uma foto menor ou um PDF mais leve.' };
  const real = sniffReceiptType(head);
  if (!real) return { ok: false, reason: 'Formato não aceito. Envie imagem (JPG, PNG, WEBP, HEIC) ou PDF.' };
  // Declarado ≠ real: nome/tipo enganoso (ex.: executável renomeado para .png).
  const declared = (file.type || '').toLowerCase();
  if (declared && (RECEIPT_TYPES as readonly string[]).includes(declared) && declared !== real) {
    return { ok: false, reason: 'O conteúdo do arquivo não corresponde ao tipo informado.' };
  }
  if (declared && !(RECEIPT_TYPES as readonly string[]).includes(declared) && declared !== 'application/octet-stream') {
    return { ok: false, reason: 'Formato não aceito. Envie imagem (JPG, PNG, WEBP, HEIC) ou PDF.' };
  }
  return { ok: true, type: real };
}

/** Nome seguro para o caminho no bucket: só `[A-Za-z0-9._-]`, com a extensão do tipo REAL. */
export function safeReceiptFileName(name: string, type: ReceiptMime): string {
  const leaf = name.split(/[\\/]/).pop() ?? '';
  const base = leaf.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'comprovante';
  return `${base}.${EXT[type]}`;
}

/** SHA-256 em hexadecimal (detecta o mesmo arquivo enviado duas vezes). */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Caminho no bucket privado: `<uid>/<envio>/<arquivo>` (o RLS lê a 1ª pasta). */
export const receiptStoragePath = (uid: string, submissionId: string, fileName: string) => `${uid}/${submissionId}/${fileName}`;
