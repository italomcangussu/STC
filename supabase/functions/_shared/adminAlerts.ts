// Alertas por regra do João para administradores (Onda 8). Mesmo caminho do resumo da manhã: o banco entrega os números
// (`conv_svc_admin_alert_data`, lidos como o administrador, com os limites das preferências dele) e o texto é montado aqui.
// Cada regra avisa no máximo uma vez por dia por administrador (`conv_svc_admin_alert_claim`).

import { buildChatRequest, providerIdFrom, uazError, type UazCaller } from './uazChat.ts';
import { fortalezaDay, fortalezaHour } from './adminBriefing.ts';

type RpcResult = { data: unknown; error: { message: string } | null };
export type Db = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
type Row = Record<string, unknown>;

const n = (v: unknown) => Number(v ?? 0);
const brl = (v: unknown) => `R$ ${(n(v) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;

export type Alert = { rule: 'overdue' | 'receipts' | 'payables' | 'balance'; text: string };

/** Regras que dispararam, com o texto de cada uma. */
export function evaluateAlerts(d: Row): Alert[] {
  const out: Alert[] = [];
  const o = (d.overdue ?? {}) as Row;
  if (n(o.count) > 0) out.push({ rule: 'overdue', text: `📥 ${plural(n(o.count), 'cobrança vencida', 'cobranças vencidas')} há ${n(d.overdue_days)} dias ou mais: ${brl(o.cents)} de ${plural(n(o.members), 'sócio', 'sócios')}.` });
  const r = (d.receipts_waiting ?? {}) as Row;
  if (n(r.count) > 0) out.push({ rule: 'receipts', text: `🧾 ${plural(n(r.count), 'comprovante esperando', 'comprovantes esperando')} análise há mais de 24 horas.` });
  const p = (d.payables ?? {}) as Row;
  if (n(p.overdue_cents) > 0) out.push({ rule: 'payables', text: `📤 ${plural(n(p.overdue_count), 'conta a pagar vencida', 'contas a pagar vencidas')}: ${brl(p.overdue_cents)}.` });
  if (d.min_balance_cents != null && n(d.total_cents) < n(d.min_balance_cents))
    out.push({ rule: 'balance', text: `💰 O caixa está em ${brl(d.total_cents)}, abaixo do mínimo de ${brl(d.min_balance_cents)} que você definiu.` });
  return out;
}

export function composeAlertMessage(name: string, alerts: Alert[]): string {
  const p = (name.trim().split(/\s+/)[0] ?? '');
  const primeiro = /^\+?\d/.test(p) ? '' : p;
  return `${primeiro ? `${primeiro}, ` : ''}um aviso do clube:\n${alerts.map((a) => a.text).join('\n')}\n\nQuer detalhar? É só pedir aqui.`;
}

const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
async function alertKey(day: string, hour: number, profileId: string, rules: string): Promise<string> {
  const b = (await sha256(`joao-admin-alert:${day}:${hour}:${profileId}:${rules}`)).slice(0, 16);
  b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const ALERT_FROM_HOUR = 9;
export const ALERT_UNTIL_HOUR = 18;
export type AlertSummary = { targets: number; sent: number; skipped: number; failed: number; dry?: { name: string; text: string }[] };

export async function runAdminAlerts(db: Db, uaz: UazCaller | null, opts: { now?: Date; dryRun?: boolean } = {}): Promise<AlertSummary> {
  const now = opts.now ?? new Date();
  const out: AlertSummary = { targets: 0, sent: 0, skipped: 0, failed: 0 };
  const hour = fortalezaHour(now);
  if (!opts.dryRun && (hour < ALERT_FROM_HOUR || hour >= ALERT_UNTIL_HOUR)) return out;
  const t = await db('conv_svc_admin_alert_targets', {});
  if (t.error || !Array.isArray(t.data)) return out;
  if (opts.dryRun) out.dry = [];
  const day = fortalezaDay(now);
  for (const target of t.data as { profile_id: string; name: string; conversation_id: string }[]) {
    out.targets += 1;
    const body = (await db('conv_svc_admin_alert_data', { p_profile: target.profile_id })).data as { ok?: boolean; data?: Row } | null;
    if (!body?.ok || !body.data) { out.failed += 1; continue; }
    let alerts = evaluateAlerts(body.data);
    if (opts.dryRun) { if (alerts.length) out.dry!.push({ name: target.name, text: composeAlertMessage(target.name, alerts) }); continue; }
    // Só entra o que ainda não avisou hoje.
    const fresh: Alert[] = [];
    for (const a of alerts) {
      const claimed = (await db('conv_svc_admin_alert_claim', { p_profile: target.profile_id, p_rule: a.rule, p_day: day })).data === true;
      if (claimed) fresh.push(a);
    }
    alerts = fresh;
    if (!alerts.length) { out.skipped += 1; continue; }
    const release = () => Promise.all(alerts.map((a) => db('conv_svc_admin_alert_release', { p_profile: target.profile_id, p_rule: a.rule, p_day: day })));
    const text = composeAlertMessage(target.name, alerts);
    if (!uaz) { await release(); out.failed += 1; continue; }
    const q = await db('conv_svc_queue_message', { p_conversation: target.conversation_id, p: { kind: 'text', body: text }, p_author: null,
      p_key: await alertKey(day, hour, target.profile_id, alerts.map((a) => a.rule).join(',')), p_origin: 'ai', p_session: null, p_recipient: null });
    const row = (Array.isArray(q.data) ? q.data[0] : null) as { message_id: string; destination: string; already_sent: boolean } | null;
    if (q.error || !row) { await release(); out.failed += 1; continue; }
    if (row.already_sent) { out.skipped += 1; continue; }
    const pedido = buildChatRequest({ action: 'send', number: row.destination, kind: 'text', text });
    const res = pedido ? await uaz(pedido) : { ok: false as const, error: 'INVALID_REQUEST' };
    await db('conv_svc_finish_message', { p_message: row.message_id, p_sent: res.ok,
      p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res) });
    if (res.ok) out.sent += 1; else { await release(); out.failed += 1; }
  }
  return out;
}
