// Renovação do Card Mensal de aluno pelo assessor administrativo (docs/joao-assessor/MAPA.md).
// Textos da proposta e do sucesso, e a resposta ao comprovante que o administrador manda na conversa.
// Tudo é escrito pelo servidor a partir do que o banco devolveu: o modelo nunca afirma valor, data ou validade.

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
  return `Vou renovar o Card Mensal de ${s.student_name}${antes}: ${centsBR(s.amount_cents)} pagos em ${dateBR(s.paid_on)} via PIX, nova validade ${dateBR(s.new_valid_until)}.${origem}${alerta} Confirma?`;
}

export function studentCardSuccessMessage(s: Ctx): string {
  const rc = (s.receipt ?? null) as Ctx | null;
  return `Pronto: Card Mensal de ${s.student_name} renovado até ${dateBR(s.new_valid_until)} (${centsBR(s.amount_cents)}).${rc ? ' Comprovante arquivado.' : ''}`;
}

/** Resposta ao comprovante recebido (imagem/PDF sem texto) de um administrador no privado. */
export function receiptReceivedMessage(r: Ctx | null | undefined): string {
  if (!r || r.found !== true) {
    return 'Recebi o arquivo e estou conferindo. Me diga o nome do aluno (e se for outra coisa, o que é) que eu monto o resumo para você confirmar.';
  }
  if (r.status === 'approved') return 'Esse comprovante já foi usado para baixar uma cobrança, então não registro de novo.';
  if (r.duplicate === true) return 'Esse comprovante parece repetido (já recebi um igual antes). Confere se é o certo?';
  if (r.ocr_status !== 'ok') {
    return 'Recebi o comprovante, mas não consegui ler os dados. Me diga o aluno, o valor e a data que eu monto o resumo.';
  }
  if (r.payee_ok === false) {
    return `Recebi o comprovante, mas ele é para "${r.payee}", que não é o clube. Confere se mandou o certo?`;
  }
  const dados = [r.amount_cents != null ? centsBR(r.amount_cents) : null, r.paid_on ? `de ${dateBR(r.paid_on)}` : null, r.payee ? `para ${r.payee}` : null]
    .filter(Boolean).join(', ');
  return `Recebi o comprovante${dados ? ` (${dados})` : ''}. É para renovar o Card de qual aluno? Se for outra coisa, me diz o que é.`;
}
