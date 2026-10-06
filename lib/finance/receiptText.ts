/**
 * Leitura assistida do TEXTO de um comprovante (Pix/transferência/boleto).
 *
 * Isto só SUGERE: a leitura automática não é confirmação bancária e nunca
 * quita nada. Procura, sem inventar, o que o texto realmente mostra:
 * valor, data, identificador da transação e favorecido.
 *
 * Privacidade: devolve só campos estruturados. O texto bruto não é guardado,
 * não vai para log e não sai desta função. CPF/CNPJ e dados do pagador não
 * são extraídos.
 */
import { parseBRL } from './money';
import { isIsoDate, type IsoDate } from './dates';

export type FieldConfidence = 'high' | 'low' | 'none';

export interface ExtractedReceipt {
  amountCents: number | null;
  amountCandidates: number[];
  paidOn: IsoDate | null;
  dateCandidates: IsoDate[];
  identifier: string | null;
  payee: string | null;
  confidence: { amount: FieldConfidence; date: FieldConfidence; identifier: FieldConfidence; payee: FieldConfidence };
}

const MONTHS: Record<string, number> = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, mai: 5, junho: 6, jun: 6,
  julho: 7, jul: 7, agosto: 8, ago: 8, setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clean = (s: string) => s.replace(/[ \t\r]+/g, ' ').trim();

const MONEY_RE = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\d)/g;
const NOISE_LINE = /tarifa|taxa|juros|multa|desconto|saldo|limite|iof|encargo|abatimento|cashback|parcela/;

function pad2(n: number) { return String(n).padStart(2, '0'); }
function iso(y: number, m: number, d: number): IsoDate | null {
  const v = `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
  return isIsoDate(v) && y >= 2000 && y <= 2100 ? v : null;
}

interface Found<T> { value: T; line: number; priority: number }

const MONEY_BEFORE_LABEL = /tarifa|taxa|juros|multa|desconto|saldo|limite/;

function findAmounts(lines: string[]): Found<number>[] {
  const out: Found<number>[] = [];
  lines.forEach((raw, idx) => {
    const line = strip(raw);
    const prev = idx > 0 ? strip(lines[idx - 1]) : '';
    if (NOISE_LINE.test(line)) return;
    for (const m of raw.matchAll(MONEY_RE)) {
      const cents = parseBRL(m[1]);
      if (cents === null || cents <= 0) continue;
      const label = `${line} ${/valor|total|pago|transfer|pix/.test(prev) && !MONEY_BEFORE_LABEL.test(prev) ? prev : ''}`;
      let priority = /r\$/i.test(m[0]) ? 1 : 0;
      if (/valor (pago|da transfer|do pix|da transa|total|do pagamento|enviado|recebido)/.test(label)) priority = 3;
      else if (/valor|total pago|total/.test(label)) priority = 2;
      out.push({ value: cents, line: idx, priority });
    }
  });
  return out;
}
function findDates(lines: string[]): Found<IsoDate>[] {
  const out: Found<IsoDate>[] = [];
  lines.forEach((raw, idx) => {
    const line = strip(raw);
    const near = `${idx > 0 ? strip(lines[idx - 1]) : ''} ${line}`;
    const push = (d: IsoDate | null) => {
      if (!d) return;
      let priority = 1;
      if (/vencimento|vence |validade|agendad/.test(line)) priority = 0;
      else if (/pago em|data do pagamento|data da transfer|realizad|efetivad|data\b|hora|concluid/.test(near)) priority = 3;
      out.push({ value: d, line: idx, priority });
    };
    for (const m of raw.matchAll(/\b(\d{2})[/.](\d{2})[/.](\d{4})\b/g)) push(iso(Number(m[3]), Number(m[2]), Number(m[1])));
    for (const m of raw.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(iso(Number(m[1]), Number(m[2]), Number(m[3])));
    for (const m of strip(raw).matchAll(/\b(\d{1,2}) (?:de )?([a-z]{3,9})\.? (?:de )?(\d{4})\b/g)) {
      const mo = MONTHS[m[2]];
      if (mo) push(iso(Number(m[3]), mo, Number(m[1])));
    }
  });
  return out;
}

const E2E_RE = /\bE\d{8}\d{8}\d{4}[A-Za-z0-9]{11}\b/;
const ID_LABEL_RE = /(?:autentica[cç][aã]o|id da transa[cç][aã]o|id transa[cç][aã]o|c[oó]digo de transa[cç][aã]o|c[oó]digo da transa[cç][aã]o|protocolo|n[uú]mero da transa[cç][aã]o|nsu)\s*[:-]?\s*([A-Za-z0-9.-]{6,64})/i;

function findIdentifier(text: string): { value: string | null; confidence: FieldConfidence } {
  const e2e = E2E_RE.exec(text);
  if (e2e) return { value: e2e[0], confidence: 'high' };
  const labeled = ID_LABEL_RE.exec(text);
  if (labeled) return { value: labeled[1].slice(0, 64), confidence: 'low' };
  return { value: null, confidence: 'none' };
}

const PAYEE_LABEL = /^(?:favorecido|recebedor|destinat[aá]rio|benefici[aá]rio|quem recebeu|nome do recebedor|destino|para)\s*[:-]?\s*(.*)$/i;
const NOT_A_NAME = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|r\$|ag[eê]ncia|conta|chave|cpf|cnpj|banco|institui/i;

function findPayee(lines: string[]): { value: string | null; confidence: FieldConfidence } {
  for (let i = 0; i < lines.length; i++) {
    const m = PAYEE_LABEL.exec(clean(lines[i]));
    if (!m) continue;
    let candidate = clean(m[1]);
    if (!candidate) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = clean(lines[j]);
        if (!next || /^nome$/i.test(next)) continue; // "Destino ↵ Nome ↵ <nome>"
        candidate = next;
        break;
      }
    }
    if (candidate.length >= 3 && candidate.length <= 80 && !NOT_A_NAME.test(candidate) && /[A-Za-zÀ-ÿ]{3}/.test(candidate)) {
      return { value: candidate, confidence: 'high' };
    }
  }
  return { value: null, confidence: 'none' };
}

export function parseReceiptText(text: string): ExtractedReceipt {
  const lines = text.replace(/\u00a0/g, ' ').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);

  const amounts = findAmounts(lines);
  const top = amounts.reduce((m, a) => Math.max(m, a.priority), -1);
  const best = amounts.filter((a) => a.priority === top);
  const bestValues = [...new Set(best.map((a) => a.value))];
  const amountCents = best.length > 0 ? best[0].value : null;
  const amountConfidence: FieldConfidence = amountCents === null ? 'none' : top >= 2 && bestValues.length === 1 ? 'high' : 'low';

  const dates = findDates(lines);
  const topD = dates.reduce((m, d) => Math.max(m, d.priority), -1);
  const bestD = dates.filter((d) => d.priority === topD && d.priority > 0);
  const paidOn = bestD.length > 0 ? bestD[0].value : null;
  const dateConfidence: FieldConfidence = paidOn === null ? 'none' : topD >= 3 && new Set(bestD.map((d) => d.value)).size === 1 ? 'high' : 'low';

  const id = findIdentifier(text);
  const payee = findPayee(lines);

  return {
    amountCents,
    amountCandidates: [...new Set(amounts.map((a) => a.value))],
    paidOn,
    dateCandidates: [...new Set(dates.filter((d) => d.priority > 0).map((d) => d.value))],
    identifier: id.value,
    payee: payee.value,
    confidence: { amount: amountConfidence, date: dateConfidence, identifier: id.confidence, payee: payee.confidence },
  };
}

/** Algo útil foi lido? (senão o comprovante é tratado como ilegível). */
export function isReadable(e: ExtractedReceipt): boolean {
  return e.amountCents !== null || e.paidOn !== null || e.identifier !== null;
}

/** O que vai para o banco: só estes campos estruturados (jamais o texto). */
export function toStoredOcr(e: ExtractedReceipt, engine: string): Record<string, unknown> {
  return {
    engine,
    amount_cents: e.amountCents,
    paid_on: e.paidOn,
    identifier: e.identifier,
    payee: e.payee,
    confidence: e.confidence,
  };
}
