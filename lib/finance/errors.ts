/**
 * Tradução dos códigos de erro do financeiro (lançados pelas funções SQL como
 * `raise exception 'CODIGO'`) para mensagens que o usuário entende.
 *
 * Regra: causa + o que fazer. Texto cru do banco nunca vai para a tela.
 */
import { notify } from '../notifications';

export interface FinanceErrorInfo {
  message: string;
  hint?: string;
}

const M = (message: string, hint?: string): FinanceErrorInfo => ({ message, hint });

export const FINANCE_ERRORS: Record<string, FinanceErrorInfo> = {
  FINANCE_FORBIDDEN: M('Você não tem permissão para esta ação financeira.', 'Peça a um administrador do clube.'),
  FINANCE_NO_DELETE: M('Registro financeiro não se apaga.', 'Cancele ou estorne para manter o histórico.'),
  IDEMPOTENCY_KEY_REQUIRED: M('Não foi possível identificar a operação.', 'Feche a janela e tente de novo.'),
  IDEMPOTENCY_KEY_REUSED: M('Esta operação já foi usada para outra ação.', 'Feche a janela e tente de novo.'),
  VERSION_CONFLICT: M('Alguém alterou este registro enquanto você editava.', 'Atualize a tela e refaça a alteração.'),
  INVALID_AMOUNT: M('Valor inválido.', 'Informe um valor maior que zero.'),
  INVALID_DATE: M('Data inválida.', 'A data não pode ser futura.'),
  INVALID_PERIOD: M('Período inválido.', 'O período pode ter no máximo dois anos.'),
  REASON_REQUIRED: M('Falta a justificativa.', 'Escreva o motivo da ação (algumas palavras bastam) — ele fica registrado na auditoria.'),
  NOT_A_MEMBER: M('Esta pessoa não é sócia ativa do clube.', 'Só sócios ativos têm mensalidade.'),
  PLAN_EXISTS: M('Este sócio já tem uma mensalidade ativa.', 'Encerre a atual antes de criar outra.'),
  PLAN_NOT_FOUND: M('Mensalidade não encontrada.'),
  PLAN_ENDED: M('Esta mensalidade já foi encerrada.'),
  INVALID_PLAN: M('Dados da mensalidade inválidos.', 'Confira início, valor e periodicidade.'),
  PRICE_EXISTS: M('Já existe um valor definido a partir desse mês.', 'Escolha outro mês de vigência.'),
  CHARGE_NOT_FOUND: M('Cobrança não encontrada.'),
  CHARGE_CANCELED: M('Esta cobrança está cancelada.'),
  CHARGE_HAS_PAYMENTS: M('A cobrança já tem pagamento.', 'Estorne o pagamento antes de cancelar.'),
  INVALID_ADJUSTMENT: M('Ajuste inválido.'),
  DISCOUNT_EXCEEDS_BALANCE: M('O desconto é maior que o saldo da cobrança.'),
  WAIVER_EXCEEDS_FEES: M('A dispensa é maior que os encargos em aberto.', 'Dispense no máximo o valor de multa e juros devidos.'),
  PAYMENT_DATE_BEFORE_LAST: M('A data é anterior ao último pagamento desta cobrança.', 'Registre na ordem em que o dinheiro entrou.'),
  PAYMENT_NOT_FOUND: M('Pagamento não encontrado.'),
  PAYMENT_ALREADY_REVERSED: M('Este pagamento já foi estornado.'),
  ONLY_LAST_PAYMENT_REVERSIBLE: M('Só o último pagamento da cobrança pode ser estornado.', 'Estorne os mais recentes primeiro.'),
  CREDIT_ALREADY_USED: M('O crédito deste pagamento já foi usado.', 'Desfaça o uso do crédito antes de estornar.'),
  CREDIT_NOT_OPEN: M('Este crédito já foi resolvido.'),
  CREDIT_OWNER_MISMATCH: M('O crédito é de outro sócio.'),
  CREDIT_EXCEEDS_DUE: M('O crédito é maior que o devido.'),
  NOTHING_TO_APPLY: M('A cobrança não tem nada em aberto para receber este crédito.'),
  INVALID_METHOD: M('Forma de pagamento inválida.'),
  ACCOUNT_REQUIRED: M('Escolha a conta onde o dinheiro entrou.', 'Cadastre uma conta em Contas, se ainda não houver.'),
  INVALID_ACCOUNT: M('Conta inválida ou desativada.'),
  ACCOUNT_NAME_TAKEN: M('Já existe uma conta com esse nome.'),
  ACCOUNT_LINKED: M('Esta conta é a padrão de recebimentos.', 'Escolha outra como padrão antes de desativar.'),
  CATEGORY_REQUIRED: M('Escolha uma categoria.'),
  INVALID_CATEGORY: M('Categoria inválida ou desativada.'),
  CATEGORY_RESERVED: M('Esta categoria é lançada automaticamente.', 'Mensalidades, Card Mensal, Aula avulsa, Day Card, descontos e multas não se lançam à mão — isso contaria o valor duas vezes.'),
  CATEGORY_SYSTEM: M('Categoria do sistema não pode ser alterada desse jeito.'),
  CATEGORY_NAME_TAKEN: M('Já existe uma categoria com esse nome.'),
  CATEGORY_HAS_ACTIVE_CHILDREN: M('Esta categoria tem subcategorias ativas.', 'Desative as subcategorias antes.'),
  ENTRY_NOT_FOUND: M('Lançamento não encontrado.'),
  ENTRY_CANCELED: M('Este lançamento está cancelado.'),
  ENTRY_NOT_PENDING: M('Este lançamento não está pendente.'),
  ENTRY_HAS_PAYMENTS: M('O lançamento já tem pagamento.', 'Estorne o pagamento antes de cancelar ou mudar o valor.'),
  ENTRY_REASON_REQUIRED: M('Mexer em lançamento já pago exige justificativa.'),
  PAYMENT_EXCEEDS_ENTRY: M('O valor pago passa do documento.', 'Use "dar baixa" para registrar a diferença como juros/desconto.'),
  INVALID_ENTRY: M('Dados do lançamento inválidos.'),
  DUE_DATE_REQUIRED: M('Informe o vencimento.'),
  SAME_ACCOUNT: M('Origem e destino da transferência são a mesma conta.'),
  INVALID_RECURRENCE: M('Dados da recorrência inválidos.'),
  RECURRENCE_NOT_FOUND: M('Recorrência não encontrada.'),
  INVALID_HOLIDAY: M('Feriado inválido.', 'Feriados nacionais já vêm da lei; cadastre só os locais.'),
  HOLIDAY_EXISTS: M('Já existe um feriado nessa data.'),
  NO_BUSINESS_DAY: M('O calendário não tem nenhum dia útil próximo.', 'Revise os feriados ativos.'),
  INVALID_ATTACHMENT: M('Arquivo inválido.', 'Envie imagem (JPG, PNG, WEBP, HEIC) ou PDF de até 10 MB.'),
  NO_CHARGES_SELECTED: M('Escolha ao menos uma cobrança.'),
  INVALID_CHARGES: M('Alguma cobrança escolhida não é sua ou já foi quitada.'),
  RECEIPT_NOT_FOUND: M('Comprovante não encontrado.'),
  RECEIPT_NOT_PENDING: M('Este comprovante já foi decidido.'),
  RECEIPT_NOT_REPLACEABLE: M('Este comprovante não pode mais ser substituído.'),
  ACCOUNT_NOT_FOUND: M('Conta não encontrada.', 'Atualize a tela e tente de novo.'),
  ATTACHMENT_NOT_FOUND: M('Anexo não encontrado ou já removido.'),
  CATEGORY_NOT_FOUND: M('Categoria não encontrada.', 'Atualize a tela e tente de novo.'),
  CREDIT_NOT_FOUND: M('Crédito não encontrado.'),
  HOLIDAY_NOT_FOUND: M('Feriado não encontrado.'),
  INVALID_ACTION: M('Ação inválida.'),
};

const CODE_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

/** Extrai o código `FINANCE_FORBIDDEN`, `REASON_REQUIRED`… de qualquer formato de erro. */
export function financeErrorCode(error: unknown): string | null {
  const raw = typeof error === 'string' ? error : (error as { message?: string } | null)?.message ?? '';
  const m = CODE_RE.exec(raw);
  return m && m[0] in FINANCE_ERRORS ? m[0] : null;
}

export function financeErrorInfo(error: unknown, fallback = 'Não foi possível concluir a operação financeira.'): FinanceErrorInfo {
  const code = financeErrorCode(error);
  if (code) return FINANCE_ERRORS[code];
  const pg = (error as { code?: string } | null)?.code;
  if (pg === '42501') return FINANCE_ERRORS.FINANCE_FORBIDDEN;
  if (pg === '23514') return M('Algum valor informado não é aceito.', 'Confira os campos e tente de novo.');
  if (pg === '23505') return M('Este registro já existe.');
  if (pg === '23503') return M('Este item depende de outro registro.', 'Atualize a tela e tente de novo.');
  return { message: fallback, hint: 'Se persistir, avise o suporte do clube.' };
}

/** Mostra o erro ao usuário e loga só o código (nunca payload, valores ou arquivos). */
export function notifyFinanceError(error: unknown, fallback: string, event: string): void {
  const info = financeErrorInfo(error, fallback);
  notify.error(info.message, { description: info.hint }, { event, code: financeErrorCode(error) ?? (error as { code?: string } | null)?.code ?? 'unknown' });
}
