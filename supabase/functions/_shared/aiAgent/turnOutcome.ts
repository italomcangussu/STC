// Resolução de pessoas pelo cadastro e tradução de códigos de erro do servidor em resposta (falha nunca vira silêncio).

import { CODE_TEXT, type Game, busyMessage, dayLabel, joinOfferMessage, listaNomes, notEnoughSpotsMessage } from './serverTexts.ts';
import { type Court, nearest, toMin } from './agendaLookup.ts';
import type { Ctx } from './promptTypes.ts';
import type { Db, Decision, Memory } from './turnTypes.ts';
import type { DecideInput } from './decide.ts';
import { TRANSFER_DIRECT, TRANSFER_GROUP } from './serverRules.ts';

export async function resolve(db: Db, names: string[], scope: 'member' | 'student' | 'professor') {
  const out = { ids: [] as string[], names: [] as string[], matches: [] as { id: string; name: string; kind: string }[], ask: null as string | null };
  if (names.length === 0) return out;
  const list = ((await db('conv_svc_ai_resolve_people', { p_names: names, p_scope: scope })).data ?? []) as
    { query: string; status: 'unique' | 'ambiguous' | 'none'; matches: { id: string; name: string; kind: string }[] }[];
  for (const r of list) {
    if (r.status === 'unique') {
      const m = r.matches[0];
      if (!out.ids.includes(m.id)) { out.ids.push(m.id); out.names.push(m.name); out.matches.push(m); }
    } else if (r.status === 'ambiguous') {
      out.ask = `Tenho mais de um "${r.query}": ${listaNomes(r.matches.map((m) => m.name))}. Qual deles?`;
      return out;
    } else {
      out.ask = scope === 'member'
        ? `Não encontrei "${r.query}" entre os sócios. Essa pessoa é convidada sua? Se for, me diga o nome completo.`
        : scope === 'professor' ? `Não encontrei o professor "${r.query}". Qual o nome completo?`
        : `Não encontrei o aluno "${r.query}". Qual o nome completo?`;
      return out;
    }
  }
  return out;
}

export async function failure(code: string, message: string | undefined, i: DecideInput, memory: Memory, proposal: Ctx | null,
  extra?: { candidates: Court[]; payload: Record<string, unknown> }): Promise<Decision> {
  const { deps, ctx, today } = i;
  const base: Decision = { bubbles: [], awaiting: true, close: false, action: `failed:${code}`, memory };

  if (code === 'SLOT_TAKEN') {
    // Alternativas só se o motor de reservas disse que estão realmente livres.
    const date = String(extra?.payload?.date ?? (proposal?.payload as Ctx | undefined)?.date ?? '');
    const dur = Number(extra?.payload?.duration ?? (proposal?.payload as Ctx | undefined)?.duration ?? 60);
    const wanted = String(extra?.payload?.start ?? (proposal?.payload as Ctx | undefined)?.start ?? '');
    const cs = (extra?.candidates?.length ? extra.candidates : (ctx.courts as Court[]).filter((c) => c.id === (proposal?.payload as Ctx | undefined)?.court_id)) as Court[];
    // Quem ocupa o horário? Se for um jogo de Play com vaga, a IA oferece entrar (pedido novo de Play, não na falha de uma confirmação).
    const profile = ((ctx.requester as Ctx | undefined)?.profile ?? null) as Ctx | null;
    let jogos: Game[] = [];
    if (extra && String(extra.payload.type ?? 'Play') === 'Play' && profile?.id && /^\d{2}:\d{2}$/.test(wanted)) {
      const ini = toMin(wanted);
      for (const c of cs) {
        const g = ((await deps.db('conv_svc_ai_slot_games', { p_court: c.id, p_date: date, p_start_min: ini, p_end_min: ini + dur, p_requester: profile.id })).data ?? []) as Game[];
        jogos = jogos.concat(g);
      }
      const entrar = jogos.find((g) => g.joinable);
      if (entrar) {
        // Entra o solicitante e quem ele disse que joga com ele (e o convidado, se houver).
        const p = (await deps.db('conv_svc_ai_propose', { p_session: i.session, p: { action: 'join', reservation_id: entrar.reservation_id,
          participant_ids: extra.payload.participant_ids ?? [], guest_name: extra.payload.guest_name ?? null } })).data as
          { ok: boolean; code?: string; spots_left?: number; wanted?: number; summary?: Game & { add_names?: string[] } } | null;
        if (p?.ok && p.summary) return { ...base, bubbles: [joinOfferMessage(entrar, today, p.summary.add_names ?? [])], action: 'proposed_join', memory };
        if (p?.code === 'NOT_ENOUGH_SPOTS') return { ...base, bubbles: [notEnoughSpotsMessage(entrar, Number(p.spots_left ?? 0), Number(p.wanted ?? 1), today)], action: 'failed:NOT_ENOUGH_SPOTS' };
        if (p?.code === 'GUEST_ALREADY') return { ...base, bubbles: ['Esse jogo já tem um convidado, então não consigo adicionar o seu. Quer entrar sem o convidado?'], action: 'failed:GUEST_ALREADY' };
        if (p?.code === 'PARTICIPANT_NOT_MEMBER') return { ...base, bubbles: [CODE_TEXT.PARTICIPANT_NOT_MEMBER as string], action: 'failed:PARTICIPANT_NOT_MEMBER' };
      }
    }
    const linhas: string[] = [];
    for (const c of cs) {
      const livres = ((await deps.db('conv_svc_available_slots', { p_date: date, p_court: c.id, p_duration: dur })).data ?? []) as string[];
      const perto = nearest(livres, wanted);
      if (perto.length) linhas.push(`${c.name}: ${perto.join(', ')}`);
    }
    const ocupado = jogos.length ? busyMessage(jogos[0], today) : 'Esse horário não está livre.';
    return { ...base, bubbles: [linhas.length
      ? `${ocupado} Livres ${dayLabel(date, today)}: ${linhas.join(' · ')}. Algum serve?`
      : `${ocupado} Não há outro horário disponível ${dayLabel(date, today)} para ${dur} min. Quer outro dia?`] };
  }
  const texto = code in CODE_TEXT ? CODE_TEXT[code] : undefined;
  if (texto === null) {
    return { ...base, awaiting: false, action: `handoff:${code}`, bubbles: [isGroupText(ctx) ? TRANSFER_GROUP : TRANSFER_DIRECT],
      handoff: { kind: 'hard', note: `${message ?? code}` .slice(0, 400) } };
  }
  if (typeof texto === 'string') return { ...base, awaiting: true, bubbles: [texto], close: false, memory };
  // Código que o servidor não conhece: nada é anunciado, a equipe assume.
  return { ...base, awaiting: false, action: 'handoff:UNKNOWN', bubbles: [isGroupText(ctx) ? TRANSFER_GROUP : TRANSFER_DIRECT],
    handoff: { kind: 'hard', note: `Não consegui concluir a operação (${code}).` } };
}

const isGroupText = (ctx: Ctx) => ctx.is_group === true;
