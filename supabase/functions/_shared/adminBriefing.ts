// Resumo da manhã do João para administradores (Onda 4, docs/joao-assessor/MAPA.md).
// O banco entrega os números (`conv_svc_admin_briefing_data`, lidos como o administrador); aqui o texto é montado sem IA
// e enviado na conversa direta dele. Chave de idempotência = dia + administrador: repetir o agendador nunca manda duas vezes.

import { buildChatRequest, providerIdFrom, uazError, type UazCaller } from './uazChat.ts';

type RpcResult = { data: unknown; error: { message: string } | null };
export type Db = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
type Row = Record<string, unknown>;

const n = (v: unknown) => Number(v ?? 0);
const brl = (v: unknown) => `R$ ${(n(v) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const dm = (v: unknown) => String(v ?? '').slice(0, 10).split('-').reverse().slice(0, 2).join('/');
const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;

/** Primeiro nome, ou nada se o cadastro não tiver um nome utilizável. */
const primeiroNome = (nome: string) => { const p = nome.trim().split(/\s+/)[0] ?? ''; return /^\+?\d/.test(p) ? '' : p; };

export function composeBriefing(name: string, d: Row): string {
  const hoje = String(d.today ?? '');
  const linhas: string[] = [`Bom dia${primeiroNome(name) ? `, ${primeiroNome(name)}` : ''}! Resumo do clube de ${dm(hoje)}.`, ''];

  const contas = (Array.isArray(d.accounts) ? d.accounts as Row[] : []);
  const detalhe = contas.length > 1 ? ` (${contas.map((c) => `${c.name} ${brl(c.balance_cents)}`).join(' · ')})` : '';
  linhas.push(`💰 Caixa: ${brl(d.total_cents)}${detalhe}`);
  const ont = (d.yesterday ?? {}) as Row; const mes = (d.month ?? {}) as Row;
  linhas.push(`Ontem entrou ${brl(ont.inflow_cents)} e saiu ${brl(ont.outflow_cents)}. No mês: entrou ${brl(mes.inflow_cents)}, saiu ${brl(mes.outflow_cents)} (${n(mes.net_cents) < 0 ? '-' : ''}${brl(Math.abs(n(mes.net_cents)))}).`);

  const r = (d.receivables ?? {}) as Row; const p = (d.payables ?? {}) as Row;
  linhas.push('');
  linhas.push(`📥 A receber: ${brl(r.open_cents)} em aberto; ${n(r.overdue_cents) > 0 ? `vencido ${brl(r.overdue_cents)} (${plural(n(r.overdue_count), 'cobrança', 'cobranças')}, ${plural(n(r.overdue_members), 'sócio', 'sócios')})` : 'nada vencido'}.`);
  linhas.push(`📤 A pagar: ${brl(p.payable_open_cents)} em aberto; ${n(p.payable_overdue_cents) > 0 ? `vencido ${brl(p.payable_overdue_cents)}` : 'nada vencido'}${n(p.payable_due_7d_cents) > 0 ? `, ${brl(p.payable_due_7d_cents)} vencem em 7 dias` : ''}.`);

  const extras: string[] = [];
  const rec = (d.receipts ?? {}) as Row;
  if (n(rec.total) > 0) extras.push(`🧾 ${plural(n(rec.total), 'comprovante aguardando análise', 'comprovantes aguardando análise')}${rec.oldest_at ? ` (o mais antigo de ${dm(rec.oldest_at)})` : ''}.`);
  for (const s of (Array.isArray(d.signatures) ? d.signatures as Row[] : []).slice(0, 3))
    extras.push(`✍️ «${s.title}»: ${n(s.signed)} de ${n(s.recipients)} assinaram${s.due_at ? `, prazo ${dm(s.due_at)}` : ''}.`);
  const acc = (d.access ?? {}) as Row;
  if (n(acc.total) > 0) extras.push(`🔑 ${plural(n(acc.total), 'pedido de acesso pendente', 'pedidos de acesso pendentes')}.`);
  const res = (d.reservations ?? {}) as Row;
  if (n(res.total) > 0) {
    const tipos = Object.entries((res.by_type ?? {}) as Record<string, number>).map(([t, q]) => `${q} ${t.toLowerCase()}`).join(', ');
    extras.push(`🎾 Hoje: ${plural(n(res.total), 'reserva', 'reservas')}${tipos ? ` (${tipos})` : ''}.`);
  } else extras.push('🎾 Hoje: sem reservas.');
  if (extras.length) { linhas.push(''); linhas.push(...extras); }

  linhas.push('', 'Quer detalhar algo? É só pedir aqui.');
  return linhas.join('\n');
}

const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** UUID v5-like estável por dia e administrador. */
export async function briefingKey(day: string, profileId: string): Promise<string> {
  const b = (await sha256(`joao-admin-briefing:${day}:${profileId}`)).slice(0, 16);
  b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Hora (0-23) em Fortaleza. */
export const fortalezaHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Fortaleza', hour: '2-digit', hourCycle: 'h23' }).format(now));
export const fortalezaDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export type BriefingSummary = { targets: number; sent: number; skipped: number; failed: number; dry?: { name: string; text: string }[] };

/** Janela de envio: a partir das 08h00 e antes do meio-dia (uma chamada tardia não acorda ninguém no fim da tarde). */
export const BRIEFING_FROM_HOUR = 8;
export const BRIEFING_UNTIL_HOUR = 12;

export async function runAdminBriefing(db: Db, uaz: UazCaller | null, opts: { now?: Date; dryRun?: boolean } = {}): Promise<BriefingSummary> {
  const now = opts.now ?? new Date();
  const out: BriefingSummary = { targets: 0, sent: 0, skipped: 0, failed: 0 };
  const hour = fortalezaHour(now);
  if (!opts.dryRun && (hour < BRIEFING_FROM_HOUR || hour >= BRIEFING_UNTIL_HOUR)) return out;
  const t = await db('conv_svc_admin_briefing_targets', {});
  if (t.error || !Array.isArray(t.data)) return out;
  if (opts.dryRun) out.dry = [];
  const day = fortalezaDay(now);
  for (const target of t.data as { profile_id: string; name: string; conversation_id: string }[]) {
    out.targets += 1;
    const dados = await db('conv_svc_admin_briefing_data', { p_profile: target.profile_id });
    const body = dados.data as { ok?: boolean; data?: Row } | null;
    if (dados.error || !body?.ok || !body.data) { out.failed += 1; continue; }
    const text = composeBriefing(target.name, body.data);
    if (opts.dryRun) { out.dry!.push({ name: target.name, text }); continue; }
    if (!uaz) { out.failed += 1; continue; }
    const q = await db('conv_svc_queue_message', { p_conversation: target.conversation_id, p: { kind: 'text', body: text }, p_author: null,
      p_key: await briefingKey(day, target.profile_id), p_origin: 'ai', p_session: null, p_recipient: null });
    const row = (Array.isArray(q.data) ? q.data[0] : null) as { message_id: string; destination: string; already_sent: boolean } | null;
    if (q.error || !row) { out.failed += 1; continue; }
    if (row.already_sent) { out.skipped += 1; continue; }
    const pedido = buildChatRequest({ action: 'send', number: row.destination, kind: 'text', text });
    const res = pedido ? await uaz(pedido) : { ok: false as const, error: 'INVALID_REQUEST' };
    await db('conv_svc_finish_message', { p_message: row.message_id, p_sent: res.ok,
      p_provider_id: res.ok ? providerIdFrom((res as { body: Record<string, unknown> }).body) : null, p_error: uazError(res) });
    if (res.ok) out.sent += 1; else out.failed += 1;
  }
  return out;
}
