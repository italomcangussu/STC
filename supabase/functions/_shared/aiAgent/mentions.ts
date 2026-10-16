// Quem foi marcado: do número (@) para o sócio, e membros atuais do grupo.

import { buildChatRequest } from '../uazChat.ts';
import type { TurnDeps } from './turnTypes.ts';

/* ------------------------------- Quem foi marcado: do número para o sócio ------------------------------- */

export type MencaoResolvida = { id: string; is_bot: boolean; name: string | null; profile_id: string | null; via: string | null };
const MENCAO = /@(\d{8,16})\b/g;

/** "@61809058967781" → "@Emerson Souza" (sócio conciliado), "@STC" (a própria conta) ou "@(pessoa não identificada)". */
export function substituirMencoes(texto: string, mapa: Map<string, MencaoResolvida>, conta = 'STC'): string {
  return texto.replace(MENCAO, (m, id: string) => {
    const r = mapa.get(id);
    if (!r) return m;
    return r.is_bot ? `@${conta}` : r.name ? `@${r.name}` : '@(pessoa não identificada)';
  });
}

/**
 * Concilia cada "@número" dos textos com o cadastro de sócios: pelo contato do WhatsApp com esse LID e pelo TELEFONE. O que o cadastro
 * não resolve sozinho (o LID de quem nunca escreveu) é perguntado à UazAPI — os participantes do grupo trazem LID e telefone juntos —
 * e conciliado de novo pelo telefone. Nada é gravado; o que não for achado fica sem nome (o agente pergunta).
 */
export async function conciliarMencoes(deps: TurnDeps, conversation: string, isGroup: boolean, textos: string[]): Promise<Map<string, MencaoResolvida>> {
  const ids = [...new Set(textos.flatMap((t) => [...t.matchAll(MENCAO)].map((m) => m[1])))];
  const mapa = new Map<string, MencaoResolvida>();
  if (ids.length === 0) return mapa;
  const resolver = async (items: { id: string; phone: string | null }[]) =>
    ((await deps.db('conv_svc_ai_resolve_mentions', { p_items: items })).data ?? []) as MencaoResolvida[];
  for (const r of await resolver(ids.map((id) => ({ id, phone: null })))) mapa.set(r.id, r);
  const faltam = ids.filter((id) => { const r = mapa.get(id); return r && !r.is_bot && !r.name; });
  if (faltam.length && isGroup && deps.uaz) {
    const dest = (await deps.db('conv_svc_conversation_contact', { p_conversation: conversation })).data;
    const grupo = (Array.isArray(dest) ? dest[0] : dest) as { destination?: string } | null;
    const req = grupo?.destination ? buildChatRequest({ action: 'groupInfo', groupJid: grupo.destination }) : null;
    const res = req ? await deps.uaz(req).catch(() => null) : null;
    const lista = res && res.ok ? ((res.body.Participants ?? res.body.participants ?? []) as Record<string, unknown>[]) : [];
    const telefones = new Map<string, string>();
    for (const p of lista) {
      const lid = String(p.LID ?? p.lid ?? '').split('@')[0].split(':')[0];
      const fone = String(p.PhoneNumber ?? p.phoneNumber ?? p.phone ?? '').split('@')[0].replace(/\D/g, '');
      if (lid && fone) telefones.set(lid, fone);
    }
    const comTelefone = faltam.filter((id) => telefones.has(id)).map((id) => ({ id, phone: telefones.get(id)! }));
    if (comTelefone.length) for (const r of await resolver(comTelefone)) if (r.name || r.is_bot) mapa.set(r.id, r);
  }
  return mapa;
}

/** Lista os sócios reconhecidos que estão AGORA no grupo, sem expor telefone/LID ao modelo. */
export async function membrosAtuaisDoGrupo(deps: TurnDeps, conversation: string): Promise<string[]> {
  if (!deps.uaz) return [];
  try {
    const destRaw = (await deps.db('conv_svc_conversation_contact', { p_conversation: conversation })).data;
    const dest = (Array.isArray(destRaw) ? destRaw[0] : destRaw) as { destination?: string } | null;
    const req = dest?.destination ? buildChatRequest({ action: 'groupInfo', groupJid: dest.destination }) : null;
    const res = req ? await deps.uaz(req) : null;
    if (!res?.ok) return [];
    const lista = (res.body.Participants ?? res.body.participants ?? []) as Record<string, unknown>[];
    const items = lista.map((p) => {
      const lid = String(p.LID ?? p.lid ?? '').split('@')[0].split(':')[0];
      const phone = String(p.PhoneNumber ?? p.phoneNumber ?? p.phone ?? '').split('@')[0].replace(/\D/g, '');
      return { id: lid || phone, phone: phone || null };
    }).filter((x) => x.id);
    if (!items.length) return [];
    const rr = await deps.db('conv_svc_ai_resolve_mentions', { p_items: items });
    const resolved = (rr.data ?? []) as MencaoResolvida[];
    return [...new Set(resolved.filter((x) => !x.is_bot && x.name).map((x) => String(x.name)))];
  } catch {
    return [];
  }
}
