// Textos das ações do financeiro: o que o João propõe e o que ele confirma depois que o banco gravou.
// Cada proposta é só o corpo; o "Confirma?" é posto por adminProposalMessage, igual para todas.

import type { Ctx } from './promptTypes.ts';
import type { AdminAction } from './adminMessages.ts';
import { studentCardProposalMessage, studentCardSuccessMessage } from './studentCard.ts';
import { centsBR, dateBR, methodBR, monthBR, plural } from './adminText.ts';

type FinTextAction = Extract<AdminAction, `fin_${string}` | 'student_card_renew'>;
export type Render = (s: Ctx) => string;

// O banco só liga o comprovante ao lançamento quando o valor lido bate (conv_private.admin_entry_receipt).
const receiptNote = (s: Ctx, text: string) => (s.receipt_id ? `, ${text}` : '');
const entryKind = (s: Ctx) => (s.entry_kind === 'expense' ? 'despesa' : 'receita');
const phoneBR = (v: unknown) => String(v ?? '').replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');

function memberCreateProposal(s: Ctx): string {
  const quem = s.action === 'fin_access_approve' ? `Vou aprovar o pedido de acesso de ${s.name}` : `Vou cadastrar o sócio ${s.name}`;
  const email = s.email ? `e-mail ${s.email}` : 'e-mail gerado pelo sistema';
  const leitura = s.amount_read ? '' : '\nNão consegui ler o valor do comprovante; vale o que você informou.';
  return `${quem} (telefone ${phoneBR(s.phone)}, ${email})${s.reactivate ? ', reativando o cadastro antigo' : ''}, com mensalidade de ${centsBR(s.amount_cents)}.`
    + `\nA mensalidade de ${monthBR(s.month)} fica paga com o comprovante que você mandou (${centsBR(s.amount_cents)}, pago em ${dateBR(s.paid_on)}, conta ${s.account_name}): ele entra sem pendência e os juros do mês de entrada são dispensados.${leitura}`;
}

function chargeAdjustProposal(s: Ctx): string {
  const o = s.adjust_kind === 'discount' ? 'desconto de' : s.adjust_kind === 'increase' ? 'acréscimo de' : 'perdão de juros/multa de';
  return `Vou aplicar ${o} ${centsBR(s.amount_cents)} na pendência de ${s.member_name}: ${s.description} (saldo hoje ${centsBR(s.total_due_cents)}). Motivo: ${s.reason}.`;
}

function receiptApproveProposal(s: Ctx): string {
  const itens = (Array.isArray(s.allocations) ? s.allocations as Ctx[] : []).map((a) => `- ${a.description} (venc. ${dateBR(a.due_date)}): ${centsBR(a.amount_cents)}`).join('\n');
  return `Vou aprovar o comprovante de ${s.member_name}, enviado em ${dateBR(s.sent_on)}: ${centsBR(s.amount_cents)}, pago em ${dateBR(s.paid_on)} via ${methodBR(s.method)}, conta ${s.account_name}. Baixa nas cobranças, da mais antiga para a mais nova:\n${itens}`;
}

function entryCreateProposal(s: Ctx): string {
  const quando = s.entry_status === 'pending' ? `a pagar até ${dateBR(s.due_date)}` : `paga em ${dateBR(s.paid_on)}`;
  return `Vou lançar a ${entryKind(s)}: ${s.description}, ${centsBR(s.amount_cents)}, categoria ${s.category_name}, conta ${s.account_name}, ${quando}${receiptNote(s, 'com o comprovante que você mandou anexado')}.`;
}

function pendencyCreateProposal(s: Ctx): string {
  const guest = s.guest_name ? ` (convidado ${s.guest_name}${s.guest_date ? ` em ${dateBR(s.guest_date)}` : ''})` : '';
  const envio = s.send_now ? 'Já mando a cobrança no WhatsApp do sócio.' : 'Sem mandar cobrança agora; a régua segue normal.';
  return `Vou lançar para ${s.member_name}: ${s.description}${guest}, ${centsBR(s.amount_cents)}, vencimento ${dateBR(s.due_date)}. ${envio}`;
}

function paymentProposal(s: Ctx): string {
  const sobra = Number(s.excess_cents ?? 0) > 0 ? ` Passa do saldo: ${centsBR(s.excess_cents)} viram crédito do sócio.` : '';
  return `Vou dar baixa de ${centsBR(s.amount_cents)} para ${s.member_name}: ${s.description} (saldo ${centsBR(s.total_due_cents)}), pago em ${dateBR(s.paid_on)} via ${methodBR(s.method)}, conta ${s.account_name}.${sobra}`;
}

export const FIN_PROPOSALS: Record<FinTextAction, Render> = {
  student_card_renew: studentCardProposalMessage,
  fin_member_create: (s) => memberCreateProposal({ ...s, action: 'fin_member_create' }),
  fin_access_approve: (s) => memberCreateProposal({ ...s, action: 'fin_access_approve' }),
  fin_charge_cancel: (s) => `Vou cancelar a pendência de ${s.member_name}: ${s.description} (saldo ${centsBR(s.total_due_cents)}). Motivo: ${s.reason}.`,
  fin_charge_adjust: chargeAdjustProposal,
  fin_payment_reverse: (s) => `Vou estornar o pagamento de ${centsBR(s.amount_cents)} de ${s.member_name} (${s.description}), feito em ${dateBR(s.paid_on)}. Motivo: ${s.reason}. A pendência volta a ficar em aberto.`,
  fin_receipt_approve: receiptApproveProposal,
  fin_charges_generate: (s) => `Vou gerar as cobranças que faltam para ${plural(s.plans_count, 'plano ativo de sócio', 'planos ativos de sócios')} (não duplica as que já existem; mês sem preço fica de fora).`,
  fin_receipt_reject: (s) => `Vou recusar o comprovante de ${s.member_name}, enviado em ${dateBR(s.sent_on)}${s.amount_cents != null ? ` (${centsBR(s.amount_cents)})` : ''}. Motivo: ${s.reason}.`,
  fin_entry_create: entryCreateProposal,
  fin_pendency_create: pendencyCreateProposal,
  fin_pendency_send: (s) => `Vou mandar agora a cobrança para ${s.member_name}: ${plural(s.open_count, 'pendência em aberto', 'pendências em aberto')}, total ${centsBR(s.member_total_due_cents)}.`,
  fin_pendency_collection: (s) => `Vou ${s.enabled ? 'retomar' : 'pausar'} a cobrança de ${s.member_name}: ${s.description} (saldo ${centsBR(s.total_due_cents)}).`,
  fin_payment: paymentProposal,
};

const result = (s: Ctx) => (s.result ?? {}) as Ctx;

function chargesGeneratedSuccess(s: Ctx): string {
  const r = result(s);
  const semPreco = Number(r.missing_price ?? 0) ? `; ${plural(r.missing_price, 'mês sem preço ficou de fora', 'meses sem preço ficaram de fora')}` : '';
  return `Pronto: ${plural(r.created, 'cobrança nova gerada', 'cobranças novas geradas')}; ${plural(r.existing, 'já existia', 'já existiam')}${semPreco}.`;
}

function pendencySendSuccess(s: Ctx): string {
  const r = result(s);
  if (r.already === 'sent') return `A cobrança de ${s.member_name} já foi enviada hoje às ${r.already_hhmm}. Não mandei de novo para não duplicar.`;
  if (r.already) return `A cobrança de ${s.member_name} já está na fila de envio. Não criei outra para não duplicar.`;
  return r.automation_recipient_id
    ? `Pronto: cobrança para ${s.member_name} na fila de envio.`
    : `Registrei o pedido, mas a cobrança de ${s.member_name} não entrou na fila (sem automação ativa ou sem telefone). Vale conferir em Conversas.`;
}

function paymentSuccess(s: Ctx): string {
  const status = String(result(s).charge_status ?? '');
  const fim = status === 'paid' ? ' Pendência quitada.' : status === 'partial' ? ' Ficou parcial; o restante continua em aberto.' : '';
  return `Pronto: baixa de ${centsBR(s.amount_cents)} registrada para ${s.member_name}.${fim}`;
}

const memberCreateSuccess: Render = (s) => `Pronto: ${s.name} agora é sócio e a mensalidade de ${monthBR(s.month)} ficou paga (${centsBR(s.amount_cents)}), sem pendência.`;

export const FIN_SUCCESS: Record<FinTextAction, Render> = {
  student_card_renew: studentCardSuccessMessage,
  fin_member_create: memberCreateSuccess,
  fin_access_approve: memberCreateSuccess,
  fin_charge_cancel: (s) => `Pronto: pendência de ${s.member_name} (${s.description}) cancelada.`,
  fin_charge_adjust: (s) => `Pronto: ajuste de ${centsBR(s.amount_cents)} aplicado na pendência de ${s.member_name} (${s.description}).`,
  fin_payment_reverse: (s) => `Pronto: pagamento de ${centsBR(s.amount_cents)} de ${s.member_name} estornado; a pendência voltou a ficar em aberto.`,
  fin_receipt_approve: (s) => `Pronto: comprovante de ${s.member_name} aprovado, ${centsBR(s.amount_cents)} baixados.`,
  fin_charges_generate: chargesGeneratedSuccess,
  fin_receipt_reject: (s) => `Pronto: comprovante de ${s.member_name} recusado.`,
  fin_entry_create: (s) => `Pronto: ${entryKind(s)} lançada: ${s.description}, ${centsBR(s.amount_cents)}${receiptNote(s, 'comprovante anexado')}.`,
  fin_pendency_create: (s) => `Pronto: pendência lançada para ${s.member_name}, ${s.description}, ${centsBR(s.amount_cents)}.${result(s).automation_recipient_id ? ' A cobrança já está na fila de envio.' : ''}`,
  fin_pendency_send: pendencySendSuccess,
  fin_pendency_collection: (s) => `Pronto: cobrança de ${s.member_name} (${s.description}) ${s.enabled ? 'retomada' : 'pausada'}.`,
  fin_payment: paymentSuccess,
};
