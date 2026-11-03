// De que é o comprovante: o assunto da conversa decide, não uma ordem fixa. Vale o assunto mais RECENTE das últimas
// mensagens (da pessoa ou do João): quem acabou de se inscrever e manda o Pix está pagando a inscrição, mesmo sendo sócio
// com mensalidade em aberto. Sem assunto claro, o valor decide (cada conferência só baixa quando o valor bate exatamente).

import type { Ctx } from './promptTypes.ts';

export type ReceiptTopic = 'campeonato' | 'mensalidade' | 'card';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const TOPICS: [ReceiptTopic, RegExp][] = [
  ['campeonato', /\b(inscri[cç][aã]o|inscrev|campeonato|serra e sertao|torneio|classe|camisa)/],
  ['mensalidade', /\b(mensalidade|mes de|cobranca do mes)/],
  ['card', /\b(card|aluno|renova)/],
];

const MAX_MESSAGES = 10;

/** Assunto da conversa que o comprovante provavelmente paga; null quando nada nas últimas mensagens aponta. */
export function receiptTopic(transcript: Ctx[]): ReceiptTopic | null {
  const recentes = transcript.filter((m) => m.body).slice(-MAX_MESSAGES).reverse();
  for (const m of recentes) {
    const texto = fold(String(m.body));
    const achado = TOPICS.find(([, re]) => re.test(texto));
    if (achado) return achado[0];
  }
  return null;
}

const MINE = /\b(meu|minha|meus|minhas|paguei)\b/;

/**
 * O administrador disse que a mensalidade é DELE ("meu comprovante da mensalidade", "mensalidade de Hermeson Veras").
 * Sem isso, comprovante de mensalidade que o admin manda é de outro sócio e nunca baixa a cobrança dele por coincidência de valor.
 */
export function talksAboutOwnMembership(transcript: Ctx[], ownName: string): boolean {
  const primeiro = fold(ownName.trim().split(/\s+/)[0] ?? '');
  return transcript.filter((m) => m.direction === 'inbound' && m.body).slice(-6).some((m) => {
    const texto = fold(String(m.body));
    return /\bmensalidade/.test(texto) && (MINE.test(texto) || (primeiro.length > 2 && texto.includes(primeiro)));
  });
}
