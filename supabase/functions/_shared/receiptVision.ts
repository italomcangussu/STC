// Segunda leitura do comprovante por IA (visão), quando o OCR fica em dúvida.
// Caso Diego (04/11): mensalidade de R$ 320 em PDF e em imagem; o OCR leu R$ 320 nas duas, mas com confiança baixa
// (o valor aparecia uma vez só, sem rótulo forte) e no PDF pegou "Pagador" como favorecido. O João pediu outra imagem
// duas vezes. Agora, com dúvida, a IA lê o mesmo arquivo; quando as duas leituras concordam, o campo fica confiável.
// Nada daqui decide finalidade nem dá baixa: só melhora valor, data, favorecido e situação do pagamento.

type Confidence = 'high' | 'low' | 'none';
type Read = Record<string, unknown> & { confidence?: Record<string, Confidence> };
export type VisionRead = {
  amount_cents: number | null; paid_on: string | null; payee: string | null; payee_document: string | null;
  identifier: string | null; completed: boolean | null;
};
export type VisionDeps = { apiKey: string; baseUrl?: string; model: string; fetch?: typeof fetch; timeoutMs?: number };

const PAYER_WORD = /^(?:pagador|remetente|origem|quem pagou|dados de quem pagou)$/i;
const FIELDS = ['amount', 'date', 'payee'] as const;

/** O OCR ficou em dúvida em algum campo que a baixa usa, ou leu um rótulo como favorecido. */
export function needsSecondRead(ocr: Read | null): boolean {
  if (!ocr) return true;
  const c = ocr.confidence ?? {};
  return FIELDS.some((f) => c[f] !== 'high') || PAYER_WORD.test(String(ocr.payee ?? '').trim());
}

const PROMPT = [
  'Você lê comprovantes de Pix e transferências bancárias brasileiras. Responda SOMENTE JSON:',
  '{"amount_cents":inteiro|null,"paid_on":"AAAA-MM-DD"|null,"payee":"nome de quem RECEBEU"|null,"payee_document":"CNPJ ou CPF só dígitos"|null,',
  '"identifier":"ID da transação (E2E, começa com E)"|null,"completed":true|false|null}.',
  'amount_cents é o valor transferido em centavos (R$ 320,00 = 32000), nunca tarifa, saldo ou limite.',
  'payee é o favorecido/destinatário, nunca o pagador. completed=false se for agendamento, pendente, cancelado ou falhou.',
  'Campo que não dá para ler com certeza: null. Não invente.',
].join('\n');

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

function filePart(bytes: Uint8Array, mime: string) {
  const data = `data:${mime};base64,${toBase64(bytes)}`;
  return mime === 'application/pdf'
    ? { type: 'file', file: { filename: 'comprovante.pdf', file_data: data } }
    : { type: 'image_url', image_url: { url: data } };
}

const intOrNull = (v: unknown) => (Number.isInteger(v) && Number(v) > 0 ? Number(v) : null);
const textOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);
const dateOrNull = (v: unknown) => (typeof v === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(v) ? v : null);

export function parseVision(output: string): VisionRead | null {
  let j: Record<string, unknown>;
  try { j = JSON.parse(output.replace(/^```(?:json)?|```$/g, '').trim()); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const doc = textOrNull(j.payee_document)?.replace(/\D/g, '') ?? '';
  return {
    amount_cents: intOrNull(j.amount_cents), paid_on: dateOrNull(j.paid_on), payee: textOrNull(j.payee),
    payee_document: doc.length === 11 || doc.length === 14 ? doc : null, identifier: textOrNull(j.identifier),
    completed: typeof j.completed === 'boolean' ? j.completed : null,
  };
}

/** Falha da IA (rede, chave, resposta torta) devolve null: fica a leitura do OCR como estava. */
export async function visionRead(bytes: Uint8Array, mime: string, deps: VisionDeps): Promise<VisionRead | null> {
  try {
    const url = `${(deps.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '')}/chat/completions`;
    const r = await (deps.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.apiKey}`, 'x-title': 'STC Comprovantes' },
      body: JSON.stringify({
        model: deps.model, temperature: 0, max_tokens: 300, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: [{ type: 'text', text: 'Leia este comprovante.' }, filePart(bytes, mime)] }],
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 30000),
    });
    if (!r.ok) return null;
    const body = await r.json() as { choices?: { message?: { content?: unknown } }[] };
    return parseVision(String(body.choices?.[0]?.message?.content ?? ''));
  } catch { return null; }
}

/**
 * Junta as duas leituras, campo a campo:
 *  · concordam → confiança alta;
 *  · o OCR não leu ou ficou em dúvida e a IA leu → vale a IA, com confiança alta (a baixa ainda confere valor exato,
 *    favorecido e duplicado contra o banco);
 *  · o OCR tinha certeza e a IA discorda → fica o OCR, rebaixado para dúvida (duas leituras diferentes não são certeza).
 */
export function mergeVision(ocr: Read | null, ai: VisionRead | null, mime: string): Read | null {
  if (!ai) return ocr;
  const m: Merge = {
    base: ocr ? { ...ocr } : { engine: mime === 'application/pdf' ? 'pdfjs-server' : 'tesseract-server' },
    conf: { amount: 'none', date: 'none', payee: 'none', identifier: 'none', ...(ocr?.confidence ?? {}) },
  };
  pick(m, { key: 'amount_cents', field: 'amount', value: ai.amount_cents }, (a, b) => Number(a) === Number(b));
  pick(m, { key: 'paid_on', field: 'date', value: ai.paid_on }, (a, b) => a === b);
  pick(m, { key: 'payee', field: 'payee', value: ai.payee }, (a, b) => fold(a).includes(fold(b)) || fold(b).includes(fold(a)));
  fillGaps(m, ai);
  return { ...m.base, confidence: m.conf, ai_checked: true };
}

type Merge = { base: Read; conf: Record<string, Confidence> };
type Field = { key: string; field: string; value: unknown };
const fold = (v: unknown) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function currentValue(m: Merge, f: Field): unknown {
  const v = m.base[f.key];
  return f.field === 'payee' && PAYER_WORD.test(String(v ?? '').trim()) ? null : v;
}

function pick(m: Merge, f: Field, same: (a: unknown, b: unknown) => boolean): void {
  if (f.value == null) return;
  const atual = currentValue(m, f);
  if (atual != null && same(atual, f.value)) { m.conf[f.field] = 'high'; return; }
  if (atual != null && m.conf[f.field] === 'high') { m.conf[f.field] = 'low'; return; }
  m.base[f.key] = f.value;
  m.conf[f.field] = 'high';
}

/** O que só a IA leu (documento, ID) entra; pagamento não concluído derruba a confiança de valor e data. */
function fillGaps(m: Merge, ai: VisionRead): void {
  if (!m.base.payee_document && ai.payee_document) m.base.payee_document = ai.payee_document;
  if (!m.base.identifier && ai.identifier) {
    m.base.identifier = ai.identifier;
    m.conf.identifier = /^E\d{8}/.test(ai.identifier) ? 'high' : 'low';
  }
  if (ai.completed !== false || m.base.payment_status) return;
  m.base.payment_status = 'pending';
  m.conf.amount = 'low';
  m.conf.date = 'low';
}
