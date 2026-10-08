// Texto dos parabéns do João: o modelo escreve com as memórias da pessoa; sem modelo (ou resposta fora do formato),
// sai um texto pronto. O servidor sempre põe a menção no começo da mensagem do grupo.

export type Birthday = { profile_id: string; name: string; phone: string | null; direct_conversation_id: string | null; memories: string[] };
export type BirthdayTexts = { group: string; direct: string[] };

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const GROUP_FALLBACK = [
  (n: string) => `parabéns, ${n}! 🎂🎾 Hoje o play é seu: escolhe a quadra, o horário e até o parceiro. Muita saúde, muito jogo e que o saque entre mais que a desculpa de raquete 😂`,
  (n: string) => `hoje é dia do ${n}! 🎂 Parabéns, meu amigo: que venha um ano de bola na linha, vitória no ranking e resenha boa com a turma 🎾`,
  (n: string) => `alô, turma: hoje o aniversariante é o ${n}! 🎉 Parabéns! Hoje vale até pedir replay de ponto perdido 😂`,
];
const DIRECT_FALLBACK = (n: string) => [
  `Fala, ${n}! Aqui é o João, do STC. Feliz aniversário! 🎂`,
  'Que venha um ano de muito tênis, subida no ranking e resenha boa com a turma. Se quiser comemorar em quadra hoje, é só me dizer o horário que eu vejo pra você.',
];

const seedOf = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);

export function fallbackTexts(b: Birthday, today: string): BirthdayTexts {
  const n = firstName(b.name);
  return { group: GROUP_FALLBACK[seedOf(b.profile_id + today) % GROUP_FALLBACK.length](n), direct: DIRECT_FALLBACK(n) };
}

/** Aceita o JSON do modelo só se vier no formato, citando a pessoa e sem texto gigante; senão, o texto pronto. */
export function pickTexts(raw: string, b: Birthday, today: string): BirthdayTexts {
  const fb = fallbackTexts(b, today);
  let j: { grupo?: unknown; privado?: unknown };
  try { j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return fb; }
  const n = firstName(b.name).toLowerCase();
  const group = typeof j.grupo === 'string' ? j.grupo.trim() : '';
  const direct = Array.isArray(j.privado) ? j.privado.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
  const ok = group.length >= 10 && group.length <= 400 && group.toLowerCase().includes(n)
    && direct.length >= 1 && direct.length <= 3 && direct.every((x) => x.length <= 400);
  return ok ? { group, direct } : fb;
}

/** Mensagem do grupo com a menção do aniversariante (o WhatsApp só destaca se o número aparecer no texto). */
export function groupText(b: Birthday, text: string): string {
  return b.phone ? `@${b.phone} ${text}` : text;
}

export const BIRTHDAY_SYSTEM = [
  'Você é o João, amigo da turma do Sobral Tênis Clube, escrevendo os parabéns de aniversário de um sócio.',
  'Responda SÓ com JSON: {"grupo":"...","privado":["...","..."]}.',
  'grupo: UMA mensagem curta (1 a 2 frases) para o grupo fechado de sócios, citando o primeiro nome, com resenha de amigo e no máximo 2 emojis. Não comece com @ (o sistema põe a menção).',
  'privado: 1 ou 2 mensagens curtas e calorosas no privado, se apresentando como o João do STC.',
  'Use as MEMÓRIAS da pessoa para uma brincadeira de amigo quando couber (profissão, negócio, fama na turma). Brincadeira interna não é fato literal.',
  'Nunca invente idade, fato, resultado ou presente. Nada de ofensa de verdade. Sem markdown e sem hashtags.',
].join('\n');
