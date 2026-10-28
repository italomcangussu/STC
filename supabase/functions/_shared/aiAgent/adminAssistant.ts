// Assessor administrativo: propostas e execução de ações do financeiro, cadastros, consultas e arquivos.

import { type AdminReadDomain, FORMS_DOMAINS, renderAdminRead } from './adminReads.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';
import type { DecideInput } from './decide.ts';
import type { Decision, Memory } from './turnTypes.ts';
import { adminArquivo } from './adminFileReply.ts';
import { type Args, READ_FAILED, askWith, memberId, periodArgs, readAdmin } from './adminReadRpc.ts';
import { type AdminAction, adminProposalMessage } from './adminMessages.ts';
import { ADM_BUILDERS } from './adminActionPayloads.ts';
import { resolve } from './turnOutcome.ts';

/** "14/01", "8/10" ou "08-10" → { day, month }; qualquer outra coisa → null (o banco ainda valida 31/04 e afins). */
export function birthdayParts(v: string | null | undefined): { day: number; month: number } | null {
  const m = /^(\d{1,2})[/-](\d{1,2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? { day, month } : null;
}
export function parseBirthday(v: unknown): string | null {
  const b = birthdayParts(typeof v === 'string' ? v : null);
  return b ? `${String(b.day).padStart(2, '0')}/${String(b.month).padStart(2, '0')}` : null;
}

/** Aniversário contado pelo administrador: grava na hora (dado de baixo risco, auditado no banco), sem pedir "sim". */
async function adminAniversario(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, slots, session } = i;
  const reply = (text: string, awaiting = false): Decision => ({ bubbles: [text], awaiting, close: false, action: 'admin_birthday', memory });
  if (!slots.member_name) return reply('De quem é o aniversário?', true);
  const b = birthdayParts(slots.birthday);
  if (!b) return reply(`Qual o dia e o mês do aniversário de ${slots.member_name}? Ex.: 14/01.`, true);
  const r = await resolve(deps.db, [slots.member_name], 'member');
  if (r.ask) return reply(r.ask, true);
  const res = (await deps.db('conv_svc_ai_admin_birthday_set', { p_session: session, p: { profile_id: r.ids[0], day: b.day, month: b.month } })).data as
    { ok: boolean; message?: string; member_name?: string } | null;
  if (!res?.ok) return reply(res?.message ?? 'Não consegui gravar o aniversário agora. Tenta de novo daqui a pouco?');
  const dm = `${String(b.day).padStart(2, '0')}/${String(b.month).padStart(2, '0')}`;
  return reply(`Anotei: aniversário de ${res.member_name} em ${dm}. No dia, às 8h, eu mando os parabéns no grupo e no privado. 🎂`);
}

/** Ações administrativas reversíveis (N1): o servidor valida e propõe; só grava depois do "sim" do administrador. */
export async function adminAcao(i: DecideInput, memory: Memory): Promise<Decision> {
  const ask = askWith(memory);
  if (!isAdminAssistant(i.ctx)) return ask('Essa parte é só com a diretoria, pela conversa privada. Posso te ajudar com outra coisa?', false);
  const a = i.slots.adm_action;
  if (a === 'aniversario') return adminAniversario(i, memory);
  const builder = a ? ADM_BUILDERS[a] : undefined;
  if (!builder) return ask('O que você quer fazer: publicar ou tirar um aviso, pausar/reativar aluno, inativar/reativar sócio, reenviar avisos de assinatura, cancelar uma reserva, aprovar ou recusar pedido de acesso ou cadastrar um sócio novo?');
  const step = await builder.build(i);
  if ('ask' in step) return ask(step.ask, step.awaiting ?? true);
  const res = (await i.deps.db(builder.rpc, { p_session: i.session, p: step.p })).data as
    { ok: boolean; message?: string; action?: AdminAction; summary?: Ctx } | null;
  if (!res?.ok || !res.summary || !res.action) return ask(res?.message ?? 'Não consegui montar isso. Pode repetir os dados?');
  return { bubbles: [adminProposalMessage(res.action, res.summary)], awaiting: true, close: false, action: 'proposed_admin', memory, verbatim: true };
}

/** Argumentos que alguns domínios pedem além do período; os demais leem só o período. */
async function domainArgs(i: DecideInput, domain: AdminReadDomain): Promise<Args | { ask: string }> {
  const { slots } = i;
  if (domain === 'memoria') return { subject: slots.member_name ?? null };
  if (domain === 'comprovantes_whatsapp') return { name: slots.member_name ?? null };
  if (FORMS_DOMAINS.includes(domain)) return { form_ref: slots.form_ref ?? null };
  if (domain !== 'socio_ficha') return {};
  if (!slots.member_name) return { ask: 'De qual sócio você quer a ficha?' };
  const m = await memberId(i, slots.member_name);
  return 'ask' in m ? m : { profile_id: m.id };
}

/** Consulta do assessor: o servidor busca como o administrador e escreve o texto; o modelo só escolheu domínio e período. */
export async function adminConsulta(i: DecideInput, memory: Memory): Promise<Decision> {
  const ask = askWith(memory);
  if (!isAdminAssistant(i.ctx)) return ask('Essa consulta é só com a diretoria, pela conversa privada. Posso te ajudar com outra coisa?', false);
  if (i.slots.file_kind) return adminArquivo(i, memory);
  const domain = i.slots.read_domain;
  if (!domain) return ask('O que você quer ver: caixa, a receber/a pagar, resultado (DRE), receita de alunos, comprovantes, pedidos de acesso, assinaturas ou reservas do dia?');
  const extra = await domainArgs(i, domain);
  if ('ask' in extra) return ask(String(extra.ask));
  const res = await readAdmin(i, domain, { ...periodArgs(i), ...extra });
  if (!res?.ok) return ask(res?.message ?? READ_FAILED, false);
  return { bubbles: [renderAdminRead(domain, res.data)], awaiting: false, close: false, action: `admin_read:${domain}`, memory, verbatim: true };
}
