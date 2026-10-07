// João Fonseca — bom dia diário do grupo oficial do STC.
// Consulta tênis atual (ATP/WTA) e o pulso do próprio clube, gera uma mensagem curta e envia pelo mesmo canal institucional.
// Protegida pelo mesmo segredo do dispatcher; idempotente por data local. Agendada por pg_cron (45 9 * * * UTC = 06:45 em Fortaleza).

import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { cleanGreeting, clubFacts, fallbackGreeting, GREETING_SYSTEM_PROMPT, isValidGreeting } from '../_shared/joaoGreeting.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '';
const UAZ_URL = (Deno.env.get('UAZAPI_SERVER_URL') || '').replace(/\/+$/, '');
const UAZ_TOKEN = Deno.env.get('STC_UAZAPI_INSTANCE_TOKEN') || '';
const AI_KEY = Deno.env.get('STC_AI_API_KEY') || '';
const AI_BASE = (Deno.env.get('STC_AI_BASE_URL') || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const DISPATCH_SECRET = Deno.env.get('STC_DISPATCH_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const GROUP_NAME = 'Sócios Sobral Tênis Clube';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
async function sha256(s: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
async function authorized(req: Request) {
  const given = req.headers.get('x-dispatch-secret') || '';
  if (!given || !DISPATCH_SECRET || DISPATCH_SECRET.length < 24) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(DISPATCH_SECRET)]);
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function localDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((x) => x.type === t)?.value || '';
  return { iso: `${get('year')}-${get('month')}-${get('day')}`, espn: `${get('year')}${get('month')}${get('day')}` };
}
function weekdayName() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', weekday: 'long' }).format(new Date());
}
function normalizeName(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function playerName(c: any): string {
  return String(c?.athlete?.displayName || c?.athlete?.fullName || c?.athlete?.shortName || c?.team?.displayName || c?.displayName || '').trim();
}
function country(c: any): string | null {
  const raw = c?.athlete?.flag?.alt || c?.athlete?.country?.name || c?.athlete?.country || c?.flag?.alt || c?.country?.name || null;
  return raw ? String(raw) : null;
}
function rankingMap(data: any) {
  const map = new Map<string, number>();
  const ranks = Array.isArray(data?.rankings?.[0]?.ranks) ? data.rankings[0].ranks : [];
  for (const r of ranks) {
    const name = String(r?.athlete?.displayName || r?.athlete?.fullName || r?.team?.displayName || r?.displayName || '').trim();
    const rank = Number(r?.current ?? r?.rank ?? r?.ranking ?? r?.position);
    if (name && Number.isFinite(rank) && rank > 0) map.set(normalizeName(name), rank);
  }
  return map;
}
function localIsoFromUtc(value: string) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function boardFacts(data: any, tour: string, ranks: Map<string, number>, wantedIso: string) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const out: any[] = [];
  for (const e of events) {
    const comps = Array.isArray(e?.competitions) ? e.competitions : [];
    for (const c of comps) {
      const competitors = Array.isArray(c?.competitors) ? c.competitors : [];
      const players = competitors.map((x: any) => {
        const name = playerName(x); if (!name) return null;
        return { name, rank: ranks.get(normalizeName(name)) ?? null, country: country(x) };
      }).filter(Boolean);
      const date = String(c?.date || '').trim();
      if (!date || localIsoFromUtc(date) !== wantedIso || players.length < 2) continue;
      const status = c?.status?.type || {};
      const state = String(status?.state || '').toLowerCase();
      const description = String(status?.description || status?.detail || '').trim();
      const tournament = String(e?.name || e?.shortName || e?.tournament?.displayName || e?.tournament?.name || '').trim();
      const match = String(c?.name || c?.shortName || '').trim()
        || `${players[0]?.name || ''} x ${players[1]?.name || ''}`;
      out.push({ tour, tournament: tournament || null, event: match || null, date, state: state || null, status: description || null, players });
    }
  }
  return out;
}
function idempotencyUuid(iso: string) {
  // UUID determinístico simples a partir da data; suficiente para a chave de idempotência do próprio fluxo.
  const enc = new TextEncoder().encode('joao-daily-greeting:' + iso);
  return crypto.subtle.digest('SHA-256', enc).then((buf) => {
    const b = new Uint8Array(buf).slice(0, 16);
    b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  });
}
async function fetchJson(url: string) {
  try {
    const r = await fetch(url, { headers: { 'accept': 'application/json', 'user-agent': 'STC-Joao/1.0' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function tennisContext(espnDate: string) {
  const [atp, wta, atpRank, wtaRank] = await Promise.all([
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=${espnDate}`),
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard?dates=${espnDate}`),
    fetchJson('https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/rankings?region=us&lang=en'),
    fetchJson('https://site.web.api.espn.com/apis/site/v2/sports/tennis/wta/rankings?region=us&lang=en'),
  ]);
  const ar = rankingMap(atpRank), wr = rankingMap(wtaRank);
  const all = [...boardFacts(atp, 'ATP', ar, localDateParts().iso), ...boardFacts(wta, 'WTA', wr, localDateParts().iso)];
  // Mantém primeiro partidas não encerradas e depois as que têm atleta mais bem ranqueado.
  all.sort((a, b) => {
    const ap = a.state === 'post' ? 1 : 0, bp = b.state === 'post' ? 1 : 0;
    if (ap !== bp) return ap - bp;
    const ra = Math.min(...(a.players || []).map((p: any) => p.rank || 9999), 9999);
    const rb = Math.min(...(b.players || []).map((p: any) => p.rank || 9999), 9999);
    return ra - rb;
  });
  return all.slice(0, 32);
}
/** Pulso do clube (plays de hoje, resultados recentes). Sem a função no banco ou com erro, o bom-dia segue só com o tênis. */
async function clubPulse() {
  try {
    const r = await db.rpc('conv_svc_ai_club_pulse');
    return r.error ? clubFacts(null) : clubFacts(r.data);
  } catch { return clubFacts(null); }
}
async function groupConversation() {
  const g = await db.from('conv_groups').select('id,group_jid,name').eq('name', GROUP_NAME).eq('status', 'allowed').eq('ai_enabled', true).maybeSingle();
  if (g.error || !g.data) throw new Error('GROUP_NOT_FOUND');
  const c = await db.from('conv_conversations').select('id').eq('group_id', g.data.id).eq('kind', 'group').eq('status', 'open').maybeSingle();
  if (c.error || !c.data) throw new Error('GROUP_CONVERSATION_NOT_FOUND');
  return { conversationId: c.data.id, groupJid: g.data.group_jid };
}
async function recentGreetings(conversationId: string) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const r = await db.from('conv_messages').select('body,created_at')
    .eq('conversation_id', conversationId).eq('direction', 'outbound')
    .gte('created_at', since).ilike('body', 'Bom dia%').order('created_at', { ascending: false }).limit(30);
  return (r.data || []).map((x: any) => String(x.body || '')).filter(Boolean);
}
async function currentModel() {
  const r = await db.from('conv_ai_settings').select('model').eq('active', true).order('version', { ascending: false }).limit(1).maybeSingle();
  return String(r.data?.model || 'openai/gpt-6-luna');
}
async function generateGreeting(iso: string, facts: any[], club: ReturnType<typeof clubFacts>, history: string[]) {
  if (!AI_KEY) return fallbackGreeting(iso);
  const user = JSON.stringify({ date: iso, weekday: weekdayName(), tennis_facts: facts, club, recent_greetings: history.slice(0, 30) });
  try {
    const model = await currentModel();
    const r = await fetch(AI_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + AI_KEY, 'x-title': 'STC João Bom Dia' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: GREETING_SYSTEM_PROMPT }, { role: 'user', content: user }], temperature: 0.85, max_tokens: 190 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error('AI_' + r.status);
    const j = await r.json();
    const t = cleanGreeting(j?.choices?.[0]?.message?.content);
    if (!isValidGreeting(t)) throw new Error('AI_BAD_TEXT');
    return t;
  } catch {
    return fallbackGreeting(iso);
  }
}
async function sendUaz(number: string, text: string) {
  if (!UAZ_URL || !UAZ_TOKEN) return { ok: false, error: 'WHATSAPP_NOT_CONFIGURED', providerId: null };
  try {
    const r = await fetch(UAZ_URL + '/send/text', {
      method: 'POST', headers: { 'content-type': 'application/json', 'token': UAZ_TOKEN },
      body: JSON.stringify({ number, text }), signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    const providerId = r.ok ? (j?.messageid || j?.messageId || j?.id || j?.key?.id || null) : null;
    return { ok: r.ok, error: r.ok ? null : 'HTTP_' + r.status, providerId: typeof providerId === 'string' ? providerId : null };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR', providerId: null };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!(await authorized(req))) return json(401, { error: 'UNAUTHORIZED' });
  if (!SERVICE_KEY) return json(503, { error: 'SERVER_NOT_CONFIGURED' });
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;
  try {
    const d = localDateParts();
    const group = await groupConversation();
    const [facts, club, history] = await Promise.all([tennisContext(d.espn), clubPulse(), recentGreetings(group.conversationId)]);
    const text = await generateGreeting(d.iso, facts, club, history);
    if (dryRun) return json(200, { ok: true, dry_run: true, date: d.iso, text, facts_count: facts.length, club, top_facts: facts.slice(0, 5) });
    const key = await idempotencyUuid(d.iso);
    const q = await db.rpc('conv_svc_queue_message', {
      p_conversation: group.conversationId,
      p: { kind: 'text', body: text },
      p_author: null, p_key: key, p_origin: 'system', p_session: null,
    });
    const row = Array.isArray(q.data) ? q.data[0] : q.data;
    if (q.error || !row) return json(500, { error: 'QUEUE_FAILED' });
    if (row.already_sent) return json(200, { ok: true, date: d.iso, already_sent: true, text });
    const sent = await sendUaz(String(row.destination || group.groupJid), text);
    await db.rpc('conv_svc_finish_message', {
      p_message: row.message_id, p_sent: sent.ok, p_provider_id: sent.providerId, p_error: sent.error,
    });
    return json(sent.ok ? 200 : 503, { ok: sent.ok, date: d.iso, text, error: sent.error });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'UNKNOWN' });
  }
});
