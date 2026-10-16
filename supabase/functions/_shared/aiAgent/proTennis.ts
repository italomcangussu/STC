// Tênis profissional atual (ESPN, com transmissão do 365Scores): contexto e respostas diretas.

import type { Ctx } from './promptTypes.ts';
import { norm } from './serverRules.ts';

/* ------------------------------- Tênis profissional atual (ESPN) ------------------------------- */

type ProTennisMatch = {
  id: string;
  tour: 'ATP' | 'WTA';
  tournament: string;
  category: string | null;
  round: string | null;
  start_utc: string;
  local_date: string;
  local_time: string;
  state: string | null;
  status: string | null;
  status_detail: string | null;
  venue: string | null;
  court: string | null;
  players: { name: string; country: string | null; score: number[] }[];
  broadcasts: string[];
  broadcast_regions: string[];
  broadcast_source: 'ESPN' | '365Scores' | null;
  broadcast_checked_365?: boolean;
  notes: string[];
};

function addIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function localDateTimeFromUtc(value: string): { date: string; time: string } | null {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function tennisBroadcasts(c: Record<string, any>): { names: string[]; regions: string[] } {
  const names = new Set<string>();
  const regions = new Set<string>();
  const add = (v: unknown) => {
    const s = String(v ?? '').trim();
    if (s) names.add(s);
  };
  const visit = (b: any) => {
    if (!b || typeof b !== 'object') return;
    add(b.name); add(b.shortName); add(b.network); add(b.station);
    add(b.media?.name); add(b.media?.shortName);
    add(b.channel?.name); add(b.channel?.shortName);
    for (const n of Array.isArray(b.names) ? b.names : []) add(n);
    const region = String(b.region ?? b.market?.type ?? b.market?.name ?? b.country ?? '').trim();
    if (region) regions.add(region);
  };
  add(c.broadcast);
  for (const b of Array.isArray(c.broadcasts) ? c.broadcasts : []) visit(b);
  for (const b of Array.isArray(c.geoBroadcasts) ? c.geoBroadcasts : []) visit(b);
  return { names: [...names].slice(0, 8), regions: [...regions].slice(0, 8) };
}

function parseProTennisBoard(data: any, fallbackTour: 'ATP' | 'WTA', wantedDate: string): ProTennisMatch[] {
  const out: ProTennisMatch[] = [];
  for (const event of Array.isArray(data?.events) ? data.events : []) {
    const tournament = String(event?.name ?? event?.shortName ?? fallbackTour).trim();
    for (const grouping of Array.isArray(event?.groupings) ? event.groupings : []) {
      const category = String(grouping?.grouping?.displayName ?? '').trim() || null;
      const tour: 'ATP' | 'WTA' = /women/i.test(category ?? '') ? 'WTA' : /men/i.test(category ?? '') ? 'ATP' : fallbackTour;
      for (const c of Array.isArray(grouping?.competitions) ? grouping.competitions : []) {
        const start = String(c?.date ?? c?.startDate ?? '').trim();
        const local = localDateTimeFromUtc(start);
        if (!local || local.date !== wantedDate) continue;
        const players = (Array.isArray(c?.competitors) ? c.competitors : []).map((p: any) => ({
          name: String(p?.athlete?.displayName ?? p?.athlete?.fullName ?? p?.roster?.displayName ?? '').trim(),
          country: String(p?.athlete?.flag?.alt ?? p?.roster?.athletes?.[0]?.flag?.alt ?? '').trim() || null,
          score: (Array.isArray(p?.linescores) ? p.linescores : [])
            .map((x: any) => Number(x?.value))
            .filter((x: number) => Number.isFinite(x)),
        })).filter((p: any) => p.name && p.name !== 'TBD');
        if (players.length < 2) continue;
        const bc = tennisBroadcasts(c);
        out.push({
          id: String(c?.id ?? `${event?.id ?? tournament}:${start}:${players.map((p: any) => p.name).join('|')}`),
          tour,
          tournament,
          category,
          round: String(c?.round?.displayName ?? '').trim() || null,
          start_utc: start,
          local_date: local.date,
          local_time: local.time,
          state: String(c?.status?.type?.state ?? '').trim() || null,
          status: String(c?.status?.type?.description ?? '').trim() || null,
          status_detail: String(c?.status?.type?.detail ?? '').trim() || null,
          venue: String(c?.venue?.fullName ?? '').trim() || null,
          court: String(c?.venue?.court ?? '').trim() || null,
          players,
          broadcasts: bc.names,
          broadcast_regions: bc.regions,
          broadcast_source: bc.names.length ? 'ESPN' : null,
          notes: (Array.isArray(c?.notes) ? c.notes : []).map((n: any) => String(n?.text ?? '').trim()).filter(Boolean).slice(0, 4),
        });
      }
    }
  }
  return out;
}

export function looksLikeProTennisQuestion(text: string, groupContext: Ctx[] = []): boolean {
  const t = norm(text).replace(/\s+/g, ' ').trim();
  const direct = /\b(atp|wta|masters|grand slam|roland garros|wimbledon|us open|australian open|china open|shanghai|circuito profissional|ranking mundial|torneio profissional)\b/.test(t);
  const liveData = /\b(transmissao|assistir|onde passa|onde assistir|canal|stream|streaming|que horas|horario|partida|placar|resultado|joga hoje|jogam hoje|comeca|comecou|terminou|ganhou|perdeu)\b/.test(t);
  const transmission = /\b(transmissao|assistir|onde passa|onde assistir|canal|stream|streaming)\b/.test(t);
  if (direct || transmission) return true;
  if (!liveData) return false;
  const recent = norm(groupContext.slice(-8).map((m) => `${m.sender ?? ''} ${m.body ?? ''}`).join(' '));
  return /\b(atp|wta|masters|grand slam|roland garros|wimbledon|us open|australian open|china open|shanghai|tenis profissional|tênis profissional)\b/.test(recent);
}

type Scores365Game = {
  id: number;
  competitionId: number;
  hasTVNetworks?: boolean;
  homeCompetitor?: { id?: number; name?: string };
  awayCompetitor?: { id?: number; name?: string };
};

function isoToDmy(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function sameTennisPair(match: ProTennisMatch, game: Scores365Game): boolean {
  const a = match.players.map((p) => norm(p.name).replace(/[^a-z0-9 ]/g, '').trim()).sort();
  const b = [game.homeCompetitor?.name, game.awayCompetitor?.name]
    .map((x) => norm(String(x ?? '')).replace(/[^a-z0-9 ]/g, '').trim()).filter(Boolean).sort();
  return a.length === 2 && b.length === 2 && a[0] === b[0] && a[1] === b[1];
}

async function enrichBroadcastsFrom365(matches: ProTennisMatch[], date: string, queryText: string): Promise<void> {
  const q = norm(queryText);
  if (!/\b(transmissao|assistir|onde passa|onde assistir|canal|stream|streaming)\b/.test(q)) return;

  let games: Scores365Game[] = [];
  try {
    const dmy = isoToDmy(date);
    const url = `https://webws.365scores.com/web/games/allscores/?appTypeId=5&langId=31&timezoneName=America/Sao_Paulo&userCountryId=21&sports=3&startDate=${dmy}&endDate=${dmy}&showOdds=false&withTop=true`;
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0', referer: 'https://www.365scores.com/pt-br/' },
      signal: AbortSignal.timeout(9000),
    });
    if (r.ok) {
      const data = await r.json();
      games = Array.isArray(data?.games) ? data.games : [];
    }
  } catch { return; }

  // O match mais relevante para a pergunta já foi ordenado antes; consultar poucos detalhes
  // reduz latência e evita chamadas desnecessárias.
  for (const match of matches.slice(0, 5)) {
    const game = games.find((g) => sameTennisPair(match, g));
    if (!game) continue;
    match.broadcast_checked_365 = true;
    if (!game.hasTVNetworks) continue;

    try {
      const homeId = Number(game.homeCompetitor?.id);
      const awayId = Number(game.awayCompetitor?.id);
      const gameId = Number(game.id);
      const competitionId = Number(game.competitionId);
      if (![homeId, awayId, gameId, competitionId].every(Number.isFinite)) continue;
      const matchupId = `${homeId}-${awayId}-${competitionId}`;
      const url = `https://webws.365scores.com/web/game/?appTypeId=5&langId=31&timezoneName=America/Sao_Paulo&userCountryId=21&gameId=${gameId}&matchupId=${matchupId}`;
      const r = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0', referer: 'https://www.365scores.com/pt-br/' },
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      const networks = (Array.isArray(data?.game?.tvNetworks) ? data.game.tvNetworks : [])
        .filter((n: any) => !n?.countryId || Number(n.countryId) === 21)
        .map((n: any) => String(n?.name ?? '').trim())
        .filter(Boolean);
      if (networks.length) {
        match.broadcasts = [...new Set([...match.broadcasts, ...networks])].slice(0, 8);
        match.broadcast_regions = [...new Set([...match.broadcast_regions, 'Brasil'])].slice(0, 8);
        match.broadcast_source = '365Scores';
      }
    } catch { /* sem transmissão confirmada: não inventa */ }
  }
}

export async function proTennisContext(nowLocal: string, queryText: string): Promise<Ctx> {
  const today = nowLocal.slice(0, 10);
  const q = norm(queryText);
  const target = /\bdepois de amanha\b/.test(q) ? addIsoDate(today, 2)
    : /\bamanha\b/.test(q) ? addIsoDate(today, 1)
    : /\bontem\b/.test(q) ? addIsoDate(today, -1)
    : today;
  const dates = [addIsoDate(target, -1), target, addIsoDate(target, 1)];
  const urls = dates.flatMap((d) => {
    const compact = d.replace(/-/g, '');
    return [
      `https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=${compact}`,
      `https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard?dates=${compact}`,
    ];
  });
  const boards = await Promise.all(urls.map(async (url) => {
    try {
      const r = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'STC-Joao/1.0' },
        signal: AbortSignal.timeout(9000),
      });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }));
  const parsed: ProTennisMatch[] = [];
  for (let i = 0; i < boards.length; i += 2) {
    parsed.push(...parseProTennisBoard(boards[i], 'ATP', target));
    parsed.push(...parseProTennisBoard(boards[i + 1], 'WTA', target));
  }
  const unique = [...new Map(parsed.map((m) => [m.id, m])).values()];
  const query = norm(queryText);
  const score = (m: ProTennisMatch) => {
    let s = m.state === 'in' ? 30 : m.state === 'pre' ? 20 : 5;
    const hay = norm([m.tournament, m.round, ...m.players.map((p) => p.name)].join(' '));
    for (const token of query.split(/[^a-z0-9]+/).filter((x) => x.length >= 4)) if (hay.includes(token)) s += 18;
    return s;
  };
  unique.sort((a, b) => score(b) - score(a) || a.start_utc.localeCompare(b.start_utc));
  const selected = unique.slice(0, 18);
  await enrichBroadcastsFrom365(selected, target, queryText);
  return {
    source: 'ESPN + 365Scores',
    checked_at: new Date().toISOString(),
    timezone: 'America/Fortaleza',
    date: target,
    matches: selected,
  };
}

export function proTennisDirectMessages(text: string, live: Ctx | null | undefined): string[] | null {
  if (!live) return null;
  const t = norm(text).replace(/\s+/g, ' ').trim();
  const wantsBroadcast = /\b(transmissao|assistir|onde passa|onde assistir|canal|stream|streaming)\b/.test(t);
  const wantsTime = /\b(que horas|horario|quando|comeca|vai ser)\b/.test(t);
  const wantsScore = /\b(placar|resultado|quanto esta|quanto ficou|ganhou|perdeu|terminou)\b/.test(t);
  const wantsPlace = /\b(onde joga|quadra|court|local|cidade)\b/.test(t);
  const matches = Array.isArray(live.matches) ? live.matches as ProTennisMatch[] : [];
  if (live.unavailable) return ['A fonte de jogos está indisponível agora. Não vou chutar essa informação.'];
  if (!matches.length) return ['Não achei uma partida confirmada na fonte para essa consulta agora.'];

  const m = matches[0];
  const a = m.players[0]?.name ?? 'Jogador 1';
  const b = m.players[1]?.name ?? 'Jogador 2';
  const round = m.round ? `, ${m.round}` : '';
  const out: string[] = [];

  if (wantsTime || (!wantsBroadcast && !wantsScore && !wantsPlace)) {
    out.push(`${a} x ${b} é hoje${m.local_time ? ' às ' + m.local_time : ''}, pelo ${m.tournament}${round}.`);
  }
  if (wantsBroadcast) {
    if (m.broadcasts.length) {
      const region = m.broadcast_regions.length ? ` (${m.broadcast_regions.join(', ')})` : '';
      const source = m.broadcast_source === '365Scores' ? 'O 365Scores informa' : 'A ESPN informa';
      out.push(`${source} transmissão por ${m.broadcasts.join(', ')}${region}.`);
    } else if (m.broadcast_checked_365) {
      out.push('Não encontrei transmissão confirmada para o Brasil nem na ESPN nem no 365Scores agora.');
    } else {
      out.push('A fonte atual não informa onde assistir a essa partida.');
    }
  }
  if (wantsPlace) {
    const place = [m.venue, m.court].filter(Boolean).join(' — ');
    out.push(place ? `O jogo está marcado para ${place}.` : 'A fonte atual não informa a quadra/local dessa partida.');
  }
  if (wantsScore) {
    if (m.state === 'in') {
      const score = m.players.map((p) => `${p.name}: ${p.score.length ? p.score.join('-') : 'placar não detalhado'}`).join(' | ');
      out.push(`Está em andamento. ${score}`);
    } else if (m.state === 'post') {
      const score = m.players.map((p) => `${p.name}: ${p.score.length ? p.score.join('-') : 'placar não detalhado'}`).join(' | ');
      out.push(`A partida já terminou. ${score}`);
    } else {
      out.push('A partida ainda não começou.');
    }
  }
  return out.slice(0, 3);
}
