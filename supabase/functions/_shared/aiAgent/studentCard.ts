// Renovação do Card Mensal de aluno pelo assessor administrativo (docs/joao-assessor/MAPA.md).
// Textos da proposta e do sucesso, e a resposta ao comprovante que o administrador manda na conversa.
// Tudo é escrito pelo servidor a partir do que o banco devolveu: o modelo nunca afirma valor, data ou validade.

import { OWN_MEMBERSHIP_QUESTION } from './receiptContext.ts';
import { monthBR } from './adminText.ts';

type Ctx = Record<string, unknown>;

const centsBR = (v: unknown) => `R$ ${(Number(v ?? 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const dateBR = (v: unknown) => String(v ?? '').slice(0, 10).split('-').reverse().join('/');

export function studentCardProposalMessage(s: Ctx): string {
  const rc = (s.receipt ?? null) as Ctx | null;
  const avisos = Array.isArray(s.warnings) ? (s.warnings as string[]).filter(Boolean) : [];
  const origem = rc
    ? ` Comprovante lido: ${rc.amount_cents != null ? centsBR(rc.amount_cents) : 'valor não lido'}${rc.paid_on ? ` em ${dateBR(rc.paid_on)}` : ''}${rc.payee ? `, para ${rc.payee}` : ''}.`
    : ' Sem comprovante nesta conversa.';
  const antes = s.previous_valid_until ? ` (hoje vale até ${dateBR(s.previous_valid_until)})` : '';
  const alerta = avisos.length ? ` Atenção: ${avisos.join(' ')}` : '';
  return `Vou renovar o Card Mensal de ${s.student_name}${antes}: ${centsBR(s.amount_cents)} pagos em ${dateBR(s.paid_on)} via PIX, nova validade ${dateBR(s.new_valid_until)}.${origem}${alerta}`;
}

export function studentCardSuccessMessage(s: Ctx): string {
  const rc = (s.receipt ?? null) as Ctx | null;
  return `Pronto: Card Mensal de ${s.student_name} renovado até ${dateBR(s.new_valid_until)} (${centsBR(s.amount_cents)}).${rc ? ' Comprovante arquivado.' : ''}`;
}

/** "R$ 300,00, de 19/10/2026, para Fulano": só o que o servidor conseguiu ler. */
function receiptFacts(r: Ctx): string {
  return [r.amount_cents != null ? centsBR(r.amount_cents) : null, r.paid_on ? `de ${dateBR(r.paid_on)}` : null, r.payee ? `para ${r.payee}` : null]
    .filter(Boolean).join(', ');
}

/** Resposta ao comprovante recebido (imagem/PDF sem texto) de um administrador no privado. */
/** Comprovante que não dá para resumir: não achado, já usado, repetido ou ilegível. */
function receiptBlocker(r: Ctx | null | undefined): string | null {
  if (!r || r.found !== true) {
    return 'Recebi o arquivo e estou conferindo. Me diga o nome do aluno (e se for outra coisa, o que é) que eu monto o resumo para você confirmar.';
  }
  if (r.status === 'approved') return 'Esse comprovante já foi usado para baixar uma cobrança, então não registro de novo.';
  if (r.duplicate === true) return 'Esse comprovante parece repetido (já recebi um igual antes). Confere se é o certo?';
  if (r.ocr_status !== 'ok') {
    return 'Recebi o comprovante, mas não consegui ler os dados. Me diga o aluno, o valor e a data que eu monto o resumo.';
  }
  return null;
}

export function receiptReceivedMessage(r: Ctx | null | undefined, topic?: string | null): string {
  const bloqueio = receiptBlocker(r);
  if (bloqueio || !r) return bloqueio ?? '';
  const dados = receiptFacts(r);
  const anexo = r.attached_entry as Ctx | undefined;
  if (anexo) return `Recebi o comprovante (${dados}) e anexei à despesa "${anexo.description}" de ${dateBR(anexo.paid_on)}, que estava sem comprovante. Se era de outra coisa, me avisa.`;
  // Pago a outra pessoa: costuma ser despesa do clube que a diretoria pagou, não engano.
  if (r.payee_ok === false) return `Recebi o comprovante (${dados}). Foi uma despesa do clube? Me diz o que é que eu monto o resumo.`;
  const propria = r.own_membership as Ctx | undefined;
  if (propria && (!topic || topic === 'mensalidade')) return `Recebi o comprovante (${dados}). ${ownMembershipQuestion(propria.competence_month)}`;
  return `Recebi o comprovante${dados ? ` (${dados})` : ''}. ${whatIsItFor(topic)}`;
}

/** O valor bate com a mensalidade em aberto do próprio admin: pergunta, nunca dá baixa sem ele confirmar. */
export const ownMembershipQuestion = (month: unknown) =>
  `${OWN_MEMBERSHIP_QUESTION} ${monthBR(month)}? Se for, me confirma que eu dou baixa. Se for outra coisa, me diz o que é.`;

/** A conversa já disse que é mensalidade e a baixa automática não bateu: pergunta de quem, nunca do Card. */
const whatIsItFor = (topic?: string | null) => (topic === 'mensalidade'
  ? 'Não bateu com a mensalidade em aberto que conferi. É a mensalidade de qual sócio e de qual mês?'
  : 'É para renovar o Card de qual aluno? Se for outra coisa, me diz o que é.');
