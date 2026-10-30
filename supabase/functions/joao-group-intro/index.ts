// @ts-nocheck
// Apresentação do João num grupo recém-liberado (30/10, grupo do AUGE OPEN). Lê o papo do grupo (banco e, se ainda
// houver pouco, a UAZAPI) e a lista de inscritos, escreve como João Fonseca, o Fonsequinha, e posta UMA vez:
// conv_groups.intro_sent_at marca o grupo e cada bolha tem chave de idempotência. Mesmo segredo do bom-dia (x-joao-secret).
// Corpo: { "group_id": "<uuid>", "dry_run": true|false, "messages"?: [texto conferido no teste seco] }.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import { INTRO_SYSTEM, fallbackIntro, introUserPayload, linesFromUaz, pickIntro } from "./messages.ts";

const URL = Deno.env.get("SUPABASE_URL");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const UAZ = (Deno.env.get("UAZAPI_SERVER_URL") || "").replace(/\/$/, "");
const TOKEN = Deno.env.get("STC_UAZAPI_INSTANCE_TOKEN") || "";
const AIKEY = Deno.env.get("STC_AI_API_KEY") || "";
const AIBASE = (Deno.env.get("STC_AI_BASE_URL") || "https://openrouter.ai/api/v1").replace(/\/$/, "");
if (!URL) throw new Error("NO_SUPABASE_URL");
const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

const js = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function auth(req) {
  const secret = req.headers.get("x-joao-secret") || "";
  if (!secret || !SERVICE) return false;
  const r = await db.rpc("joao_daily_secret_ok", { p_secret: secret });
  return !r.error && r.data === true;
}
async function model() {
  const r = await db.from("conv_ai_settings").select("model").eq("active", true).order("version", { ascending: false }).limit(1).maybeSingle();
  return String(r.data?.model || "openai/gpt-6-luna");
}
/** O que rolou no grupo antes de ele ser liberado não está no banco: a UAZAPI guarda. Falhou → segue sem. */
async function uazRecent(jid) {
  if (!UAZ || !TOKEN || !jid) return [];
  try {
    const r = await fetch(UAZ + "/message/find", { method: "POST", headers: { "content-type": "application/json", token: TOKEN },
      body: JSON.stringify({ chatid: jid, limit: 30 }), signal: AbortSignal.timeout(15000) });
    return r.ok ? linesFromUaz(await r.json().catch(() => null)) : [];
  } catch { return []; }
}
async function write(c) {
  if (!AIKEY) return { messages: fallbackIntro(c), source: "fallback:no_key", usage: null };
  try {
    const r = await fetch(AIBASE + "/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + AIKEY, "x-title": "STC Conversas" },
      body: JSON.stringify({ model: await model(), max_tokens: 1500, reasoning: { effort: "low" },
        messages: [{ role: "system", content: INTRO_SYSTEM }, { role: "user", content: introUserPayload(c) }] }),
      signal: AbortSignal.timeout(40000),
    });
    if (!r.ok) return { messages: fallbackIntro(c), source: "fallback:http_" + r.status, usage: null };
    const j = await r.json().catch(() => null);
    const raw = String(j?.choices?.[0]?.message?.content || "");
    const messages = pickIntro(raw, c);
    const fallback = JSON.stringify(messages) === JSON.stringify(fallbackIntro(c));
    return { messages, source: fallback ? "fallback:format" : "model", usage: j?.usage ?? null };
  } catch (e) { return { messages: fallbackIntro(c), source: "fallback:" + (e?.name || "error"), usage: null }; }
}
async function idkey(s) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("joao-group-intro:" + s))).slice(0, 16);
  b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const pid = (j) => { const x = j?.messageid ?? j?.messageId ?? j?.id ?? j?.key?.id; return typeof x === "string" && x ? x : null; };
async function send(number, text) {
  if (!UAZ || !TOKEN) return { ok: false, provider: null, error: "WHATSAPP_NOT_CONFIGURED" };
  try {
    const r = await fetch(UAZ + "/send/text", { method: "POST", headers: { "content-type": "application/json", token: TOKEN },
      body: JSON.stringify({ number, text }), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, provider: r.ok ? pid(j) : null, error: r.ok ? null : "HTTP_" + r.status };
  } catch (e) { return { ok: false, provider: null, error: e instanceof Error && e.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR" }; }
}
/** Enfileira no histórico (o João lembra o que disse), reivindica e envia. */
async function deliver(cid, key, text) {
  const q = await db.rpc("conv_svc_queue_message", { p_conversation: cid, p: { kind: "text", body: text }, p_author: null, p_key: await idkey(key), p_origin: "ai", p_session: null, p_recipient: null });
  const row = Array.isArray(q.data) ? q.data[0] : q.data;
  if (q.error || !row) return "queue_failed";
  if (row.already_sent) return "already_sent";
  const claim = await db.from("conv_messages").update({ last_error: "CLAIMED" }).eq("id", row.message_id).in("status", ["queued", "failed"]).or("last_error.is.null,last_error.neq.CLAIMED").select("id");
  if (claim.error || !claim.data?.length) return "in_flight";
  const s = await send(String(row.destination), text);
  await db.rpc("conv_svc_finish_message", { p_message: row.message_id, p_sent: s.ok, p_provider_id: s.provider, p_error: s.error });
  return s.ok ? "sent" : s.error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return js(405, { error: "METHOD_NOT_ALLOWED" });
  if (!(await auth(req))) return js(401, { error: "UNAUTHORIZED" });
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body?.group_id || ""))) return js(400, { error: "GROUP_ID_REQUIRED" });
  const dry = body?.dry_run === true;
  try {
    const r = await db.rpc("conv_svc_group_intro_context", { p_group: body.group_id });
    const g = r.data;
    if (r.error || !g?.ok) return js(409, { error: g?.code || "CONTEXT_FAILED" });
    if (g.intro_sent_at && !dry) return js(200, { ok: true, status: "already_introduced", at: g.intro_sent_at });
    const recent = (g.recent?.length ?? 0) >= 5 ? g.recent : [...(await uazRecent(g.group_jid)), ...(g.recent ?? [])];
    const c = { group_name: g.group_name, persona: g.persona, championship: g.championship, recent };
    // Texto já conferido no teste seco: sai exatamente ele, se passar nas mesmas regras; senão, nada sai.
    const approved = Array.isArray(body?.messages) ? body.messages : null;
    if (approved) {
      const ok = pickIntro(JSON.stringify({ mensagens: approved }), c);
      if (JSON.stringify(ok) !== JSON.stringify(approved.map((m) => String(m).trim()))) return js(422, { error: "APPROVED_TEXT_REJECTED" });
    }
    const t = approved ? { messages: approved.map((m) => String(m).trim()), source: "approved", usage: null } : await write(c);
    // Teste seco mostra o papo que ele leu, para conferir que a brincadeira saiu do grupo e não da cabeça do modelo.
    if (dry) return js(200, { ok: true, dry_run: true, source: t.source, recent: recent.length, read: recent, messages: t.messages, usage: t.usage });
    const out = [];
    for (const [i, m] of t.messages.entries()) {
      if (i) await new Promise((ok) => setTimeout(ok, 2500));   // ritmo de gente digitando, não rajada de robô
      out.push(await deliver(g.conversation_id, `${g.group_id}:${i}`, m));
    }
    if (out.some((x) => x === "sent" || x === "already_sent")) await db.rpc("conv_svc_group_intro_done", { p_group: g.group_id });
    return js(200, { ok: true, source: t.source, recent: recent.length, delivered: out, messages: t.messages, usage: t.usage });
  } catch (e) { return js(500, { error: e instanceof Error ? e.message : "UNKNOWN" }); }
});
