// Boas-vindas do João a sócio novo, no(s) grupo(s) do clube (Onda 7). Texto montado pelo servidor (sem IA e sem número
// que o banco não deu), com um pouco de humor; a variante é escolhida pelo id da proposta, então repetir não manda outra.

import { buildChatRequest, providerIdFrom, uazError, type UazCaller } from '../uazChat.ts';

type RpcResult = { data: unknown; error: { message: string } | null };
type Db = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

const primeiroNome = (nome: string) => { const p = nome.trim().split(/\s+/)[0] ?? ''; return /^\+?\d/.test(p) ? '' : p; };

const VARIANTES: ((n: string) => string)[] = [
  (n) => `Atenção, pessoal: chegou reforço no time! 🎾 Deem as boas-vindas a ${n}!\n\nEu sou o João, o assistente do clube. Marco quadra, aviso de horário e finjo que não vi aquela bola na rede. ${n}, qualquer coisa é só me chamar no privado. Seja muito bem-vindo ao clube! 🙌`,
  (n) => `Quem chegou? ${n}! 🎉 Mais uma pessoa para fazer o clube ficar ainda melhor.\n\nPrazer, eu sou o João, o assistente daqui: cuido de reserva, horário e aviso, e não discuto marcação de linha. ${n}, me chama no privado quando precisar. Boas-vindas! 🎾`,
  (n) => `Pessoal, vamos aquecer o braço e aplaudir: ${n} acaba de entrar para o clube! 👏\n\nEu sou o João, o assistente do clube (o único que nunca perde a bola de vista, porque eu não tenho olhos 😅). ${n}, qualquer dúvida de reserva ou horário, é só falar comigo no privado. Seja bem-vindo! 🎾`,
];

export function composeWelcome(name: string, seed: string): string {
  const n = primeiroNome(name) || 'nosso novo sócio';
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return VARIANTES[h % VARIANTES.length](n);
}

const uuidFrom = async (s: string) => {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).slice(0, 16);
  b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Manda as boas-vindas em cada grupo liberado. Nunca lança: o cadastro já está feito e não depende disto. */
export async function sendWelcome(db: Db, uaz: UazCaller | null, o: { name: string; proposalId: string }): Promise<number> {
  if (!uaz) return 0;
  let sent = 0;
  try {
    const groups = ((await db('conv_svc_welcome_groups', {})).data ?? []) as { conversation_id: string }[];
    const text = composeWelcome(o.name, o.proposalId);
    for (const g of groups) {
      const q = await db('conv_svc_queue_message', { p_conversation: g.conversation_id, p: { kind: 'text', body: text }, p_author: null,
        p_key: await uuidFrom(`joao-welcome:${o.proposalId}:${g.conversation_id}`), p_origin: 'ai', p_session: null, p_recipient: null });
      const row = (Array.isArray(q.data) ? q.data[0] : null) as { message_id: string; destination: string; already_sent: boolean } | null;
      if (q.error || !row || row.already_sent) continue;
      const pedido = buildChatRequest({ action: 'send', number: row.destination, kind: 'text', text });
      const res = pedido ? await uaz(pedido) : { ok: false as const, error: 'INVALID_REQUEST' };
      await db('conv_svc_finish_message', { p_message: row.message_id, p_sent: res.ok,
        p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res) });
      if (res.ok) sent += 1;
    }
  } catch { /* o cadastro não depende das boas-vindas */ }
  return sent;
}
