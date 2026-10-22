// Textos das ações administrativas (cadastro, avisos, mensagens, formulários, agenda, preferências).
// Cada proposta é só o corpo; o "Confirma?" é posto por adminProposalMessage, igual para todas.

import type { Ctx } from './promptTypes.ts';
import type { AdminAction } from './adminMessages.ts';
import type { Render } from './adminMessagesFin.ts';
import { centsBR, dateBR, plural, sendWhen, skippedNote, slotBR, whenBR } from './adminText.ts';

type AdmTextAction = Extract<AdminAction, `adm_${string}`>;

function prefText(s: Ctx, done: boolean): string {
  const on = (v: unknown) => (v ? 'ligado' : 'desligado');
  switch (s.pref) {
    case 'resumo': return done ? `Pronto: resumo da manhã ${on(s.active)}.` : `Vou ${s.active ? 'ligar' : 'desligar'} o seu resumo da manhã.`;
    case 'alertas': return done ? `Pronto: alertas ${on(s.active)}.` : `Vou ${s.active ? 'ligar' : 'desligar'} os seus alertas (cobrança vencida, comprovante parado, conta vencida e caixa baixo).`;
    case 'estilo': return done ? `Pronto: resumo da manhã agora é ${s.value}.` : `Vou deixar o seu resumo da manhã ${s.value}.`;
    case 'saldo_minimo': return s.cents == null ? (done ? 'Pronto: sem aviso de caixa baixo.' : 'Vou tirar o aviso de caixa baixo.')
      : (done ? `Pronto: aviso quando o caixa ficar abaixo de ${centsBR(s.cents)}.` : `Vou te avisar quando o caixa ficar abaixo de ${centsBR(s.cents)}.`);
    case 'dias_atraso': return done ? `Pronto: aviso de cobrança vencida a partir de ${s.value} dias.` : `Vou te avisar de cobrança vencida a partir de ${s.value} dias de atraso.`;
    default: return s.account_name ? (done ? `Pronto: conta padrão agora é ${s.account_name}.` : `Vou usar ${s.account_name} como a sua conta padrão quando você não disser a conta.`)
      : (done ? 'Pronto: sem conta padrão.' : 'Vou tirar a sua conta padrão.');
  }
}

const QUESTION_TEXT: Record<string, string> = { single_choice: 'escolha única', multiple_choice: 'múltipla escolha', open_text: 'resposta escrita' };
/** Lista de nomes que não vira parede de texto: até 40 e "e mais N". */
const nameList = (v: unknown) => {
  const nomes = (Array.isArray(v) ? v : []) as string[];
  return nomes.length > 40 ? `${nomes.slice(0, 40).join(', ')} e mais ${nomes.length - 40}` : nomes.join(', ');
};
const sociosBR = (n: unknown) => plural(n, 'sócio', 'sócios');
/** Fila de envio anda a cada 5 minutos: o administrador sabe quando esperar e que a resposta é atendida. */
const QUEUE_NOTE = 'Sai no horário combinado (a fila anda a cada 5 minutos, então pode chegar até 5 minutos depois). Quando alguém responder, eu atendo.';

function formCreateProposal(s: Ctx): string {
  const qs = (Array.isArray(s.questions) ? s.questions : []) as { title: string; type: string; required: boolean; options: string[] }[];
  const linhas = qs.map((q, i) => `${i + 1}. ${q.title} (${QUESTION_TEXT[q.type] ?? q.type}${q.required ? '' : ', opcional'})${q.options.length ? `: ${q.options.join(' / ')}` : ''}`).join('\n');
  const modo = [s.secret ? 'votação secreta (ninguém vê quem votou em quê)' : 'respostas identificadas pelo nome do sócio',
    s.multiple ? 'cada sócio pode responder mais de uma vez' : 'uma resposta por sócio',
    s.expires_at ? `aberto até ${dateBR(s.expires_at)}` : 'sem prazo'].join(', ');
  return `Vou criar o formulário «${s.title}»${s.description ? ` ("${s.description}")` : ''}: ${modo}.\n${linhas}\nFica aberto agora, no link ${s.link}.`;
}

function formNudgeProposal(s: Ctx): string {
  const fora = [Number(s.already) > 0 ? `${plural(s.already, 'já recebeu', 'já receberam')} lembrete nas últimas 24 horas` : '', skippedNote(s.skipped)].filter(Boolean).join('; ');
  return `Vou lembrar por WhatsApp ${sociosBR(s.count)} que ainda não responderam o «${s.form_title}», ${sendWhen(s.send_at)}: ${nameList(s.names)}${fora ? ` (${fora})` : ''}.\nTexto:\n«${s.body}»`;
}

const studentPlanLabel = (s: Ctx) => s.plan === 'Day Card' ? 'aluno de Day Card' : s.card_tier === 'kids' ? 'Mensalista Kids' : 'mensalista';
function studentCreateProposal(s: Ctx): string {
  const plano = s.plan === 'Day Card' ? 'aluno de Day Card (aula avulsa)' : `${studentPlanLabel(s)} (${centsBR(s.price_cents)}/mês)`;
  if (!s.paid) return `Vou cadastrar ${s.name} como ${plano}${s.phone ? `, telefone ${s.phone}` : ''}. O Card fica inativo até o pagamento.`;
  const r = (s.receipt ?? null) as Ctx | null;
  const sobra = r ? Number(r.remaining_cents) - Number(s.amount_cents) : 0;
  const comprovante = r ? `, usando o comprovante de ${centsBR(r.amount_cents)}${sobra > 0 ? ` (sobram ${centsBR(sobra)} para outro aluno)` : ''}` : ', sem comprovante';
  return `Vou cadastrar ${s.name} como ${plano} e registrar o pagamento de ${centsBR(s.amount_cents)} em ${dateBR(s.paid_on)}${comprovante}. Card válido até ${dateBR(s.new_valid_until)}.`;
}

function memoryForgetProposal(s: Ctx): string {
  const itens = (Array.isArray(s.items) ? s.items : []) as { subject_name: string; content: string }[];
  const quais = itens.length === 1 ? 'esta memória' : `estas ${itens.length} memórias`;
  return `Vou esquecer ${quais} (elas saem das minhas conversas, o histórico fica guardado):\n${itens.map((i) => `- ${i.subject_name}: ${i.content}`).join('\n')}`;
}

function followupCreateProposal(s: Ctx): string {
  if (s.self) return `Vou te lembrar em ${whenBR(s.due_at)}: «${s.note ?? s.send_body}».`;
  const envio = s.send_body ? ` Nesse horário mando para ${s.member_name}: «${s.send_body}».` : '';
  return `Vou criar um retorno com ${s.member_name} para ${whenBR(s.due_at)}${s.note ? `: ${s.note}` : ''}.${envio}`;
}

function formToggleProposal(s: Ctx): string {
  const detalhe = s.active ? (s.expires_at ? ` com prazo até ${dateBR(s.expires_at)}` : '') : ' (ninguém mais consegue responder)';
  return `Vou ${s.active ? 'reabrir' : 'encerrar'} o formulário «${s.title}»${detalhe}.`;
}

export const ADM_PROPOSALS: Record<AdmTextAction, Render> = {
  adm_pref_set: (s) => prefText(s, false),
  adm_group_post: (s) => `Mando isto no grupo${s.target_name ? ` marcando ${s.target_name}` : ''}:\n«${String(s.body).replace(/^@\d+\s+/, '')}»`,
  adm_message_send: (s) => `Vou chamar ${s.member_name} no WhatsApp (${s.phone}) e mandar esta mensagem:\n«${s.body}»`,
  adm_memory_forget: memoryForgetProposal,
  adm_briefing_recipient: (s) => `Vou ${s.enabled ? 'incluir' : 'tirar'} ${s.name} ${s.enabled ? 'no' : 'do'} resumo diário das 8h. A lista fica: ${s.list_after}.`,
  adm_broadcast_send: (s) => {
    const fora = skippedNote(s.skipped);
    return `Vou mandar este comunicado no WhatsApp pessoal de ${sociosBR(s.count)}, ${sendWhen(s.send_at)}${fora ? ` (${fora})` : ''}:\n«${s.body}»`;
  },
  adm_form_create: formCreateProposal,
  adm_form_toggle: formToggleProposal,
  adm_form_nudge: formNudgeProposal,
  adm_student_create: studentCreateProposal,
  adm_dependent_create: (s) => `Vou cadastrar ${s.dependent_name} como ${s.relationship} de ${s.member_name} (dependente, sem cobrança${s.phone ? `, telefone ${s.phone}` : ''}).`,
  adm_followup_create: followupCreateProposal,
  adm_followup_done: (s) => `Vou ${s.new_status === 'canceled' ? 'cancelar' : 'dar por concluído'} o retorno${s.member_name ? ` com ${s.member_name}` : ''} de ${whenBR(s.due_at)}${s.note ? ` («${s.note}»)` : ''}.`,
  adm_court_block: (s) => `Vou bloquear a ${s.court} em ${slotBR(s.date, s.start, s.end)}${s.reason ? ` (${s.reason})` : ''}. Ninguém consegue reservar nesse horário.`,
  adm_access_reject: (s) => `Vou recusar o pedido de acesso de ${s.name}${s.reason ? `. Motivo: ${s.reason}` : ''}.`,
  adm_announcement_create: (s) => `Vou publicar este aviso para todos os sócios no app:\n«${s.title}»\n${s.message}\n${s.expires_on ? `Fica no ar até ${dateBR(s.expires_on)}.` : 'Sem data para sair.'}`,
  adm_announcement_deactivate: (s) => `Vou tirar do ar o aviso «${s.title}».`,
  adm_student_status: (s) => `Vou ${s.status === 'paused' ? 'pausar' : 'reativar'} o aluno ${s.student_name}.`,
  adm_member_status: (s) => `Vou ${s.active ? 'reativar' : 'inativar'} o sócio ${s.member_name}.${s.active ? '' : ' O cadastro sai das listas e das cobranças automáticas.'}`,
  adm_signature_resend: (s) => `Vou reenviar ${plural(s.failed_count, 'aviso que falhou', 'avisos que falharam')} do documento «${s.title}».`,
  adm_reservation_cancel: (s) => `Vou cancelar a reserva ${s.court}, ${slotBR(s.date, s.start, s.end)} (${s.type}${s.by ? `, de ${s.by}` : ''})${s.reason ? `. Motivo: ${s.reason}` : ''}.`,
};

export const ADM_SUCCESS: Record<AdmTextAction, Render> = {
  adm_pref_set: (s) => prefText(s, true),
  adm_memory_forget: (s) => `Pronto: esqueci ${plural(s.forgotten, 'memória', 'memórias')} sobre ${s.subject}.`,
  adm_briefing_recipient: (s) => `Pronto: ${s.name} ${s.enabled ? 'passa a receber' : 'não recebe mais'} o resumo das 8h. Lista atual: ${s.list_after}.`,
  adm_form_create: (s) => `Pronto: formulário «${s.title}» criado e já aberto para os sócios. Link para compartilhar: ${s.link}`,
  adm_form_toggle: (s) => `Pronto: formulário «${s.title}» ${s.active ? 'reaberto' : 'encerrado'}.`,
  adm_form_nudge: (s) => `Pronto: lembrete do «${s.form_title}» na fila para ${sociosBR(s.queued)}. ${QUEUE_NOTE}`,
  adm_broadcast_send: (s) => `Pronto: o comunicado está agendado para ${sociosBR(s.queued)}. ${QUEUE_NOTE}`,
  adm_group_post: () => 'Pronto: a resenha sai no grupo em instantes (até 5 minutos). Quando a turma responder, eu entro na brincadeira. 😂',
  adm_message_send: (s) => `Pronto: a mensagem para ${s.member_name} está na fila e sai em instantes. Se responder, eu atendo.`,
  adm_student_create: (s) => `Pronto: cadastro de ${s.name} feito como ${studentPlanLabel(s)}${s.paid ? `, pagamento de ${centsBR(s.amount_cents)} registrado (Card válido até ${dateBR(s.new_valid_until)})` : ''}.`,
  adm_dependent_create: (s) => `Pronto: cadastro de ${s.dependent_name} feito como ${s.relationship} de ${s.member_name}.`,
  adm_followup_create: (s) => s.self ? `Pronto: te lembro em ${whenBR(s.due_at)}.` : `Pronto: retorno com ${s.member_name} criado para ${whenBR(s.due_at)}.`,
  adm_followup_done: (s) => `Pronto: retorno ${s.new_status === 'canceled' ? 'cancelado' : 'concluído'}.`,
  adm_court_block: (s) => `Pronto: ${s.court} bloqueada em ${slotBR(s.date, s.start, s.end)}. Para liberar, é só pedir para cancelar essa reserva de bloqueio.`,
  adm_access_reject: (s) => `Pronto: pedido de acesso de ${s.name} recusado.`,
  adm_announcement_create: (s) => `Pronto: aviso «${s.title}» publicado.`,
  adm_announcement_deactivate: (s) => `Pronto: aviso «${s.title}» tirado do ar.`,
  adm_student_status: (s) => `Pronto: aluno ${s.student_name} ${s.status === 'paused' ? 'pausado' : 'reativado'}.`,
  adm_member_status: (s) => `Pronto: sócio ${s.member_name} ${s.active ? 'reativado' : 'inativado'}.`,
  adm_signature_resend: (s) => `Pronto: ${plural((s.result as Ctx | undefined)?.resent, 'aviso', 'avisos')} de «${s.title}» de volta na fila.`,
  adm_reservation_cancel: (s) => `Pronto: reserva ${s.court}, ${dateBR(s.date)} às ${s.start}, cancelada.`,
};
