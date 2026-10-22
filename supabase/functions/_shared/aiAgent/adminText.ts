// Formatação dos textos do assessor: dinheiro, data, horário e plural sempre do mesmo jeito em todas as mensagens.

export const centsBR = (v: unknown) => `R$ ${(Number(v ?? 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
export const dateBR = (v: unknown) => String(v ?? '').slice(0, 10).split('-').reverse().join('/');
/** "2026-11-01" → "11/2026". */
export const monthBR = (v: unknown) => `${String(v ?? '').slice(5, 7)}/${String(v ?? '').slice(0, 4)}`;

export const hhmm = (v: unknown) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(String(v)));
/** Dia e hora em um formato só: "22/10 às 18:00". */
export const whenBR = (v: unknown) => hhmm(v).replace(', ', ' às ');
/** Envio agendado: "agora" (até 90 s) ou "em 22/10 às 18:00". */
export const sendWhen = (v: unknown) => (new Date(String(v)).getTime() - Date.now() < 90_000 ? 'agora' : `em ${whenBR(v)}`);
/** Faixa de horário em um formato só: "22/10/2026, das 08:00 às 10:00". */
export const slotBR = (date: unknown, start: unknown, end: unknown) => `${dateBR(date)}, das ${start} às ${end}`;

/** Plural escrito por extenso, sem "(s)": `plural(2, 'cobrança nova')` → "2 cobranças novas". */
export function plural(n: unknown, one: string, many: string): string {
  const k = Number(n ?? 0);
  return `${k} ${k === 1 ? one : many}`;
}

const METHOD_TEXT: Record<string, string> = { pix: 'PIX', transfer: 'transferência', cash: 'dinheiro', card: 'cartão', other: 'outro meio' };
export const methodBR = (v: unknown) => METHOD_TEXT[String(v)] ?? String(v ?? '');

/** Sócios que ficam de fora de um envio: sem telefone válido ou pediram para não receber. */
export function skippedNote(n: unknown): string {
  const k = Number(n ?? 0);
  if (k <= 0) return '';
  return k === 1 ? '1 fica de fora por falta de telefone válido ou por ter pedido para não receber'
    : `${k} ficam de fora por falta de telefone válido ou por terem pedido para não receber`;
}
