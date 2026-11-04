// Finalidade do comprovante pelo sentido da conversa, não por palavra exata.
// Caso Ítalo (04/11): "É a mensalidade de novembro" e "Confirmo" não batiam com as expressões esperadas ("minha
// mensalidade", "sim") e o João não deu baixa. A IA lê a conversa e diz o que a pessoa quis dizer; quando não dá
// para ter certeza, o João pergunta em vez de afirmar. A baixa continua no banco, que confere valor, favorecido e duplicado.

import type { Ctx } from './promptTypes.ts';

type Chat = (messages: { role: 'system' | 'user' | 'assistant'; content: string }[], config: { model: string; temperature?: number; maxTokens?: number; json?: boolean }) => Promise<{ output: string }>;
export type OwnMembershipVerdict = { verdict: 'own' | 'not_own' | 'unclear' | 'unrelated'; month: string | null };
export type ReplyIntent = 'yes' | 'no' | 'other';

const recent = (transcript: Ctx[], n = 8) => transcript.filter((m) => m.body).slice(-n)
  .map((m) => `${m.direction === 'inbound' ? 'Pessoa' : 'João'}: ${String(m.body).slice(0, 400)}`).join('\n');

const parse = (output: string): Record<string, unknown> => {
  try { const j = JSON.parse(output); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
};

const OWN_PROMPT = [
  'Um administrador do clube que também é sócio mandou um comprovante de Pix para o clube. O valor do comprovante bate',
  'com a mensalidade em aberto DELE do mês indicado. Decida, pelo sentido da conversa, se ele quis dizer que é a',
  'mensalidade dele. Responda SOMENTE JSON: {"verdict":"own|not_own|unclear|unrelated","month":"AAAA-MM"|null}.',
  'own: ele disse ou confirmou que é a mensalidade (dele ou sem citar outra pessoa), por qualquer palavra',
  '("é a mensalidade de novembro", "confirmo", "isso", "pode baixar", "👍" respondendo à pergunta do João).',
  'not_own: falou de outro sócio, aluno, Card, inscrição, despesa ou outra finalidade.',
  'unrelated: a última mensagem dele é sobre outro assunto, não sobre o comprovante.',
  'unclear: fala do comprovante, mas não dá para ter certeza. Na dúvida, unclear. month: o mês que ele citou; sem citar, null.',
].join('\n');

/** null quando não há IA ou ela falhou: quem chama segue o caminho sem IA. */
export async function ownMembershipVerdict(chat: Chat | null | undefined, model: string | undefined,
  input: { transcript: Ctx[]; amount: string; month: string }): Promise<OwnMembershipVerdict | null> {
  if (!chat || !model) return null;
  try {
    const { output } = await chat([
      { role: 'system', content: OWN_PROMPT },
      { role: 'user', content: `Comprovante: ${input.amount}. Mensalidade dele em aberto que bate: ${input.month.slice(0, 7)}.\nConversa:\n${recent(input.transcript)}` },
    ], { model, temperature: 0, maxTokens: 60, json: true });
    const j = parse(output);
    const verdict = ['own', 'not_own', 'unrelated'].includes(String(j.verdict)) ? j.verdict as OwnMembershipVerdict['verdict'] : 'unclear';
    const month = typeof j.month === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(j.month) ? `${j.month}-01` : null;
    return { verdict, month };
  } catch { return null; }
}

const REPLY_PROMPT = [
  'O João fez uma pergunta de confirmação. Decida se a resposta da pessoa confirma, recusa ou é outra coisa.',
  'Responda SOMENTE JSON: {"intent":"yes|no|other"}. Qualquer forma de concordar vale yes ("pode", "isso aí", "fechado",',
  '"👍", "pode registrar"). Correção ou "não é isso" vale no. Pergunta nova, outro assunto ou dúvida vale other. Na dúvida, other.',
].join('\n');

type Ai = { chat: Chat | null | undefined; model: string | undefined };

export async function replyIntent({ chat, model }: Ai, turn: { question: string; reply: string }): Promise<ReplyIntent | null> {
  if (!chat || !model) return null;
  try {
    const { output } = await chat([
      { role: 'system', content: REPLY_PROMPT },
      { role: 'user', content: `Pergunta do João: ${turn.question.slice(0, 600)}\nResposta: ${turn.reply.slice(0, 300)}` },
    ], { model, temperature: 0, maxTokens: 20, json: true });
    const intent = parse(output).intent;
    return intent === 'yes' || intent === 'no' ? intent : 'other';
  } catch { return null; }
}
