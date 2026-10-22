// Ações administrativas (N1) do João: para cada uma, o que perguntar enquanto falta dado e o pedido montado
// para a função do banco que valida e devolve o resumo. A função de proposta mora junto da ação: um lugar só.

import type { DecideInput } from './decide.ts';
import { toCents } from './adminMessages.ts';
import { memberId as member } from './adminReadRpc.ts';
import type { AdmAction } from './turnTypes.ts';

export type Step = { ask: string; awaiting?: boolean } | { p: Record<string, unknown> };
type Builder = { rpc: string; build: (i: DecideInput) => Step | Promise<Step> };

const ask = (text: string, awaiting = true): Step => ({ ask: text, awaiting });

/** Envio agendado no fuso do clube: sem hora, vai agora (null). */
function sendAt(date: string | null | undefined, start: string | null | undefined): string | null {
  if (!start) return null;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
  return `${date ?? hoje}T${start.slice(0, 5)}:00-03:00`;
}

const ADM = 'conv_svc_ai_admin_adm_propose';
const WAVE8 = 'conv_svc_ai_admin_wave8_propose';
const FORMS = 'conv_svc_ai_admin_forms_propose';
const ACCESS = 'conv_svc_ai_admin_access_propose';
const PLAN_QUESTION = 'mensalista, Mensalista Kids (criança, metade do valor) ou Day Card';

async function memberCreate(i: DecideInput, novo: boolean): Promise<Step> {
  const { slots } = i;
  if (!i.deps.provision) return ask('Não consigo cadastrar sócio por aqui agora. Use o painel (Acessos).', false);
  if (novo && !slots.member_name) return ask('Qual o nome completo do novo sócio?');
  if (novo && !slots.phone) return ask('Qual o telefone dele, com DDD?');
  const cents = toCents(slots.amount);
  if (!cents) return ask('Qual o valor da mensalidade dele? Preciso também do comprovante de pagamento do mês: mande a imagem ou o PDF aqui.');
  return { p: { action: novo ? 'fin_member_create' : 'fin_access_approve', name: slots.member_name ?? null, phone: slots.phone ?? null,
    email: slots.email ?? null, amount_cents: cents, first_amount_cents: toCents(slots.first_amount), account_name: slots.account_name ?? null } };
}

export const ADM_BUILDERS: Record<Exclude<AdmAction, 'aniversario'>, Builder> = {
  aviso: { rpc: ADM, build: ({ slots }) => {
    if (!slots.ann_title) return ask('Qual o título do aviso?');
    if (!slots.ann_message) return ask('E o texto do aviso?');
    return { p: { action: 'adm_announcement_create', title: slots.ann_title, message: slots.ann_message, expires_on: slots.due_date ?? null } };
  } },
  aviso_desativar: { rpc: ADM, build: ({ slots }) => slots.ann_title
    ? { p: { action: 'adm_announcement_deactivate', title: slots.ann_title } } : ask('Qual aviso tirar do ar? Me diga o título.') },
  aluno_status: { rpc: ADM, build: ({ slots }) => {
    const nome = slots.student_names?.[0];
    if (!nome) return ask('Qual aluno?');
    if (typeof slots.active !== 'boolean') return ask('É para pausar ou reativar?');
    return { p: { action: 'adm_student_status', student_name: nome, status: slots.active ? 'active' : 'paused' } };
  } },
  socio_status: { rpc: ADM, build: ({ slots }) => {
    if (!slots.member_name) return ask('Qual sócio?');
    if (typeof slots.active !== 'boolean') return ask('É para inativar ou reativar?');
    return { p: { action: 'adm_member_status', member_name: slots.member_name, active: slots.active } };
  } },
  assinatura_reenviar: { rpc: ADM, build: ({ slots }) => ({ p: { action: 'adm_signature_resend', title: slots.doc_title ?? '' } }) },
  reserva_cancelar: { rpc: ADM, build: ({ slots }) => (!slots.date || !slots.start)
    ? ask('Qual o dia e o horário de início da reserva?')
    : { p: { action: 'adm_reservation_cancel', date: slots.date, start: slots.start, court_label: slots.court_label ?? null, by_name: slots.by_name ?? null, reason: slots.reason ?? null } } },
  mensagem_enviar: { rpc: 'conv_svc_ai_admin_message_propose', build: async (i) => {
    const { slots } = i;
    if (!slots.member_name) return ask('Para qual sócio eu mando a mensagem?');
    if (!slots.send_body) return ask(`O que eu digo para ${slots.member_name}? Me passe o recado (ou o que quer que eu pergunte).`);
    const m = await member(i, slots.member_name);
    return 'ask' in m ? ask(m.ask) : { p: { action: 'adm_message_send', profile_id: m.id, body: slots.send_body } };
  } },
  resenha_grupo: { rpc: 'conv_svc_ai_admin_group_post_propose', build: async (i) => {
    const { slots } = i;
    if (!slots.send_body) return ask('Bora! Sobre quem é a resenha e qual a pegada? Se quiser, eu escolho a vítima. 😂');
    if (!slots.member_name) return { p: { body: slots.send_body, profile_id: null } };
    const m = await member(i, slots.member_name);
    return 'ask' in m ? ask(m.ask) : { p: { body: slots.send_body, profile_id: m.id } };
  } },
  memoria_esquecer: { rpc: 'conv_svc_ai_admin_memory_forget_propose', build: ({ slots }) => slots.member_name
    ? { p: { action: 'adm_memory_forget', subject: slots.member_name, text: slots.note ?? null } }
    : ask('Sobre quem é a memória que devo esquecer? Se quiser só uma delas, me diga um trecho do que ela diz.') },
  resumo_destinatario: { rpc: 'conv_svc_ai_admin_briefing_propose', build: async (i) => {
    if (!i.slots.member_name) return ask('Quem da diretoria entra (ou sai) do resumo das 8h? Me diz o nome.');
    const m = await member(i, i.slots.member_name);
    return 'ask' in m ? ask(m.ask) : { p: { action: 'adm_briefing_recipient', profile_id: m.id, enabled: i.slots.active !== false } };
  } },
  comunicado_enviar: { rpc: 'conv_svc_ai_admin_broadcast_propose', build: ({ slots }) => slots.send_body
    ? { p: { action: 'adm_broadcast_send', body: slots.send_body, send_at: sendAt(slots.date, slots.start) } }
    : ask('Consigo sim: disparo o comunicado direto no WhatsApp pessoal de cada sócio, na hora que você quiser (agora ou num horário, como às 8h00). Me passa o texto exato e o horário do disparo?') },
  formulario_criar: { rpc: FORMS, build: ({ slots }) => {
    if (!slots.form_title) return ask('Qual o título do novo formulário?');
    if (!slots.form_questions?.length) return ask('Quais são as perguntas? Para as de escolha, me diga as alternativas (uma por pergunta); para as de resposta escrita, só o texto da pergunta.');
    return { p: { action: 'adm_form_create', title: slots.form_title, description: slots.description ?? null, questions: slots.form_questions,
      secret: slots.form_secret === true, multiple: slots.form_multiple === true, expires_on: slots.due_date ?? null } };
  } },
  formulario_status: { rpc: FORMS, build: ({ slots }) => typeof slots.active === 'boolean'
    ? { p: { action: 'adm_form_toggle', form_ref: slots.form_ref ?? null, active: slots.active, expires_on: slots.due_date ?? null } }
    : ask('É para encerrar ou reabrir o formulário?') },
  formulario_cobrar: { rpc: FORMS, build: ({ slots }) => ({ p: { action: 'adm_form_nudge', form_ref: slots.form_ref ?? null,
    body: slots.send_body?.replace(/https?:\/\/www\.stcplay\.com\.br/gi, 'https://stcplay.com.br') ?? null, send_at: sendAt(slots.date, slots.start) } }) },
  aluno_criar: { rpc: 'conv_svc_ai_admin_student_propose', build: ({ slots }) => {
    if (!slots.student_name) return ask(`Claro, cadastro sim. Qual o nome do aluno e o plano: ${PLAN_QUESTION}?`);
    if (!slots.student_plan) return ask(`${slots.student_name} vai ser ${PLAN_QUESTION}?`);
    return { p: { action: 'adm_student_create', name: slots.student_name, plan: slots.student_plan === 'day_card' ? 'Day Card' : 'Card Mensal',
      card_tier: slots.student_plan === 'kids' ? 'kids' : 'regular', phone: slots.phone ?? null, paid: slots.paid === true,
      amount_cents: toCents(slots.amount), paid_on: slots.paid_on ?? null } };
  } },
  dependente_criar: { rpc: 'conv_svc_ai_admin_dependent_propose', build: async (i) => {
    const { slots } = i;
    if (!slots.member_name) return ask('Claro, posso cadastrar o dependente. De qual sócio?');
    if (!slots.dependent_name) return ask('Posso cadastrar sim. Me passa o nome completo do dependente e o telefone, se tiver (o telefone é opcional; CPF não é necessário no cadastro).');
    if (!slots.relationship) return ask(`Qual o parentesco de ${slots.dependent_name} com ${slots.member_name}: esposa, esposo, filho, filha ou outro?`);
    const m = await member(i, slots.member_name);
    return 'ask' in m ? ask(m.ask)
      : { p: { action: 'adm_dependent_create', profile_id: m.id, dependent_name: slots.dependent_name, relationship: slots.relationship, phone: slots.phone ?? null } };
  } },
  followup_criar: { rpc: WAVE8, build: ({ slots }) => {
    if (!slots.date) return ask('Para qual dia? (e a hora, se quiser; senão uso 09h)');
    if (!slots.note && !slots.send_body) return ask('O que é para lembrar nesse retorno?');
    return { p: { action: 'adm_followup_create', member_name: slots.member_name ?? null, date: slots.date, start: slots.start ?? null, note: slots.note ?? null, send_body: slots.send_body ?? null } };
  } },
  followup_concluir: { rpc: WAVE8, build: ({ slots }) => ({ p: { action: 'adm_followup_done', member_name: slots.member_name ?? null, date: slots.date ?? null, active: slots.active ?? null } }) },
  quadra_bloquear: { rpc: WAVE8, build: ({ slots }) => {
    if (!slots.court_label) return ask('Qual quadra?');
    if (!slots.date || !slots.start) return ask('Qual o dia e a hora de início do bloqueio?');
    if (!slots.duration) return ask('Por quanto tempo (em minutos ou horas)?');
    return { p: { action: 'adm_court_block', court_label: slots.court_label, date: slots.date, start: slots.start, duration: slots.duration, reason: slots.reason ?? null } };
  } },
  preferencia: { rpc: WAVE8, build: ({ slots }) => slots.pref
    ? { p: { action: 'adm_pref_set', pref: slots.pref, active: slots.active ?? null, value: slots.pref_value ?? null, amount_cents: toCents(slots.amount), account_name: slots.account_name ?? null } }
    : ask('O que você quer ajustar: resumo da manhã (ligar/desligar), estilo do resumo (curto ou completo), alertas, aviso de caixa baixo, dias de atraso para cobrança vencida ou conta padrão?') },
  acesso_recusar: { rpc: ACCESS, build: ({ slots }) => ({ p: { action: 'adm_access_reject', name: slots.member_name ?? null, reason: slots.reason ?? null } }) },
  acesso_aprovar: { rpc: ACCESS, build: (i) => memberCreate(i, false) },
  socio_criar: { rpc: ACCESS, build: (i) => memberCreate(i, true) },
};
