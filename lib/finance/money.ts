/**
 * Dinheiro em centavos inteiros.
 *
 * Nada no financeiro usa `number` com casas decimais: o valor vive como inteiro
 * (`*_cents`) do banco à tela. Estas funções são a única porta entre texto /
 * `NUMERIC` legado e centavos, e a única que formata de volta.
 */

export type Cents = number;

/** Teto de sanidade (R$ 1 bilhão) — o mesmo `CHECK` do banco. */
export const MAX_CENTS: Cents = 100_000_000_000;

/** Divide a / b arredondando metade para cima (valores não negativos). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** `round(a * b / c)` sem estourar a precisão de `number`. Metade arredonda para cima. */
export function mulDivRound(a: Cents, b: number, c: number): Cents {
  if (c === 0) throw new Error('mulDivRound: divisão por zero');
  const negative = (a < 0) !== (b < 0);
  const n = BigInt(Math.abs(Math.trunc(a))) * BigInt(Math.abs(Math.trunc(b)));
  const r = Number(divRoundHalfUp(n, BigInt(Math.abs(Math.trunc(c)))));
  return negative ? -r : r;
}

/** Percentual em pontos-base (1% = 100 bps) aplicado a um valor em centavos. */
export function applyBps(base: Cents, bps: number): Cents {
  return mulDivRound(base, bps, 10_000);
}

/** Converte o `NUMERIC(10,2)` legado (ex.: `student_payments.amount`) em centavos. */
export function legacyAmountToCents(amount: number | string | null | undefined): Cents {
  if (amount === null || amount === undefined || amount === '') return 0;
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  // toPrecision remove o ruído binário (19.99 * 100 = 1998.9999999999998).
  return Math.round(Number((n * 100).toPrecision(15)));
}

/**
 * Lê texto de dinheiro em reais: "1.234,56", "1234,56", "1234.56", "R$ 50", "50".
 * Devolve `null` se não for um valor monetário reconhecível.
 */
export function parseBRL(input: string | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  const cleaned = String(input).replace(/R\$\s*/gi, '').replace(/\s+/g, '').trim();
  if (!cleaned || !/^-?[\d.,]+$/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');
  const decimalSep = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : null;

  let intPart: string;
  let fracPart = '';
  if (decimalSep) {
    const idx = body.lastIndexOf(decimalSep);
    const after = body.slice(idx + 1);
    const dotCount = body.split('.').length - 1;
    // "1.234" / "12.345.678": ponto sem vírgula e com 3 dígitos depois é milhar, não decimal.
    if (decimalSep === '.' && lastComma === -1 && (dotCount > 1 || after.length === 3)) {
      if (after.length !== 3) return null;
      intPart = body.replace(/\./g, '');
    } else if (after.length > 2) {
      return null;
    } else {
      intPart = body.slice(0, idx).replace(/[.,]/g, '');
      fracPart = after;
    }
  } else {
    intPart = body;
  }
  if (!/^\d+$/.test(intPart || '0') || (fracPart && !/^\d+$/.test(fracPart))) return null;
  const cents = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** `-0` (de uma negação de zero) apareceria como "-0,00". */
const noNegativeZero = (n: number) => (n === 0 ? 0 : n);

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/** "R$ 1.234,56". */
export function formatBRL(cents: Cents): string {
  return brl.format(cents / 100).replace(/\u00a0/g, ' ');
}

/** "1234,56" — para CSV/planilha (sem símbolo, sem milhar). */
export function formatDecimalBRL(cents: Cents): string {
  return plain.format(noNegativeZero(cents) / 100);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Reparte `total` em `parts` fatias inteiras que somam exatamente `total`.
 * O resto (centavos que não dividem) vai para a primeira fatia — regra fixa e
 * espelhada no SQL (`fin_spread_cents`).
 */
export function spreadCents(total: Cents, parts: number): Cents[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('spreadCents: parts inválido');
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  return Array.from({ length: parts }, (_, i) => sign * (i === 0 ? base + remainder : base));
}
