// @ts-nocheck
// Parabéns de aniversário do João: todo dia às 08h (cron "joao-birthdays"), para cada sócio ativo que faz anos hoje,
// uma mensagem no grupo de sócios (com menção) e outra no privado. Mesmo segredo do bom-dia (x-joao-secret).
// Cada mensagem tem chave de idempotência por pessoa+dia+canal e é reivindicada antes de sair: nunca duplica.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import { BIRTHDAY_SYSTEM, groupText, pickTexts, fallbackTexts } from "./messages.ts";

const URL = Deno.env.get("SUPABASE_URL");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const UAZ = (Deno.env.get("UAZAPI_SERVER_URL") || "").replace(/\/$/, "");
const TOKEN = Deno.env.get("STC_UAZAPI_INSTANCE_TOKEN") || "";
const AIKEY = Deno.env.get("STC_AI_API_KEY") || "";
const AIBASE = (Deno.env.get("STC_AI_BASE_URL") || "https://openrouter.ai/api/v1").replace(/\/$/, "");
if (!URL) throw new Error("NO_SUPABASE_URL");
const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const GROUP = "Sócios Sobral Tênis Clube";

const js = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

async function auth(req) {
  const secret = req.headers.get("x-joao-secret") || "";
  if (!secret || !SERVICE) return false;
  const r = await db.rpc("joao_daily_secret_ok", { p_secret: secret });
  return !r.error && r.data === true;
}
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });

async function group() {
  const g = await db.from("conv_groups").select("id,group_jid").eq("name", GROUP).eq("status", "allowed").eq("ai_enabled", true).maybeSingle();
  if (g.error || !g.data) return null;
  const c = await db.from("conv_conversations").select("id").eq("group_id", g.data.id).eq("kind", "group").eq("status", "open").maybeSingle();
  return c.error || !c.data ? null : { cid: c.data.id, jid: g.data.group_jid };
}
async function model() {
  const r = await db.from("conv_ai_settings").select("model").eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  return String(r.data?.model || "openai/gpt-6-luna");
}
async function texts(b, today) {
  if (!AIKEY) return fallbackTexts(b, today);
  try {
    const r = await fetch(AIBASE + "/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + AIKEY },
      body: JSON.stringify({ model: await model(), temperature: 0.9, max_tokens: 300, messages: [
        { role: "system", content: BIRTHDAY_SYSTEM },
        { role: "user", content: JSON.stringify({ aniversariante: b.name, memorias: b.memories }) }] }),
      signal: AbortSignal.timeout(18000),
    });
    if (!r.ok) return fallbackTexts(b, today);
    const j = await r.json().catch(() => null);
    return pickTexts(String(j?.choices?.[0]?.message?.content || ""), b, today);
  } catch { return fallbackTexts(b, today); }
}
async function idkey(s) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("joao-birthday:" + s))).slice(0, 16);
  b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const pid = (j) => { const x = j?.messageid ?? j?.messageId ?? j?.id ?? j?.key?.id; return typeof x === "string" && x ? x : null; };
async function send(number, text, mentions) {
  if (!UAZ || !TOKEN) return { ok: false, provider: null, error: "WHATSAPP_NOT_CONFIGURED" };
  try {
    const r = await fetch(UAZ + "/send/text", { method: "POST", headers: { "content-type": "application/json", token: TOKEN },
      body: JSON.stringify({ number, text, ...(mentions ? { mentions } : {}) }), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, provider: r.ok ? pid(j) : null, error: r.ok ? null : "HTTP_" + r.status };
  } catch (e) { return { ok: false, provider: null, error: e instanceof Error && e.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR" }; }
}
/** Enfileira no histórico (o João lembra que mandou), reivindica e envia. Devolve o que aconteceu. */
async function deliver(cid, key, text, mentions) {
  const q = await db.rpc("conv_svc_queue_message", { p_conversation: cid, p: { kind: "text", body: text }, p_author: null, p_key: await idkey(key), p_origin: "ai", p_session: null, p_recipient: null });
  const row = Array.isArray(q.data) ? q.data[0] : q.data;
  if (q.error || !row) return "queue_failed";
  if (row.already_sent) return "already_sent";
  const claim = await db.from("conv_messages").update({ last_error: "CLAIMED" }).eq("id", row.message_id).in("status", ["queued", "failed"]).or("last_error.is.null,last_error.neq.CLAIMED").select("id");
  if (claim.error || !claim.data?.length) return "in_flight";
  const s = await send(String(row.destination), text, mentions);
  await db.rpc("conv_svc_finish_message", { p_message: row.message_id, p_sent: s.ok, p_provider_id: s.provider, p_error: s.error });
  return s.ok ? "sent" : s.error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return js(405, { error: "METHOD_NOT_ALLOWED" });
  if (!(await auth(req))) return js(401, { error: "UNAUTHORIZED" });
  const body = await req.json().catch(() => ({}));
  const today = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : todayIso();
  try {
    const r = await db.rpc("conv_svc_birthdays_today", { p_today: today });
    if (r.error) return js(500, { error: "BIRTHDAYS_FAILED" });
    const people = Array.isArray(r.data) ? r.data : [];
    const g = people.length ? await group() : null;
    const out = [];
    for (const b of people) {
      const t = await texts(b, today);
      if (body?.dry_run === true) { out.push({ name: b.name, group: groupText(b, t.group), direct: t.direct }); continue; }
      const res = { name: b.name, group: "no_group", direct: b.direct_conversation_id ? [] : "no_direct" };
      if (g) res.group = await deliver(g.cid, `${b.profile_id}:${today}:group`, groupText(b, t.group), b.phone);
      if (b.direct_conversation_id) {
        for (const [i, m] of t.direct.entries()) res.direct.push(await deliver(b.direct_conversation_id, `${b.profile_id}:${today}:direct:${i}`, m, null));
      }
      out.push(res);
    }
    return js(200, { ok: true, date: today, dry_run: body?.dry_run === true, birthdays: out });
  } catch (e) { return js(500, { error: e instanceof Error ? e.message : "UNKNOWN" }); }
});
