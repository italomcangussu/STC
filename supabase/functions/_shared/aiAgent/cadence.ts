// Cadência de bolhas: como a resposta vira mensagens no WhatsApp.

import { toWhatsApp } from './whatsappFormat.ts';

/* ------------------------------- Cadência de bolhas ------------------------------- */

const MAX_BUBBLES = 4;
const MAX_CHARS = 320;
const MAX_BLOCK_CHARS = 1200;

/**
 * Cada item vindo do modelo é uma bolha. Texto com quebra de linha (lista, agenda, placar) fica inteiro numa
 * bolha, com as linhas preservadas; só um bloco grande demais é dividido entre parágrafos. Frase corrida longa
 * é cortada em fim de frase.
 */
function naturalParts(message: string): string[] {
  const texto = toWhatsApp(message);
  if (!texto) return [];
  return texto.includes('\n') ? blockParts(texto) : sentenceParts(texto);
}

function blockParts(texto: string): string[] {
  const out: string[] = [];
  let atual = '';
  for (const paragrafo of texto.split(/\n{2,}/)) {
    const junto = atual ? `${atual}\n\n${paragrafo}` : paragrafo;
    if (junto.length <= MAX_BLOCK_CHARS) { atual = junto; continue; }
    if (atual) out.push(atual);
    atual = paragrafo;
  }
  if (atual) out.push(atual);
  return out.flatMap((p) => (p.length > MAX_BLOCK_CHARS ? p.split('\n').flatMap(sentenceParts) : [p]));
}

function sentenceParts(seed: string): string[] {
  const out: string[] = [];
  let rest = seed.trim();
  while (rest.length > MAX_CHARS) {
    const janela = rest.slice(0, MAX_CHARS + 1);
    let corte = -1;
    const fim = /[.!?;…,:](?=\s)/g;
    let x: RegExpExecArray | null;
    while ((x = fim.exec(janela)) !== null) if (x.index + 1 >= MAX_CHARS / 2) corte = x.index + 1;
    if (corte < 0) corte = janela.lastIndexOf(' ') > 0 ? janela.lastIndexOf(' ') : MAX_CHARS;
    out.push(rest.slice(0, corte).trim());
    rest = rest.slice(corte).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** No máximo 4 bolhas, com tempo de "digitando" inclusive antes da primeira. O excedente vai para a última, em parágrafo próprio. */
export function cadence(messages: string[]): { text: string; delayMs: number }[] {
  const partes = messages.flatMap(naturalParts);
  const bolhas = partes.slice(0, MAX_BUBBLES);
  if (partes.length > MAX_BUBBLES) bolhas[MAX_BUBBLES - 1] = partes.slice(MAX_BUBBLES - 1).join('\n\n');
  return bolhas.map((text, i) => ({
    text,
    delayMs: i === 0
      ? Math.max(450, Math.min(1400, 280 + text.length * 11))
      : Math.max(700, Math.min(4200, 500 + text.length * 24)),
  }));
}
