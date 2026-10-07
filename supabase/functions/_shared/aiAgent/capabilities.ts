// Registro de capacidades do João como assessor dos administradores (Onda 0, docs/joao-assessor/MAPA.md).
// Uma capacidade nova entra aqui (domínio, risco, leitura/escrita) e ganha RPC + teste; o fluxo do turno não muda.
//
// Riscos: N0 leitura · N1 reversível/operacional (resumo + "sim") · N2 financeiro (resumo + "sim"; a partir do
// limite, segunda confirmação repetindo o valor, imposta no banco) · N3 nunca por chat (o João só indica a tela).

export type Risk = 'N0' | 'N1' | 'N2' | 'N3';
export type Domain = 'financeiro' | 'pessoas' | 'quadra' | 'competicoes' | 'clube' | 'conversas';

export type Capability = {
  id: string;
  domain: Domain;
  risk: Risk;
  label: string;
  /** Seção do painel que faz o mesmo (destino do N3 e fonte da verdade das regras). */
  panel: string;
  /** Leitura que o servidor carrega no contexto do administrador antes do modelo responder. */
  read?: { rpc: string; ctxKey: string };
  /** Consulta sob demanda: domínio de `conv_svc_ai_admin_read` (o servidor busca e escreve o texto). */
  onDemand?: string;
  /** Ação de escrita (`fin_action` do modelo → proposta no banco). */
  write?: { finAction: string } | { admAction: string };
};

/** Valor (centavos) a partir do qual uma operação financeira exige a segunda confirmação. Igual ao do banco. */
export const SECOND_CONFIRM_CENTS = 40000;

export const CAPABILITIES: readonly Capability[] = [
  { id: 'fin.balances', domain: 'financeiro', risk: 'N0', label: 'Saldo das contas do clube', panel: 'Financeiro', read: { rpc: 'conv_svc_ai_club_balances', ctxKey: 'club_balances' } },
  { id: 'fin.cash', domain: 'financeiro', risk: 'N0', label: 'Caixa do período', panel: 'Financeiro', onDemand: 'caixa' },
  { id: 'fin.receivables', domain: 'financeiro', risk: 'N0', label: 'A receber e a pagar', panel: 'Financeiro', onDemand: 'receber_pagar' },
  { id: 'fin.dre', domain: 'financeiro', risk: 'N0', label: 'Resultado (DRE)', panel: 'Financeiro', onDemand: 'dre' },
  { id: 'fin.comparativo', domain: 'financeiro', risk: 'N0', label: 'Comparativo com o período anterior (por que subiu/caiu)', panel: 'Financeiro', onDemand: 'comparativo' },
  { id: 'conv.followups', domain: 'conversas', risk: 'N0', label: 'Retornos pendentes', panel: 'Conversas', onDemand: 'followups' },
  { id: 'adm.prefs.read', domain: 'clube', risk: 'N0', label: 'Minhas preferências do assessor', panel: 'João', onDemand: 'preferencias' },
  { id: 'fin.student_revenue', domain: 'financeiro', risk: 'N0', label: 'Receita de alunos', panel: 'Financeiro', onDemand: 'receita_alunos' },
  { id: 'fin.receipts', domain: 'financeiro', risk: 'N0', label: 'Fila de comprovantes', panel: 'Financeiro', onDemand: 'comprovantes' },
  { id: 'people.access', domain: 'pessoas', risk: 'N0', label: 'Pedidos de acesso pendentes', panel: 'Acessos', onDemand: 'acessos' },
  { id: 'club.signatures', domain: 'clube', risk: 'N0', label: 'Assinaturas pendentes', panel: 'Documentos', onDemand: 'assinaturas' },
  { id: 'court.occupancy', domain: 'quadra', risk: 'N0', label: 'Reservas do dia', panel: 'Reservas', onDemand: 'ocupacao' },
  { id: 'fin.pendency.create', domain: 'financeiro', risk: 'N2', label: 'Lançar pendência de sócio', panel: 'Financeiro', write: { finAction: 'lancar' } },
  { id: 'fin.pendency.send', domain: 'financeiro', risk: 'N1', label: 'Cobrar agora', panel: 'Financeiro', write: { finAction: 'cobrar' } },
  { id: 'fin.pendency.pause', domain: 'financeiro', risk: 'N1', label: 'Pausar cobrança', panel: 'Financeiro', write: { finAction: 'pausar' } },
  { id: 'fin.pendency.resume', domain: 'financeiro', risk: 'N1', label: 'Retomar cobrança', panel: 'Financeiro', write: { finAction: 'retomar' } },
  { id: 'student.card.renew', domain: 'pessoas', risk: 'N2', label: 'Renovar Card Mensal de aluno', panel: 'Alunos', write: { finAction: 'renovar_card' } },
  { id: 'fin.charge.cancel', domain: 'financeiro', risk: 'N2', label: 'Cancelar pendência', panel: 'Financeiro', write: { finAction: 'cancelar_pendencia' } },
  { id: 'fin.charge.adjust', domain: 'financeiro', risk: 'N2', label: 'Ajustar cobrança (desconto, acréscimo, perdão de encargos)', panel: 'Financeiro', write: { finAction: 'ajustar' } },
  { id: 'fin.payment.reverse', domain: 'financeiro', risk: 'N2', label: 'Estornar último pagamento', panel: 'Financeiro', write: { finAction: 'estornar' } },
  { id: 'fin.receipt.approve', domain: 'financeiro', risk: 'N2', label: 'Aprovar comprovante', panel: 'Financeiro', write: { finAction: 'aprovar_comprovante' } },
  { id: 'fin.charges.generate', domain: 'financeiro', risk: 'N2', label: 'Gerar cobranças do mês', panel: 'Financeiro', write: { finAction: 'gerar_cobrancas' } },
  { id: 'fin.receipt.reject', domain: 'financeiro', risk: 'N2', label: 'Recusar comprovante', panel: 'Financeiro', write: { finAction: 'rejeitar_comprovante' } },
  { id: 'fin.entry.expense', domain: 'financeiro', risk: 'N2', label: 'Lançar despesa', panel: 'Financeiro', write: { finAction: 'despesa' } },
  { id: 'fin.entry.revenue', domain: 'financeiro', risk: 'N2', label: 'Lançar receita', panel: 'Financeiro', write: { finAction: 'receita' } },
  { id: 'adm.announcement.create', domain: 'clube', risk: 'N1', label: 'Publicar aviso', panel: 'Avisos', write: { admAction: 'aviso' } },
  { id: 'adm.announcement.deactivate', domain: 'clube', risk: 'N1', label: 'Tirar aviso do ar', panel: 'Avisos', write: { admAction: 'aviso_desativar' } },
  { id: 'adm.student.status', domain: 'pessoas', risk: 'N1', label: 'Pausar/reativar aluno', panel: 'Alunos', write: { admAction: 'aluno_status' } },
  { id: 'adm.access.approve', domain: 'pessoas', risk: 'N2', label: 'Aprovar pedido de acesso (sócio novo com mensalidade paga)', panel: 'Acessos', write: { admAction: 'acesso_aprovar' } },
  { id: 'adm.access.reject', domain: 'pessoas', risk: 'N1', label: 'Recusar pedido de acesso', panel: 'Acessos', write: { admAction: 'acesso_recusar' } },
  { id: 'adm.member.create', domain: 'pessoas', risk: 'N2', label: 'Cadastrar sócio novo (com mensalidade paga)', panel: 'Sócios', write: { admAction: 'socio_criar' } },
  { id: 'adm.followup.create', domain: 'conversas', risk: 'N1', label: 'Criar retorno (follow-up) ou lembrete', panel: 'Conversas', write: { admAction: 'followup_criar' } },
  { id: 'adm.followup.done', domain: 'conversas', risk: 'N1', label: 'Concluir ou cancelar retorno', panel: 'Conversas', write: { admAction: 'followup_concluir' } },
  { id: 'adm.court.block', domain: 'clube', risk: 'N1', label: 'Bloquear horário de quadra', panel: 'Agenda', write: { admAction: 'quadra_bloquear' } },
  { id: 'adm.prefs.set', domain: 'clube', risk: 'N1', label: 'Ajustar preferências, alertas e resumo da manhã', panel: 'João', write: { admAction: 'preferencia' } },
  { id: 'adm.member.status', domain: 'pessoas', risk: 'N1', label: 'Inativar/reativar sócio', panel: 'Sócios', write: { admAction: 'socio_status' } },
  { id: 'adm.dependent.create', domain: 'pessoas', risk: 'N1', label: 'Cadastrar dependente de sócio', panel: 'Alunos', write: { admAction: 'dependente_criar' } },
  { id: 'adm.message.send', domain: 'pessoas', risk: 'N1', label: 'Chamar sócio no privado e mandar mensagem', panel: 'Conversas', write: { admAction: 'mensagem_enviar' } },
  { id: 'adm.signature.resend', domain: 'clube', risk: 'N1', label: 'Reenviar avisos de assinatura com falha', panel: 'Documentos', write: { admAction: 'assinatura_reenviar' } },
  { id: 'adm.reservation.cancel', domain: 'quadra', risk: 'N1', label: 'Cancelar reserva', panel: 'Reservas', write: { admAction: 'reserva_cancelar' } },
  { id: 'fin.payment.register', domain: 'financeiro', risk: 'N2', label: 'Dar baixa em pagamento', panel: 'Financeiro', write: { finAction: 'baixa' } },
];

/** Leituras carregadas só para administrador no privado (nunca para sócio nem para grupo). */
export const ADMIN_READS = CAPABILITIES.filter((c) => c.read);

export const capabilityByFinAction = (finAction: string | null | undefined) =>
  CAPABILITIES.find((c) => c.write && 'finAction' in c.write && c.write.finAction === finAction);

export const needsSecondConfirm = (amountCents: number | null | undefined) =>
  Number.isFinite(amountCents) && Number(amountCents) >= SECOND_CONFIRM_CENTS;

// N3: pedidos destrutivos ou de configuração. O servidor responde, o modelo nem é chamado.
const N3_RULES: { re: RegExp; what: string; panel: string }[] = [
  { re: /\b(zer(a|ar|e)|reset(a|ar|e)?|limp(a|ar|e))\b.{0,20}\branking\b|\branking\b.{0,20}\b(zer(a|ar|e)|reset(a|ar|e)?)\b/, what: 'zerar o ranking', panel: 'Lançamentos' },
  { re: /\b(troc(a|ar|e)|mud(a|ar|e)|alter(a|ar|e))\b.{0,25}\b(papel|cargo|fun[cç][aã]o|permiss[aã]o)\b/, what: 'trocar o papel de um sócio', panel: 'Sócios' },
  { re: /\b(encerr(a|ar|e)|cancel(a|ar|e)|termin(a|ar|e))\b.{0,20}\bplano\b/, what: 'encerrar um plano', panel: 'Financeiro' },
  { re: /\b(apag(a|ar|ue)|exclu(i|ir|a)|delet(a|ar|e)|remov(a|er|e))\b.{0,30}\b(socio|aluno|professor|lancamento|cobranca|pendencia|pagamento|conta|categoria|documento|aviso|torneio|campeonato|reserva|mensagem|conversa)\b/, what: 'apagar registros', panel: 'o painel' },
  { re: /\b(edit(a|ar|e)|mud(a|ar|e)|alter(a|ar|e))\b.{0,25}\b(configura[cç][aã]o|configuracoes|regras do clube|chave pix|pix do clube)\b/, what: 'mudar configurações do clube', panel: 'Regras' },
];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Texto para o administrador quando o pedido é N3; `null` quando não é. */
export function n3Reply(text: string): string | null {
  const t = fold(text);
  const hit = N3_RULES.find((r) => r.re.test(t));
  if (!hit) return null;
  const onde = hit.panel === 'o painel' ? 'pelo painel administrativo' : `pelo painel administrativo, na seção ${hit.panel}`;
  return `Isso (${hit.what}) eu não faço por aqui, por segurança. Dá pra fazer ${onde}. O resto eu resolvo aqui com você.`;
}
