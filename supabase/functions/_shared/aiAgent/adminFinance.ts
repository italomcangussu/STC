// Assessor administrativo (financeiro): renovação de Card Mensal e ações financeiras propostas pelo servidor.

import { adminPendencyRefs, isAdminAssistant } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';
import type { DecideInput } from './decide.ts';
import type { Decision, Memory } from './turnTypes.ts';
import { type AdminAction, adminProposalMessage, toCents } from './adminMessages.ts';
import { resolve } from './turnOutcome.ts';

async function adminRenovarCard(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, slots, session } = i;
  const ask = (text: string): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask', memory });
  const nome = slots.student_names?.[0] ?? slots.member_name;
  if (!nome) return ask('Qual aluno? Me diga o nome. Se tiver o comprovante, pode mandar aqui que eu leio.');
  const r = await resolve(deps.db, [nome], 'student');
  if (r.ask) return ask(r.ask);
  const aluno = r.matches[0];
  if (aluno.kind !== 'non_socio') return ask(`${aluno.name} é sócio e não tem Card Mensal de aluno para renovar. Era outro aluno?`);
  const res = (await deps.db('conv_svc_ai_student_card_propose', { p_session: session,
    p: { student_id: aluno.id, amount_cents: toCents(slots.amount), paid_on: slots.paid_on ?? null } })).data as
    { ok: boolean; message?: string; summary?: Ctx } | null;
  if (!res?.ok || !res.summary) return ask(res?.message ?? 'Não consegui montar essa renovação. Pode repetir os dados?');
  return { bubbles: [adminProposalMessage('student_card_renew', res.summary)], awaiting: true, close: false, action: 'proposed_admin', memory };
}

export async function adminFinanceiro(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, ctx, slots, session } = i;
  const ask = (text: string): Decision => ({ bubbles: [text], awaiting: true, close: false, action: 'ask', memory });
  if (!isAdminAssistant(ctx)) return ask('Essa parte do financeiro é só com a diretoria, pela conversa privada. Posso te ajudar com outra coisa?');
  if (slots.fin_action === 'renovar_card') return adminRenovarCard(i, memory);
  const refs = adminPendencyRefs(ctx);
  const ref = slots.pendency_ref ? refs.find((r) => r.ref === slots.pendency_ref) : undefined;
  if (slots.pendency_ref && !ref) return ask('Não achei essa pendência na lista. Qual é (sócio e descrição)?');
  const member = async () => {
    if (!slots.member_name) return { ask: 'De qual sócio?' };
    const r = await resolve(deps.db, [slots.member_name], 'member');
    return r.ask ? { ask: r.ask } : { id: r.ids[0] };
  };

  let p: Record<string, unknown>;
  if (slots.fin_action === 'lancar') {
    const m = await member();
    if (m.ask) return ask(m.ask);
    if (!slots.description) return ask('Qual a descrição da pendência?');
    const cents = toCents(slots.amount);
    if (!cents) return ask('Qual é o valor?');
    p = { action: 'fin_pendency_create', profile_id: m.id, description: slots.description, amount_cents: cents, due_date: slots.due_date ?? null,
      pendency_kind: slots.pendency_kind ?? null, guest_name: slots.guest_name ?? null, guest_date: slots.guest_date ?? null, send_now: slots.send_now === true };
  } else if (slots.fin_action === 'cobrar') {
    if (ref) p = { action: 'fin_pendency_send', charge_id: ref.id };
    else {
      const m = await member();
      if (m.ask) return ask(m.ask);
      p = { action: 'fin_pendency_send', profile_id: m.id };
    }
  } else if (slots.fin_action === 'pausar' || slots.fin_action === 'retomar') {
    if (!ref) return ask(`Qual pendência você quer ${slots.fin_action}? Me diga o sócio e a descrição (ou o número da lista, tipo p1).`);
    p = { action: 'fin_pendency_collection', charge_id: ref.id, enabled: slots.fin_action === 'retomar' };
  } else if (slots.fin_action === 'baixa') {
    if (!ref) return ask('Qual pendência foi paga? Me diga o sócio e a descrição (ou o número da lista, tipo p1).');
    const cents = toCents(slots.amount);
    if (!cents) return ask('Qual valor foi pago?');
    p = { action: 'fin_payment', charge_id: ref.id, amount_cents: cents, paid_on: slots.paid_on ?? null, method: slots.method ?? null, account_name: slots.account_name ?? null };
  } else if (slots.fin_action === 'cancelar_pendencia') {
    if (!ref) return ask('Qual pendência cancelar? Me diga o sócio e a descrição (ou o número da lista, tipo p1).');
    p = { action: 'fin_charge_cancel', charge_id: ref.id, reason: slots.reason ?? null };
  } else if (slots.fin_action === 'ajustar') {
    if (!ref) return ask('Em qual pendência? Me diga o sócio e a descrição (ou o número da lista, tipo p1).');
    const cents = toCents(slots.amount);
    if (!cents) return ask('Qual o valor do ajuste?');
    p = { action: 'fin_charge_adjust', charge_id: ref.id, adjust_kind: slots.adjust_kind ?? null, amount_cents: cents, reason: slots.reason ?? null };
  } else if (slots.fin_action === 'estornar') {
    if (ref) p = { action: 'fin_payment_reverse', charge_id: ref.id, reason: slots.reason ?? null };
    else {
      const m = await member();
      if (m.ask) return ask(m.ask);
      p = { action: 'fin_payment_reverse', profile_id: m.id, reason: slots.reason ?? null };
    }
  } else if (slots.fin_action === 'gerar_cobrancas') {
    p = { action: 'fin_charges_generate' };
  } else if (slots.fin_action === 'aprovar_comprovante') {
    const m = await member();
    if (m.ask) return ask(m.ask);
    p = { action: 'fin_receipt_approve', profile_id: m.id, receipt_date: slots.receipt_date ?? null, paid_on: slots.paid_on ?? null,
      method: slots.method ?? null, account_name: slots.account_name ?? null };
  } else if (slots.fin_action === 'rejeitar_comprovante') {
    const m = await member();
    if (m.ask) return ask(m.ask);
    p = { action: 'fin_receipt_reject', profile_id: m.id, receipt_date: slots.receipt_date ?? null, reason: slots.reason ?? null };
  } else if (slots.fin_action === 'despesa' || slots.fin_action === 'receita') {
    if (!slots.description) return ask(`Qual a descrição da ${slots.fin_action}?`);
    const cents = toCents(slots.amount);
    if (!cents) return ask('Qual o valor?');
    p = { action: 'fin_entry_create', entry_kind: slots.fin_action === 'despesa' ? 'expense' : 'revenue', description: slots.description, amount_cents: cents,
      entry_status: slots.entry_status ?? null, due_date: slots.due_date ?? null, paid_on: slots.paid_on ?? null,
      category_name: slots.category_name ?? null, category_new: slots.category_new === true || null, account_name: slots.account_name ?? null };
  } else {
    return ask('O que você quer fazer: lançar pendência, cobrar agora, pausar/retomar a cobrança, dar baixa, cancelar ou ajustar uma pendência, estornar um pagamento, aprovar ou recusar um comprovante, gerar as cobranças do mês ou lançar uma despesa/receita?');
  }

  // Conta padrão do administrador (preferência), quando ele não disse a conta.
  if (p.account_name == null && ['fin_payment', 'fin_entry_create', 'fin_receipt_approve'].includes(String(p.action))) {
    const pf = (await deps.db('conv_svc_ai_admin_prefs', { p_session: session })).data as { ok?: boolean; prefs?: { default_account?: string | null } } | null;
    if (pf?.ok && pf.prefs?.default_account) p.account_name = pf.prefs.default_account;
  }
  const res = (await deps.db('conv_svc_ai_admin_finance_propose', { p_session: session, p })).data as
    { ok: boolean; code?: string; message?: string; action?: AdminAction; summary?: Ctx } | null;
  if (!res?.ok || !res.summary || !res.action) return ask(res?.message ?? 'Não consegui montar esse lançamento. Pode repetir os dados?');
  return { bubbles: [adminProposalMessage(res.action, res.summary)], awaiting: true, close: false, action: 'proposed_admin', memory, verbatim: true };
}
