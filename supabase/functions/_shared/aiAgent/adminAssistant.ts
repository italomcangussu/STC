// Assessor administrativo: propostas e execução de ações do financeiro, cadastros, consultas e arquivos.

import { type AdminReadDomain, FORMS_DOMAINS, READ_MORE_DOMAINS, renderAdminRead } from './adminReads.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';
import type { DecideInput } from './decide.ts';
import type { Decision, Memory, OutFile, RpcResult, TurnDeps } from './turnTypes.ts';
import { type FileKind, reportDoc, safeName } from './adminFiles.ts';
import { renderCapabilities } from './capabilities.ts';
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
  const ask = (text: string, awaiting = true): Decision => ({ bubbles: [text], awaiting, close: false, action: 'ask', memory });
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

/** Consulta do assessor: o servidor busca como o administrador e escreve o texto; o modelo só escolheu domínio e período. */
export async function adminConsulta(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, ctx, slots, session } = i;
  const ask = (text: string, awaiting = true): Decision => ({ bubbles: [text], awaiting, close: false, action: 'ask', memory });
  if (!isAdminAssistant(ctx)) return ask('Essa consulta é só com a diretoria, pela conversa privada. Posso te ajudar com outra coisa?', false);
  if (slots.file_kind) return adminArquivo(i, memory);
  if (!slots.read_domain) return ask('O que você quer ver: caixa, a receber/a pagar, resultado (DRE), receita de alunos, comprovantes, pedidos de acesso, assinaturas ou reservas do dia?');
  const args: Record<string, unknown> = { from: slots.read_from ?? null, to: slots.read_to ?? null, date: slots.date ?? null };
  if (slots.read_domain === 'memoria') args.subject = slots.member_name ?? null;
  if (FORMS_DOMAINS.includes(slots.read_domain)) args.form_ref = slots.form_ref ?? null;
  if (slots.read_domain === 'socio_ficha') {
    if (!slots.member_name) return ask('De qual sócio você quer a ficha?');
    const r = await resolve(deps.db, [slots.member_name], 'member');
    if (r.ask) return ask(r.ask);
    args.profile_id = r.ids[0];
  }
  const res = (await readAdmin(deps, session, slots.read_domain, args)).data as
    { ok: boolean; message?: string; data?: unknown } | null;
  if (!res?.ok) return ask(res?.message ?? 'Não consegui consultar isso agora. Tenta de novo daqui a pouco?', false);
  return { bubbles: [renderAdminRead(slots.read_domain, res.data)], awaiting: false, close: false, action: `admin_read:${slots.read_domain}`, memory, verbatim: true };
}

/** Arquivo para o administrador no privado (somente leitura, vai para ele mesmo): PDF de relatório ou documento que o sistema guarda. */
async function adminArquivo(i: DecideInput, memory: Memory): Promise<Decision> {
  const { deps, slots, session } = i;
  const ask = (text: string, awaiting = true): Decision => ({ bubbles: [text], awaiting, close: false, action: 'ask', memory });
  const kit = deps.files;
  if (!kit) return ask('Não consegui gerar ou anexar arquivo agora. Posso te mandar o resumo em texto?', false);
  const falhou = ask('Não consegui anexar o arquivo agora. Tenta de novo daqui a pouco?', false);
  const kind = slots.file_kind as FileKind;
  if (kind === 'relatorio_pdf') {
    if (!slots.read_domain) return ask('De qual relatório você quer o PDF: caixa, a receber/a pagar, resultado (DRE), receita de alunos, comparativo, comprovantes, assinaturas ou reservas do dia? E de qual período?');
    const args: Record<string, unknown> = { from: slots.read_from ?? null, to: slots.read_to ?? null, date: slots.date ?? null };
    const res = (await readAdmin(deps, session, slots.read_domain, args)).data as { ok: boolean; message?: string; data?: unknown } | null;
    if (!res?.ok) return ask(res?.message ?? 'Não consegui consultar isso agora. Tenta de novo daqui a pouco?', false);
    const quando = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(',', '');
    const doc = reportDoc(slots.read_domain, res.data, quando);
    const bytes = await kit.pdf(doc).catch(() => null);
    if (!bytes) return falhou;
    const nome = `${safeName(doc.title.replace(/^STC — /, ''))}-${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' })}.pdf`;
    const path = await kit.stage({ bytes }, nome, 'application/pdf');
    if (!path) return falhou;
    return { bubbles: ['Aqui está o PDF, gerado agora com os mesmos números da consulta.'], awaiting: false, close: false, action: `admin_file:${slots.read_domain}`, memory,
      files: [{ path, name: nome, mime: 'application/pdf', caption: doc.title.replace(/^STC — /, '') + (doc.subtitle ? ` · ${doc.subtitle.replace('Período: ', '')}` : '') }] };
  }
  const p: Record<string, unknown> = { kind, from: slots.read_from ?? null, to: slots.read_to ?? null };
  if (kind === 'comprovante') {
    if (slots.member_name) {
      const r = await resolve(deps.db, [slots.member_name], 'member');
      if (r.ask) return ask(r.ask);
      p.profile_id = r.ids[0];
    }
  } else if (kind === 'despesa_anexo') p.text = slots.description ?? slots.note ?? null;
  else p.text = slots.doc_title ?? null;
  const res = (await deps.db('conv_svc_ai_admin_file', { p_session: session, p })).data as
    { ok: boolean; message?: string; files?: { bucket: string; path: string; name: string; mime: string; label: string }[] } | null;
  if (!res?.ok || !res.files?.length) return ask(res?.message ?? 'Não achei nenhum arquivo com esses dados.', false);
  const out: OutFile[] = [];
  for (const f of res.files) {
    const path = await kit.stage({ bucket: f.bucket, path: f.path }, f.name, f.mime);
    if (path) out.push({ path, name: f.name, mime: f.mime, caption: f.label });
  }
  if (!out.length) return falhou;
  return { bubbles: [out.length > 1 ? `Achei ${out.length} arquivos, já mando.` : 'Achei, já mando o arquivo.'], awaiting: false, close: false, action: `admin_file:${kind}`, memory, files: out };
}

/** Consulta do assessor: cada domínio vai para a função certa do banco (mesmo contrato `{ ok, message, data }`). */
function readAdmin(deps: TurnDeps, session: string, domain: AdminReadDomain, args: Record<string, unknown>) {
  if (domain === 'memoria') return deps.db('conv_svc_ai_admin_memories', { p_session: session, p_subject: typeof args.subject === 'string' ? args.subject : null });
  if (domain === 'capacidades') return Promise.resolve({ data: { ok: true, data: { text: renderCapabilities() } }, error: null } as RpcResult);
  if (domain === 'socios') return deps.db('conv_svc_ai_admin_members', { p_session: session });
  if (FORMS_DOMAINS.includes(domain)) return deps.db('conv_svc_ai_admin_forms_read', { p_session: session, p_domain: domain, p_args: args });
  if (READ_MORE_DOMAINS.includes(domain)) return deps.db('conv_svc_ai_admin_read_more', { p_session: session, p_domain: domain, p_args: args });
  return deps.db('conv_svc_ai_admin_read', { p_session: session, p_domain: domain, p_args: args });
}
