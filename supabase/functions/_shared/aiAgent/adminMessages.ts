// Textos do assessor administrativo: proposta e confirmação de cada ação, escritos pelo servidor.

import type { Ctx } from './promptTypes.ts';
import { studentCardProposalMessage, studentCardSuccessMessage } from './studentCard.ts';

/* ------------------------------- Assessor administrativo (financeiro) ------------------------------- */

export const isAdminProposalAction = (a: unknown) => String(a ?? '').startsWith('fin_') || String(a ?? '').startsWith('adm_') || a === 'student_card_renew';

export type AdminAction = 'fin_pendency_create' | 'fin_pendency_collection' | 'fin_pendency_send' | 'fin_payment' | 'student_card_renew'
  | 'fin_charge_cancel' | 'fin_charge_adjust' | 'fin_payment_reverse' | 'fin_receipt_reject' | 'fin_entry_create' | 'fin_receipt_approve' | 'fin_charges_generate'
  | 'adm_announcement_create' | 'adm_announcement_deactivate' | 'adm_student_status' | 'adm_member_status' | 'adm_signature_resend' | 'adm_reservation_cancel'
  | 'fin_member_create' | 'fin_access_approve' | 'adm_access_reject'
  | 'adm_followup_create' | 'adm_followup_done' | 'adm_court_block' | 'adm_pref_set' | 'adm_dependent_create' | 'adm_student_create' | 'adm_message_send' | 'adm_broadcast_send' | 'adm_briefing_recipient' | 'adm_memory_forget'
  | 'adm_form_create' | 'adm_form_toggle' | 'adm_form_nudge' | 'adm_group_post';

const centsBR = (v: unknown) => `R$ ${(Number(v ?? 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const dateBR = (v: unknown) => String(v ?? '').slice(0, 10).split('-').reverse().join('/');
const METHOD_TEXT: Record<string, string> = { pix: 'PIX', transfer: 'transferência', cash: 'dinheiro', card: 'cartão', other: 'outro meio' };

export function toCents(reais: number | null | undefined): number | null {
  if (typeof reais !== 'number' || !Number.isFinite(reais) || reais <= 0) return null;
  return Math.round(reais * 100);
}

export const hhmm = (v: unknown) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(String(v)));
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

function formCreateProposal(s: Ctx): string {
  const qs = (Array.isArray(s.questions) ? s.questions : []) as { title: string; type: string; required: boolean; options: string[] }[];
  const linhas = qs.map((q, i) => `${i + 1}. ${q.title} (${QUESTION_TEXT[q.type] ?? q.type}${q.required ? '' : ', opcional'})${q.options.length ? `: ${q.options.join(' / ')}` : ''}`).join('\n');
  const modo = [s.secret ? 'votação secreta (ninguém vê quem votou em quê)' : 'respostas identificadas pelo nome do sócio',
    s.multiple ? 'cada sócio pode responder mais de uma vez' : 'uma resposta por sócio',
    s.expires_at ? `aberto até ${dateBR(s.expires_at)}` : 'sem prazo'].join(', ');
  return `Vou criar o formulário «${s.title}»${s.description ? ` ("${s.description}")` : ''}: ${modo}.\n${linhas}\nFica aberto agora, no link ${s.link}. Confirma?`;
}

function formNudgeProposal(s: Ctx): string {
  const at = new Date(String(s.send_at));
  const quando = at.getTime() - Date.now() < 90_000 ? 'agora' : `em ${hhmm(s.send_at).replace(', ', ' às ')}`;
  const nomes = (Array.isArray(s.names) ? s.names : []) as string[];
  const lista = nomes.length > 40 ? `${nomes.slice(0, 40).join(', ')} e mais ${nomes.length - 40}` : nomes.join(', ');
  const fora = [Number(s.already) > 0 ? `${s.already} já receberam lembrete nas últimas 24 horas` : '', Number(s.skipped) > 0 ? `${s.skipped} ficam de fora por falta de telefone válido ou por terem pedido para não receber` : ''].filter(Boolean).join('; ');
  return `Vou lembrar por WhatsApp ${s.count} ${Number(s.count) === 1 ? 'sócio' : 'sócios'} que ainda não responderam o «${s.form_title}», ${quando}: ${lista}${fora ? ` (${fora})` : ''}.\nTexto:\n«${s.body}»\nConfirma?`;
}

const studentPlanLabel = (s: Ctx) => s.plan === 'Day Card' ? 'aluno de Day Card' : s.card_tier === 'kids' ? 'Mensalista Kids' : 'mensalista';
function studentCreateProposal(s: Ctx): string {
  const plano = s.plan === 'Day Card' ? 'aluno de Day Card (aula avulsa)' : `${studentPlanLabel(s)} (${centsBR(s.price_cents)}/mês)`;
  if (!s.paid) return `Vou cadastrar ${s.name} como ${plano}${s.phone ? `, telefone ${s.phone}` : ''}. O Card fica inativo até o pagamento. Confirma?`;
  const r = (s.receipt ?? null) as Ctx | null;
  const comprovante = r ? `, usando o comprovante de ${centsBR(r.amount_cents)}${Number(r.remaining_cents) > Number(s.amount_cents) ? ` (sobram ${centsBR(Number(r.remaining_cents) - Number(s.amount_cents))} para outro aluno)` : ''}` : ', sem comprovante';
  return `Vou cadastrar ${s.name} como ${plano} e registrar o pagamento de ${centsBR(s.amount_cents)} em ${dateBR(s.paid_on)}${comprovante}. Card válido até ${dateBR(s.new_valid_until)}. Confirma?`;
}

// O banco só liga o comprovante ao lançamento quando o valor lido bate (conv_private.admin_entry_receipt).
const receiptNote = (s: Ctx, text: string) => (s.receipt_id ? `, ${text}` : '');

export function adminProposalMessage(action: AdminAction, s: Ctx): string {
  if (action === 'student_card_renew') return studentCardProposalMessage(s);
  if (action === 'fin_member_create' || action === 'fin_access_approve') {
    const tel = String(s.phone ?? '').replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
    const mes = `${String(s.month ?? '').slice(5, 7)}/${String(s.month ?? '').slice(0, 4)}`;
    const quem = action === 'fin_access_approve' ? `Vou aprovar o pedido de acesso de ${s.name}` : `Vou cadastrar o sócio ${s.name}`;
    const email = s.email ? `e-mail ${s.email}` : 'e-mail gerado pelo sistema';
    const leitura = s.amount_read ? '' : ' Não consegui ler o valor do comprovante; vale o que você informou.';
    return `${quem} (telefone ${tel}, ${email})${s.reactivate ? ', reativando o cadastro antigo' : ''}, com mensalidade de ${centsBR(s.amount_cents)}. A mensalidade de ${mes} fica paga com o comprovante que você mandou (${centsBR(s.amount_cents)}, pago em ${dateBR(s.paid_on)}, conta ${s.account_name}); ele entra sem pendência e os juros do mês de entrada são dispensados.${leitura} Confirma?`;
  }
  if (action === 'adm_pref_set') return `${prefText(s, false)} Confirma?`;
  if (action === 'adm_group_post') return `Mando isto no grupo${s.target_name ? ` marcando ${s.target_name}` : ''}:\n«${String(s.body).replace(/^@\d+\s+/, '')}»\nManda?`;
  if (action === 'adm_message_send') return `Vou chamar ${s.member_name} no WhatsApp (${s.phone}) e mandar esta mensagem:\n«${s.body}»\nConfirma?`;
  if (action === 'adm_memory_forget') {
    const itens = (Array.isArray(s.items) ? s.items : []) as { subject_name: string; content: string }[];
    return `Vou esquecer ${itens.length === 1 ? 'esta memória' : `estas ${itens.length} memórias`} (elas saem das minhas conversas, o histórico fica guardado):\n${itens.map((i) => `- ${i.subject_name}: ${i.content}`).join('\n')}\nConfirma?`;
  }
  if (action === 'adm_briefing_recipient') return `Vou ${s.enabled ? 'incluir' : 'tirar'} ${s.name} ${s.enabled ? 'no' : 'do'} resumo diário das 8h. A lista fica: ${s.list_after}. Confirma?`;
  if (action === 'adm_broadcast_send') {
    const at = new Date(String(s.send_at));
    const quando = at.getTime() - Date.now() < 90_000 ? 'agora' : `em ${hhmm(s.send_at).replace(', ', ' às ')}`;
    const fora = Number(s.skipped) > 0 ? ` (${s.skipped} ficam de fora por falta de telefone válido ou por terem pedido para não receber)` : '';
    return `Vou mandar este comunicado no WhatsApp pessoal de ${s.count} sócios, ${quando}${fora}:\n«${s.body}»\nConfirma?`;
  }
  if (action === 'adm_form_create') return formCreateProposal(s);
  if (action === 'adm_form_toggle') return `Vou ${s.active ? 'reabrir' : 'encerrar'} o formulário «${s.title}»${s.active ? (s.expires_at ? ` com prazo até ${dateBR(s.expires_at)}` : '') : ' (ninguém mais consegue responder)'}. Confirma?`;
  if (action === 'adm_form_nudge') return formNudgeProposal(s);
  if (action === 'adm_student_create') return studentCreateProposal(s);
  if (action === 'adm_dependent_create') return `Vou cadastrar ${s.dependent_name} como ${s.relationship} de ${s.member_name} (dependente, sem cobrança${s.phone ? `, telefone ${s.phone}` : ''}). Confirma?`;
  if (action === 'adm_followup_create') {
    const quando = hhmm(s.due_at);
    if (s.self) return `Vou te lembrar em ${quando}: «${s.note ?? s.send_body}». Confirma?`;
    return `Vou criar um retorno com ${s.member_name} para ${quando}${s.note ? `: ${s.note}` : ''}.${s.send_body ? ` Nesse horário mando para ele(a): «${s.send_body}».` : ''} Confirma?`;
  }
  if (action === 'adm_followup_done') return `Vou ${s.new_status === 'canceled' ? 'cancelar' : 'dar por concluído'} o retorno${s.member_name ? ` com ${s.member_name}` : ''} de ${hhmm(s.due_at)}${s.note ? ` («${s.note}»)` : ''}. Confirma?`;
  if (action === 'adm_court_block') return `Vou bloquear a ${s.court} em ${dateBR(s.date)}, das ${s.start} às ${s.end}${s.reason ? ` (${s.reason})` : ''}. Ninguém consegue reservar nesse horário. Confirma?`;
  if (action === 'adm_access_reject') return `Vou recusar o pedido de acesso de ${s.name}${s.reason ? `. Motivo: ${s.reason}` : ''}. Confirma?`;
  if (action === 'adm_announcement_create') return `Vou publicar este aviso para todos os sócios no app:\n«${s.title}»\n${s.message}\n${s.expires_on ? `Fica no ar até ${dateBR(s.expires_on)}.` : 'Sem data para sair.'} Confirma?`;
  if (action === 'adm_announcement_deactivate') return `Vou tirar do ar o aviso «${s.title}». Confirma?`;
  if (action === 'adm_student_status') return `Vou ${s.status === 'paused' ? 'pausar' : 'reativar'} o aluno ${s.student_name}. Confirma?`;
  if (action === 'adm_member_status') return `Vou ${s.active ? 'reativar' : 'inativar'} o sócio ${s.member_name}. ${s.active ? '' : 'Ele deixa de aparecer nas listas e nas cobranças automáticas. '}Confirma?`;
  if (action === 'adm_signature_resend') return `Vou reenviar os avisos com falha do documento «${s.title}» (${s.failed_count}). Confirma?`;
  if (action === 'adm_reservation_cancel') return `Vou cancelar a reserva ${s.court}, ${dateBR(s.date)} ${s.start}-${s.end} (${s.type}${s.by ? `, de ${s.by}` : ''})${s.reason ? `. Motivo: ${s.reason}` : ''}. Confirma?`;
  if (action === 'fin_charge_cancel') return `Vou cancelar a pendência de ${s.member_name}: ${s.description} (saldo ${centsBR(s.total_due_cents)}). Motivo: ${s.reason}. Confirma?`;
  if (action === 'fin_charge_adjust') {
    const o = s.adjust_kind === 'discount' ? 'desconto de' : s.adjust_kind === 'increase' ? 'acréscimo de' : 'perdão de juros/multa de';
    return `Vou aplicar ${o} ${centsBR(s.amount_cents)} na pendência de ${s.member_name}: ${s.description} (saldo hoje ${centsBR(s.total_due_cents)}). Motivo: ${s.reason}. Confirma?`;
  }
  if (action === 'fin_payment_reverse') return `Vou estornar o pagamento de ${centsBR(s.amount_cents)} de ${s.member_name} (${s.description}), feito em ${dateBR(s.paid_on)}. Motivo: ${s.reason}. A pendência volta a ficar em aberto. Confirma?`;
  if (action === 'fin_receipt_approve') {
    const itens = (Array.isArray(s.allocations) ? s.allocations as Ctx[] : []).map((a) => `- ${a.description} (venc. ${dateBR(a.due_date)}): ${centsBR(a.amount_cents)}`).join('\n');
    return `Vou aprovar o comprovante de ${s.member_name}, enviado em ${dateBR(s.sent_on)}: ${centsBR(s.amount_cents)}, pago em ${dateBR(s.paid_on)} via ${METHOD_TEXT[String(s.method)] ?? s.method}, conta ${s.account_name}. Baixa nas cobranças, da mais antiga para a mais nova:\n${itens}\nConfirma?`;
  }
  if (action === 'fin_charges_generate') return `Vou gerar as cobranças que faltam dos ${s.plans_count} planos de sócios ativos (não duplica as que já existem; mês sem preço fica de fora). Confirma?`;
  if (action === 'fin_receipt_reject') return `Vou recusar o comprovante de ${s.member_name}, enviado em ${dateBR(s.sent_on)}${s.amount_cents != null ? ` (${centsBR(s.amount_cents)})` : ''}. Motivo: ${s.reason}. Confirma?`;
  if (action === 'fin_entry_create') {
    const tipo = s.entry_kind === 'expense' ? 'despesa' : 'receita';
    const quando = s.entry_status === 'pending' ? `a pagar até ${dateBR(s.due_date)}` : `paga em ${dateBR(s.paid_on)}`;
    return `Vou lançar a ${tipo}: ${s.description}, ${centsBR(s.amount_cents)}, categoria ${s.category_name}, conta ${s.account_name}, ${quando}${receiptNote(s, 'com o comprovante que você mandou anexado')}. Confirma?`;
  }
  if (action === 'fin_pendency_create') {
    const guest = s.guest_name ? ` (convidado ${s.guest_name}${s.guest_date ? ` em ${dateBR(s.guest_date)}` : ''})` : '';
    const envio = s.send_now ? 'Já mando a cobrança no WhatsApp do sócio.' : 'Sem mandar cobrança agora; a régua segue normal.';
    return `Vou lançar para ${s.member_name}: ${s.description}${guest}, ${centsBR(s.amount_cents)}, vencimento ${dateBR(s.due_date)}. ${envio} Confirma?`;
  }
  if (action === 'fin_pendency_send') {
    return `Vou mandar agora a cobrança para ${s.member_name}: ${s.open_count} pendência(s) em aberto, total ${centsBR(s.member_total_due_cents)}. Confirma?`;
  }
  if (action === 'fin_pendency_collection') {
    return `Vou ${s.enabled ? 'retomar' : 'pausar'} a cobrança de ${s.member_name}: ${s.description} (saldo ${centsBR(s.total_due_cents)}). Confirma?`;
  }
  const sobra = Number(s.excess_cents ?? 0) > 0 ? ` Passa do saldo: ${centsBR(s.excess_cents)} viram crédito do sócio.` : '';
  return `Vou dar baixa de ${centsBR(s.amount_cents)} para ${s.member_name}: ${s.description} (saldo ${centsBR(s.total_due_cents)}), pago em ${dateBR(s.paid_on)} via ${METHOD_TEXT[String(s.method)] ?? s.method}, conta ${s.account_name}.${sobra} Confirma?`;
}

export function adminSuccessMessage(action: AdminAction, s: Ctx): string {
  if (action === 'student_card_renew') return studentCardSuccessMessage(s);
  if (action === 'fin_member_create' || action === 'fin_access_approve') return `Pronto: ${s.name} agora é sócio e a mensalidade de ${String(s.month ?? '').slice(5, 7)}/${String(s.month ?? '').slice(0, 4)} ficou paga (${centsBR(s.amount_cents)}), sem pendência.`;
  if (action === 'adm_pref_set') return prefText(s, true);
  if (action === 'adm_memory_forget') return `Pronto: esqueci ${s.forgotten} ${Number(s.forgotten) === 1 ? 'memória' : 'memórias'} sobre ${s.subject}.`;
  if (action === 'adm_briefing_recipient') return `Pronto: ${s.name} ${s.enabled ? 'passa a receber' : 'não recebe mais'} o resumo das 8h. Lista atual: ${s.list_after}.`;
  if (action === 'adm_form_create') return `Pronto: formulário «${s.title}» criado e já aberto para os sócios. Link para compartilhar: ${s.link}`;
  if (action === 'adm_form_toggle') return `Pronto: formulário «${s.title}» ${s.active ? 'reaberto' : 'encerrado'}.`;
  if (action === 'adm_form_nudge') return `Pronto: lembrete do «${s.form_title}» na fila para ${s.queued} ${Number(s.queued) === 1 ? 'sócio' : 'sócios'}. Sai no horário combinado (a fila anda a cada 5 minutos, então pode chegar até 5 minutos depois). Quando alguém responder, eu atendo.`;
  if (action === 'adm_broadcast_send') return `Pronto: o comunicado está agendado para ${s.queued} sócios. Sai no horário combinado (a fila anda a cada 5 minutos, então pode chegar até 5 minutos depois). Quando alguém responder, eu atendo.`;
  if (action === 'adm_group_post') return 'Pronto: a resenha sai no grupo em instantes (até 5 minutos). Quando a turma responder, eu entro na brincadeira. 😂';
  if (action === 'adm_message_send') return `Pronto: a mensagem para ${s.member_name} está na fila e sai em instantes. Se ele responder, eu atendo.`;
  if (action === 'adm_student_create') return `Pronto: ${s.name} cadastrado(a) como ${studentPlanLabel(s)}${s.paid ? `, pagamento de ${centsBR(s.amount_cents)} registrado (Card válido até ${dateBR(s.new_valid_until)})` : ''}.`;
  if (action === 'adm_dependent_create') return `Pronto: ${s.dependent_name} cadastrado(a) como ${s.relationship} de ${s.member_name}.`;
  if (action === 'adm_followup_create') return s.self ? `Pronto: te lembro em ${hhmm(s.due_at)}.` : `Pronto: retorno com ${s.member_name} criado para ${hhmm(s.due_at)}.`;
  if (action === 'adm_followup_done') return `Pronto: retorno ${s.new_status === 'canceled' ? 'cancelado' : 'concluído'}.`;
  if (action === 'adm_court_block') return `Pronto: ${s.court} bloqueada em ${dateBR(s.date)}, ${s.start}-${s.end}. Para liberar, é só pedir para cancelar essa reserva de bloqueio.`;
  if (action === 'adm_access_reject') return `Pronto: pedido de acesso de ${s.name} recusado.`;
  if (action === 'adm_announcement_create') return `Pronto: aviso «${s.title}» publicado.`;
  if (action === 'adm_announcement_deactivate') return `Pronto: aviso «${s.title}» tirado do ar.`;
  if (action === 'adm_student_status') return `Pronto: aluno ${s.student_name} ${s.status === 'paused' ? 'pausado' : 'reativado'}.`;
  if (action === 'adm_member_status') return `Pronto: sócio ${s.member_name} ${s.active ? 'reativado' : 'inativado'}.`;
  if (action === 'adm_signature_resend') return `Pronto: avisos de «${s.title}» reenviados (${Number((s.result as Ctx | undefined)?.resent ?? 0)} na fila).`;
  if (action === 'adm_reservation_cancel') return `Pronto: reserva ${s.court}, ${dateBR(s.date)} ${s.start}, cancelada.`;
  if (action === 'fin_charge_cancel') return `Pronto: pendência de ${s.member_name} (${s.description}) cancelada.`;
  if (action === 'fin_charge_adjust') return `Pronto: ajuste de ${centsBR(s.amount_cents)} aplicado na pendência de ${s.member_name} (${s.description}).`;
  if (action === 'fin_payment_reverse') return `Pronto: pagamento de ${centsBR(s.amount_cents)} de ${s.member_name} estornado; a pendência voltou a ficar em aberto.`;
  if (action === 'fin_receipt_approve') return `Pronto: comprovante de ${s.member_name} aprovado, ${centsBR(s.amount_cents)} baixados.`;
  if (action === 'fin_charges_generate') {
    const r = (s.result ?? {}) as Ctx;
    return `Pronto: ${Number(r.created ?? 0)} cobrança(s) nova(s) gerada(s); ${Number(r.existing ?? 0)} já existiam${Number(r.missing_price ?? 0) ? `; ${Number(r.missing_price)} mês(es) sem preço ficaram de fora` : ''}.`;
  }
  if (action === 'fin_receipt_reject') return `Pronto: comprovante de ${s.member_name} recusado.`;
  if (action === 'fin_entry_create') return `Pronto: ${s.entry_kind === 'expense' ? 'despesa' : 'receita'} lançada: ${s.description}, ${centsBR(s.amount_cents)}${receiptNote(s, 'comprovante anexado')}.`;
  const r = (s.result ?? {}) as Ctx;
  if (action === 'fin_pendency_create') {
    const envio = r.automation_recipient_id ? ' A cobrança já está na fila de envio.' : '';
    return `Pronto: pendência lançada para ${s.member_name}, ${s.description}, ${centsBR(s.amount_cents)}.${envio}`;
  }
  if (action === 'fin_pendency_send') {
    if (r.already) {
      return r.already === 'sent'
        ? `A cobrança de ${s.member_name} já foi enviada hoje às ${r.already_hhmm}. Não mandei de novo para não duplicar.`
        : `A cobrança de ${s.member_name} já está na fila de envio. Não criei outra para não duplicar.`;
    }
    return r.automation_recipient_id
      ? `Pronto: cobrança para ${s.member_name} na fila de envio.`
      : `Registrei o pedido, mas a cobrança de ${s.member_name} não entrou na fila (sem automação ativa ou sem telefone). Vale conferir em Conversas.`;
  }
  if (action === 'fin_pendency_collection') return `Pronto: cobrança de ${s.member_name} (${s.description}) ${s.enabled ? 'retomada' : 'pausada'}.`;
  const status = String(r.charge_status ?? '');
  const fim = status === 'paid' ? 'Pendência quitada.' : status === 'partial' ? 'Ficou parcial; o restante continua em aberto.' : '';
  return `Pronto: baixa de ${centsBR(s.amount_cents)} registrada para ${s.member_name}. ${fim}`.trim();
}
