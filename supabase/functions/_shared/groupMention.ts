// Menção direta à conta institucional em grupo — detector FAIL-CLOSED.
//
// O que se sabe e o que não se sabe (docs/conversas/DIAGNOSTICO.md §4):
//  * o webhook da UazAPI entrega `chatid` (`…@g.us`) e `isGroup`;
//  * NÃO está comprovado, com payload real do STC, em qual campo a UazAPI entrega a lista de
//    menções recebidas, nem como ela representa o `@all`.
//
// Por isso este módulo só diz "menção direta" quando encontra uma lista ESTRUTURADA de menções
// (nos lugares onde o WhatsApp/Baileys a põe: `contextInfo.mentionedJid`, `mentions`,
// `mentionedJid`) contendo um identificador da conta institucional CONFIGURADO pelo
// administrador (telefone e/ou LID). Nunca por texto digitado, nunca por `@all`/`@todos`,
// nunca quando a lista é grande demais para ser uma menção deliberada, nunca sem lista.
//
// Cada resposta traz uma `evidence` curta, gravada na mensagem, para o administrador conferir
// o que o provedor realmente entrega antes de ligar a IA em grupos.

type Rec = Record<string, unknown>;

const asRec = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : null);

export type BotIdentity = { phone?: string | null; lids?: string[] | null };

export type MentionInfo = {
  /** Identificadores citados (só dígitos/LID, sem domínio), sem repetição. */
  ids: string[];
  /** Há lista estruturada em algum dos lugares conhecidos? */
  hasMetadata: boolean;
  /** Marcador de "todos" (texto `@all`/`@todos`… ou campos de menção coletiva). */
  allMarker: boolean;
  /** Onde a lista foi achada (para o administrador conferir). */
  sources: string[];
};

export type MentionVerdict = { direct: boolean; evidence: string };

/** Mais citados que isto numa mesma mensagem = indistinguível de um "todos" expandido. */
export const MAX_DELIBERATE_MENTIONS = 3;

const ALL_TOKEN = /(^|[\s(])@(all|todos|todas|todo|everyone|everybody|geral)(?=$|[\s.,!?;:)])/i;

/** `5585988880099@s.whatsapp.net`, `5585988880099:12@s.whatsapp.net`, `262096671481918@lid` → só o identificador. */
export function mentionId(jid: unknown): string {
  const raw = typeof jid === 'string' ? jid : typeof jid === 'number' ? String(jid) : '';
  return raw.split('@')[0].split(':')[0].replace(/[^0-9A-Za-z._-]/g, '').toLowerCase();
}

function listFrom(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map(mentionId).filter(Boolean);
  // A UazAPI documenta `mentions` de ENVIO como texto separado por vírgula; aceita o mesmo formato na leitura.
  if (typeof value === 'string' && value.trim()) return value.split(/[,\s]+/).map(mentionId).filter(Boolean);
  return null;
}

/**
 * Procura a lista de menções onde ela costuma estar. `message` é `payload.message` da UazAPI.
 * Não inventa: lugar que não existe no payload é ignorado.
 */
export function extractMentions(message: Rec, text: string): MentionInfo {
  const content = asRec(message.content);
  const ctxInfo = asRec(content?.contextInfo) ?? asRec(message.contextInfo);
  const places: [string, unknown][] = [
    ['message.mentions', message.mentions],
    ['message.mentionedJid', message.mentionedJid],
    ['content.mentions', content?.mentions],
    ['content.mentionedJid', content?.mentionedJid],
    ['content.contextInfo.mentionedJid', ctxInfo?.mentionedJid],
    ['content.contextInfo.mentions', ctxInfo?.mentions],
  ];
  const ids = new Set<string>();
  const sources: string[] = [];
  for (const [where, value] of places) {
    const list = listFrom(value);
    if (list === null) continue;
    sources.push(where);
    list.forEach((i) => ids.add(i));
  }
  // Campos de menção coletiva (grupo inteiro / não-JID): se existirem e vierem preenchidos, é "todos".
  const nonJid = Number(ctxInfo?.nonJidMentions ?? content?.nonJidMentions ?? 0);
  const groupMentions = ctxInfo?.groupMentions ?? content?.groupMentions;
  const allMarker = ALL_TOKEN.test(text) || (Number.isFinite(nonJid) && nonJid > 0)
    || (Array.isArray(groupMentions) && groupMentions.length > 0);
  return { ids: [...ids], hasMetadata: sources.length > 0, allMarker, sources };
}

/** Identificadores da conta institucional, já normalizados: os do telefone e os de LID. */
function botIds(identity: BotIdentity): { phone: string[]; lid: string[] } {
  const phone = new Set<string>();
  const p = mentionId(identity.phone ?? '');
  if (p) {
    phone.add(p);
    // Telefone brasileiro: aceita com e sem o nono dígito (o WhatsApp antigo omite o 9).
    if (/^55\d{2}9\d{8}$/.test(p)) phone.add(p.slice(0, 4) + p.slice(5));
    if (/^55\d{2}\d{8}$/.test(p)) phone.add(p.slice(0, 4) + '9' + p.slice(4));
  }
  const lid = new Set<string>();
  for (const l of identity.lids ?? []) { const id = mentionId(l); if (id) lid.add(id); }
  return { phone: [...phone], lid: [...lid] };
}

export function classifyMention(info: MentionInfo, identity: BotIdentity): MentionVerdict {
  const bot = botIds(identity);
  if (bot.phone.length + bot.lid.length === 0) return { direct: false, evidence: 'no_bot_identity' };
  if (info.allMarker) return { direct: false, evidence: 'all_mention' };
  if (!info.hasMetadata) return { direct: false, evidence: 'no_mention_metadata' };
  const hit = info.ids.find((id) => bot.phone.includes(id) || bot.lid.includes(id));
  if (!hit) return { direct: false, evidence: info.ids.length ? 'mentions_other' : 'empty_mention_list' };
  if (info.ids.length > MAX_DELIBERATE_MENTIONS) return { direct: false, evidence: 'too_many_mentions' };
  return { direct: true, evidence: bot.phone.includes(hit) ? 'mentioned_bot_phone' : 'mentioned_bot_lid' };
}

/**
 * Formato (só nomes e tipos) de um payload: serve para o administrador conferir QUAIS campos o
 * provedor entrega em grupo, sem guardar nenhum valor (nem telefone, nem texto de mensagem).
 */
export function payloadShape(value: unknown, depth = 4, budget = { n: 160 }): unknown {
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  if (depth <= 0) return Array.isArray(value) ? 'array' : 'object';
  if (Array.isArray(value)) return value.length ? [payloadShape(value[0], depth - 1, budget)] : [];
  const out: Rec = {};
  for (const [k, v] of Object.entries(value as Rec)) {
    if (budget.n-- <= 0) { out['…'] = 'truncated'; break; }
    out[k.slice(0, 40)] = payloadShape(v, depth - 1, budget);
  }
  return out;
}
