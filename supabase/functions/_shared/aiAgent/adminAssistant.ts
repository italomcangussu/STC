// Assessor administrativo: propostas e execução de ações do financeiro, cadastros, consultas e arquivos.

import { type AdminReadDomain, FORMS_DOMAINS, READ_MORE_DOMAINS, renderAdminRead } from './adminReads.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';
import type { DecideInput } from './decide.ts';
import type { Decision, Memory, OutFile, RpcResult, TurnDeps } from './turnTypes.ts';
import { type FileKind, reportDoc, safeName } from './adminFiles.ts';
import { renderCapabilities } from './capabilities.ts';
import { type AdminAction, adminProposalMessage, toCents } from './adminMessages.ts';
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
  const { deps, ctx, slots, session } = i;
  const ask = (text: string, awaiting = true): Decision => ({ bubbles: [text], awaiting, close: false, action: 'ask', memory });
  if (!isAdminAssistant(ctx)) return ask('Essa parte é só com a diretoria, pela conversa privada. Posso te ajudar com outra coisa?', false);
  const a = slots.adm_action;
  if (a === 'aniversario') return adminAniversario(i, memory);
  let p: Record<string, unknown>;
  if (a === 'aviso') {
    if (!slots.ann_title) return ask('Qual o título do aviso?');
    if (!slots.ann_message) return ask('E o texto do aviso?');
    p = { action: 'adm_announcement_create', title: slots.ann_title, message: slots.ann_message, expires_on: slots.due_date ?? null };
  } else if (a === 'aviso_desativar') {
    if (!slots.ann_title) return ask('Qual aviso tirar do ar? Me diga o título.');
    p = { action: 'adm_announcement_deactivate', title: slots.ann_title };
  } else if (a === 'aluno_status') {
    const nome = slots.student_names?.[0];
    if (!nome) return ask('Qual aluno?');
    if (typeof slots.active !== 'boolean') return ask('É para pausar ou reativar?');
    p = { action: 'adm_student_status', student_name: nome, status: slots.active ? 'active' : 'paused' };
  } else if (a === 'socio_status') {
    if (!slots.member_name) return ask('Qual sócio?');
    if (typeof slots.active !== 'boolean') return ask('É para inativar ou reativar?');
    p = { action: 'adm_member_status', member_name: slots.member_name, active: slots.active };
  } else if (a === 'assinatura_reenviar') {
    p = { action: 'adm_signature_resend', title: slots.doc_title ?? '' };
  } else if (a === 'reserva_cancelar') {
    if (!slots.date || !slots.start) return ask('Qual o dia e o horário de início da reserva?');
    p = { action: 'adm_reservation_cancel', date: slots.date, start: slots.start, court_label: slots.court_label ?? null, by_name: slots.by_name ?? null, reason: slots.reason ?? null };
  } else if (a === 'mensagem_enviar') {
    if (!slots.member_name) return ask('Para qual sócio eu mando a mensagem?');
    if (!slots.send_body) return ask(`O que eu digo para ${slots.member_name}? Me passe o recado (ou o que quer que eu pergunte).`);
    const r = await resolve(deps.db, [slots.member_name], 'member');
    if (r.ask) return ask(r.ask);
    p = { action: 'adm_message_send', profile_id: r.ids[0], body: slots.send_body };
  } else if (a === 'resenha_grupo') {
    if (!slots.send_body) return ask('Bora! Sobre quem é a resenha e qual a pegada? Se quiser, eu escolho a vítima. 😂');
    let alvo: string | null = null;
    if (slots.member_name) {
      const r = await resolve(deps.db, [slots.member_name], 'member');
      if (r.ask) return ask(r.ask);
      alvo = r.ids[0];
    }
    p = { body: slots.send_body, profile_id: alvo };
  } else if (a === 'memoria_esquecer') {
    if (!slots.member_name) return ask('Sobre quem é a memória que devo esquecer? Se quiser só uma delas, me diga um trecho do que ela diz.');
    p = { action: 'adm_memory_forget', subject: slots.member_name, text: slots.note ?? null };
  } else if (a === 'resumo_destinatario') {
    if (!slots.member_name) return ask('Quem da diretoria entra (ou sai) do resumo das 8h? Me diz o nome.');
    const r = await resolve(deps.db, [slots.member_name], 'member');
    if (r.ask) return ask(r.ask);
    p = { action: 'adm_briefing_recipient', profile_id: r.ids[0], enabled: slots.active !== false };
  } else if (a === 'comunicado_enviar') {
    if (!slots.send_body) return ask('Consigo sim: disparo o comunicado direto no WhatsApp pessoal de cada sócio, na hora que você quiser (agora ou num horário, como às 8h00). Me passa o texto exato e o horário do disparo?');
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
    const sendAt = slots.start ? `${slots.date ?? hoje}T${slots.start.slice(0, 5)}:00-03:00` : null;
    p = { action: 'adm_broadcast_send', body: slots.send_body, send_at: sendAt };
  } else if (a === 'formulario_criar') {
    if (!slots.form_title) return ask('Qual o título do novo formulário?');
    if (!slots.form_questions?.length) return ask('Quais são as perguntas? Para as de escolha, me diga as alternativas (uma por pergunta); para as de resposta escrita, só o texto da pergunta.');
    p = { action: 'adm_form_create', title: slots.form_title, description: slots.description ?? null, questions: slots.form_questions,
      secret: slots.form_secret === true, multiple: slots.form_multiple === true, expires_on: slots.due_date ?? null };
  } else if (a === 'formulario_status') {
    if (typeof slots.active !== 'boolean') return ask('É para encerrar ou reabrir o formulário?');
    p = { action: 'adm_form_toggle', form_ref: slots.form_ref ?? null, active: slots.active, expires_on: slots.due_date ?? null };
  } else if (a === 'formulario_cobrar') {
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
    const sendAt = slots.start ? `${slots.date ?? hoje}T${slots.start.slice(0, 5)}:00-03:00` : null;
    p = { action: 'adm_form_nudge', form_ref: slots.form_ref ?? null, body: slots.send_body?.replace(/https?:\/\/www\.stcplay\.com\.br/gi, 'https://stcplay.com.br') ?? null, send_at: sendAt };
  } else if (a === 'aluno_criar') {
    if (!slots.student_name) return ask('Claro, cadastro sim. Qual o nome do aluno e o plano: mensalista, Mensalista Kids (criança, metade do valor) ou Day Card?');
    if (!slots.student_plan) return ask(`${slots.student_name} vai ser mensalista, Mensalista Kids (criança, metade do valor) ou Day Card?`);
    p = { action: 'adm_student_create', name: slots.student_name, plan: slots.student_plan === 'day_card' ? 'Day Card' : 'Card Mensal',
      card_tier: slots.student_plan === 'kids' ? 'kids' : 'regular', phone: slots.phone ?? null, paid: slots.paid === true,
      amount_cents: toCents(slots.amount), paid_on: slots.paid_on ?? null };
  } else if (a === 'dependente_criar') {
    if (!slots.member_name) return ask('Claro, posso cadastrar o dependente. De qual sócio ele(a) é dependente?');
    if (!slots.dependent_name) return ask(`Posso cadastrar sim. Me passa o nome completo do dependente e o telefone, se tiver (o telefone é opcional; CPF não é necessário no cadastro).`);
    if (!slots.relationship) return ask(`Qual o parentesco de ${slots.dependent_name} com ${slots.member_name}: esposa, esposo, filho, filha ou outro?`);
    const r = await resolve(deps.db, [slots.member_name], 'member');
    if (r.ask) return ask(r.ask);
    p = { action: 'adm_dependent_create', profile_id: r.ids[0], dependent_name: slots.dependent_name, relationship: slots.relationship, phone: slots.phone ?? null };
  } else if (a === 'followup_criar') {
    if (!slots.date) return ask('Para qual dia? (e a hora, se quiser; senão uso 09h)');
    if (!slots.note && !slots.send_body) return ask('O que é para lembrar nesse retorno?');
    p = { action: 'adm_followup_create', member_name: slots.member_name ?? null, date: slots.date, start: slots.start ?? null, note: slots.note ?? null, send_body: slots.send_body ?? null };
  } else if (a === 'followup_concluir') {
    p = { action: 'adm_followup_done', member_name: slots.member_name ?? null, date: slots.date ?? null, active: slots.active ?? null };
  } else if (a === 'quadra_bloquear') {
    if (!slots.court_label) return ask('Qual quadra?');
    if (!slots.date || !slots.start) return ask('Qual o dia e a hora de início do bloqueio?');
    if (!slots.duration) return ask('Por quanto tempo (em minutos ou horas)?');
    p = { action: 'adm_court_block', court_label: slots.court_label, date: slots.date, start: slots.start, duration: slots.duration, reason: slots.reason ?? null };
  } else if (a === 'preferencia') {
    if (!slots.pref) return ask('O que você quer ajustar: resumo da manhã (ligar/desligar), estilo do resumo (curto ou completo), alertas, aviso de caixa baixo, dias de atraso para cobrança vencida ou conta padrão?');
    const cents = toCents(slots.amount);
    p = { action: 'adm_pref_set', pref: slots.pref, active: slots.active ?? null, value: slots.pref_value ?? null, amount_cents: cents, account_name: slots.account_name ?? null };
  } else if (a === 'acesso_recusar') {
    p = { action: 'adm_access_reject', name: slots.member_name ?? null, reason: slots.reason ?? null };
  } else if (a === 'acesso_aprovar' || a === 'socio_criar') {
    if (!deps.provision) return ask('Não consigo cadastrar sócio por aqui agora. Use o painel (Acessos).', false);
    if (a === 'socio_criar') {
      if (!slots.member_name) return ask('Qual o nome completo do novo sócio?');
      if (!slots.phone) return ask('Qual o telefone dele, com DDD?');
    }
    const cents = toCents(slots.amount);
    if (!cents) return ask('Qual o valor da mensalidade dele? Preciso também do comprovante de pagamento do mês: mande a imagem ou o PDF aqui.');
    p = { action: a === 'socio_criar' ? 'fin_member_create' : 'fin_access_approve', name: slots.member_name ?? null, phone: slots.phone ?? null,
      email: slots.email ?? null, amount_cents: cents, account_name: slots.account_name ?? null };
  } else {
    return ask('O que você quer fazer: publicar ou tirar um aviso, pausar/reativar aluno, inativar/reativar sócio, reenviar avisos de assinatura, cancelar uma reserva, aprovar ou recusar pedido de acesso ou cadastrar um sócio novo?');
  }
  const rpc = a === 'resenha_grupo' ? 'conv_svc_ai_admin_group_post_propose'
    : a === 'memoria_esquecer' ? 'conv_svc_ai_admin_memory_forget_propose'
    : a === 'resumo_destinatario' ? 'conv_svc_ai_admin_briefing_propose'
    : a === 'comunicado_enviar' ? 'conv_svc_ai_admin_broadcast_propose'
    : a === 'formulario_criar' || a === 'formulario_status' || a === 'formulario_cobrar' ? 'conv_svc_ai_admin_forms_propose'
    : a === 'mensagem_enviar' ? 'conv_svc_ai_admin_message_propose'
    : a === 'dependente_criar' ? 'conv_svc_ai_admin_dependent_propose'
    : a === 'aluno_criar' ? 'conv_svc_ai_admin_student_propose'
    : a === 'acesso_aprovar' || a === 'acesso_recusar' || a === 'socio_criar' ? 'conv_svc_ai_admin_access_propose'
    : a === 'followup_criar' || a === 'followup_concluir' || a === 'quadra_bloquear' || a === 'preferencia' ? 'conv_svc_ai_admin_wave8_propose' : 'conv_svc_ai_admin_adm_propose';
  const res = (await deps.db(rpc, { p_session: session, p })).data as
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

/** Renovar o Card Mensal de um aluno: o servidor acha o aluno, junta o comprovante lido e monta o resumo; grava só no "sim". */
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
