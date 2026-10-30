// Apresentação do João num grupo novo (30/10, grupo do AUGE OPEN): ele lê o papo que rolou e a lista de inscritos e
// entra na resenha como João Fonseca, o "Fonsequinha". O modelo escreve; o servidor confere a forma e, se a resposta
// não presta (fora do formato, longa demais, falando de dinheiro, telefone ou que é robô), usa um texto pronto.

export type Athlete = { name: string; socio: boolean; city: string | null };
export type IntroChampionship = { name: string; title: string[]; start_date: string | null; end_date: string | null; total: number; socios: number;
  classes: { class: string; athletes: Athlete[] }[] };
export type Line = { sender: string; body: string };
export type IntroContext = { group_name: string; persona: string; championship: IntroChampionship | null; recent: Line[] };

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const dateBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '');

export const INTRO_SYSTEM = [
  'Você é João Fonseca, o "Fonsequinha", da turma do Sobral Tênis Clube (STC). Acabou de ser adicionado a um grupo de WhatsApp e vai mandar a PRIMEIRA mensagem.',
  'Escreva como uma pessoa de verdade chegando no grupo: português do Ceará, informal, rápido, engraçado, com cara de resenha entre amigos. Nada de tom de atendente, de anúncio ou de tutorial.',
  'Se apresente com nome, sobrenome e apelido: João Fonseca, o Fonsequinha (pode brincar que o xará famoso do circuito é o Fonsecão).',
  'Se o PAPO RECENTE trouxer uma brincadeira rolando, ENTRE NELA primeiro, citando quem falou pelo primeiro nome. Sem papo recente, puxe a resenha do campeonato.',
  'É o grupo do campeonato: tem sócios do STC (a turma de casa) e convidados de outras cidades. Receba os convidados bem e brinque com a disputa ("quem leva a 4ª?", "visita que vem buscar troféu").',
  'Só cite pessoas que estão em pode_citar, pelo primeiro nome (no máximo 4). Ninguém fora dessa lista. "@" seguido de números é menção que você não sabe quem é: não repita nem adivinhe.',
  'Feche dizendo, de jeito natural, que é só marcar seu @ que você aparece.',
  'Nunca diga que é robô, IA, bot ou assistente virtual. Nunca fale de pagamento, Pix, valores ou telefone. Nunca invente data, horário, chave, adversário ou resultado: use só o que veio nos dados.',
  'Responda SÓ com JSON: {"mensagens":["...","..."]} — 2 ou 3 mensagens curtas (uma a três frases cada), no máximo 3 emojis no total. Sem markdown, sem hashtags, sem @.',
].join('\n');

/** Quem ele pode citar: quem falou no grupo e os inscritos, pelo primeiro nome. */
export const citable = (c: IntroContext): string[] => [...new Set([
  ...c.recent.map((l) => firstName(l.sender)),
  ...(c.championship?.classes ?? []).flatMap((k) => k.athletes.map((a) => firstName(a.name))),
].filter((n) => n && /^\p{Lu}/u.test(n)))];

/** O que o modelo lê: o grupo, a turma por classe (primeiro nome, sócio ou convidado, cidade) e o papo recente. */
export function introUserPayload(c: IntroContext): string {
  const ch = c.championship;
  return JSON.stringify({
    grupo: c.group_name,
    campeonato: ch ? {
      nome: ch.name, titulo: ch.title, datas: [dateBR(ch.start_date), dateBR(ch.end_date)].filter(Boolean).join(' a '),
      inscritos: ch.total, socios: ch.socios, convidados: ch.total - ch.socios,
      classes: ch.classes.map((k) => ({ classe: k.class, atletas: k.athletes.map((a) => `${firstName(a.name)} (${a.socio ? 'sócio' : `convidado${a.city ? `, ${a.city}` : ''}`})`) })),
    } : null,
    papo_recente: c.recent.slice(-25).map((l) => `${firstName(l.sender) || 'Alguém'}: ${l.body}`),
    pode_citar: citable(c),
  });
}

// "ia" minúsculo é verbo ("eu ia dizer"): a sigla só em maiúsculas.
const FORBIDDEN = /\b(bot|rob[oô]|intelig[eê]ncia artificial|assistente virtual|pix|pagamento|pagar)\b|r\$|\d{8,}/i;
const forbidden = (m: string) => FORBIDDEN.test(m) || /\bIA\b/.test(m);

export function fallbackIntro(c: IntroContext): string[] {
  const nome = c.championship?.name ?? c.group_name;
  return [
    `Ô de casa! Cheguei 😄 João Fonseca, mas pode chamar de Fonsequinha — o Fonsecão é aquele do circuito, eu sou o da resenha do STC.`,
    `Tô vendo que a turma do ${nome} tá reunida: o pessoal de casa já esquentando o braço e os convidados chegando pra buscar troféu em Sobral. Aqui ninguém leva fácil não, viu? 🎾`,
    'Qualquer coisa é só marcar meu @ que eu apareço. Se não marcar, fico só na arquibancada assistindo vocês se provocarem 😂',
  ];
}

/** Aceita o texto do modelo só no formato, com o nome dele, curto e sem assunto proibido; senão, o texto pronto. */
export function pickIntro(raw: string, c: IntroContext): string[] {
  let j: { mensagens?: unknown };
  try { j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return fallbackIntro(c); }
  const msgs = Array.isArray(j.mensagens) ? j.mensagens.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [];
  const ok = msgs.length >= 2 && msgs.length <= 3 && msgs.every((m) => m.length <= 450 && !forbidden(m) && !m.startsWith('@'))
    && /fonsequinha/i.test(msgs.join(' ')) && /jo[aã]o fonseca/i.test(msgs.join(' '));
  return ok ? msgs : fallbackIntro(c);
}

/** Papo do grupo pela UAZAPI (/message/find): antes de liberar o grupo, nada era gravado no banco. */
export function linesFromUaz(body: unknown): Line[] {
  const b = body as { messages?: unknown } | unknown[] | null;
  const list = Array.isArray(b) ? b : Array.isArray((b as { messages?: unknown })?.messages) ? (b as { messages: unknown[] }).messages : [];
  return (list as Record<string, unknown>[])
    .filter((m) => m && !m.fromMe && typeof (m.text ?? m.content ?? m.body) === 'string')
    .map((m) => ({ ts: Number(m.messageTimestamp ?? 0), sender: String(m.senderName ?? m.pushName ?? 'Alguém'), body: String(m.text ?? m.content ?? m.body).trim().slice(0, 280) }))
    .filter((m) => m.body)
    .sort((a, b2) => a.ts - b2.ts)
    .map(({ sender, body: t }) => ({ sender, body: t }));
}
