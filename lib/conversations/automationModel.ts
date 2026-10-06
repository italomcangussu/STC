/**
 * Modelo das automações de WhatsApp, do lado do navegador.
 *
 * O banco é a fonte da verdade (`conv_private.automation_problems`, `automation_vars`,
 * públicos `aud_*`); aqui ficam os rótulos, os modelos guiados e uma validação de apoio para a tela
 * avisar ANTES de salvar. `__tests__/conversations/ui/automationModel.test.ts` confere que as
 * variáveis e os códigos daqui batem com a migration — se divergirem, o teste quebra.
 */
import type { AutomationSchedule, AutomationSource, AutomationStatus, AutomationTrigger } from './api';

export const SOURCE_LABEL: Record<AutomationSource, string> = {
  finance_charge: 'Mensalidade (financeiro)',
  card_mensal: 'Card Mensal (Paycard)',
  championship_notice: 'Aviso a participantes de campeonato',
  championship_result: 'Resultado de partida',
  championship_advance: 'Avanço de fase',
  audience: 'Aviso a um público',
};

export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  scheduled: 'Agendada (dias e hora fixos)',
  conditional: 'Condicional (confere todo dia)',
  event: 'Por evento (quando acontece)',
  manual: 'Manual (você aprova o envio)',
};

export const STATUS_LABEL: Record<AutomationStatus, string> = { draft: 'Rascunho', active: 'Ativa', paused: 'Pausada', ended: 'Encerrada' };

/** Combinações aceitas pelo banco (`conv_automation_combo`). */
export const TRIGGERS_BY_SOURCE: Record<AutomationSource, AutomationTrigger[]> = {
  finance_charge: ['scheduled', 'conditional', 'manual'],
  card_mensal: ['scheduled', 'conditional', 'manual'],
  championship_notice: ['scheduled', 'manual'],
  audience: ['scheduled', 'manual'],
  championship_result: ['event'],
  championship_advance: ['event'],
};

/** Variáveis `{{...}}` permitidas por origem (espelho de `conv_private.automation_vars`). */
export const VARS_BY_SOURCE: Record<AutomationSource, string[]> = {
  finance_charge: ['nome', 'clube', 'competencia', 'vencimento', 'valor', 'total', 'dias_atraso', 'encargos'],
  card_mensal: ['nome', 'clube', 'vencimento', 'dias_para_vencer', 'dias_vencido'],
  championship_notice: ['nome', 'clube', 'campeonato', 'classe'],
  championship_result: ['nome', 'clube', 'campeonato', 'fase', 'adversario', 'placar', 'resultado'],
  championship_advance: ['nome', 'clube', 'campeonato', 'fase', 'adversario'],
  audience: ['nome', 'clube'],
};

export const VAR_HELP: Record<string, string> = {
  nome: 'Primeiro nome da pessoa',
  clube: 'Sobral Tênis Clube',
  competencia: 'Mês da mensalidade (ex.: outubro/2026)',
  vencimento: 'Data de vencimento (DD/MM/AAAA)',
  valor: 'Valor da mensalidade (principal em aberto)',
  total: 'Valor total devido hoje',
  dias_atraso: 'Dias de atraso (só quando há atraso)',
  encargos: 'Encargos — só existem se a política de multa/juros estiver configurada e confirmada no Financeiro',
  dias_para_vencer: 'Dias até o vencimento do Card (só se ainda não venceu)',
  dias_vencido: 'Dias desde o vencimento do Card (só se já venceu)',
  campeonato: 'Nome do campeonato',
  classe: 'Classe da inscrição',
  fase: 'Fase da partida',
  adversario: 'Nome do adversário',
  placar: 'Placar registrado',
  resultado: 'Resultado (vitória ou derrota) do destinatário',
};

export const AUDIENCES: { id: string; label: string }[] = [
  { id: 'members', label: 'Sócios ativos' },
  { id: 'students', label: 'Alunos' },
  { id: 'dependents', label: 'Dependentes (responsável)' },
  { id: 'professors', label: 'Professores' },
  { id: 'card_holders', label: 'Alunos com Card Mensal' },
  { id: 'championship_participants', label: 'Participantes de um campeonato' },
];

export const FINANCE_STAGES: { id: string; label: string; help: string; defaultDays: number }[] = [
  { id: 'period_start', label: 'Início do período', help: 'Cobranças cuja competência começou há até N dias.', defaultDays: 3 },
  { id: 'before_due', label: 'Antes do vencimento', help: 'Cobranças que vencem em até N dias.', defaultDays: 3 },
  { id: 'overdue', label: 'Em atraso', help: 'Cobranças vencidas há N dias ou mais; repete a cada X dias.', defaultDays: 1 },
  { id: 'in_review', label: 'Comprovante em análise', help: 'Cobranças com comprovante enviado aguardando conferência.', defaultDays: 1 },
];

export const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Códigos de pendência devolvidos por `automation_problems` → frase. */
export const PROBLEM_LABEL: Record<string, string> = {
  MENSAGEM_VAZIA: 'Escreva a mensagem.',
  ENCARGOS_NAO_CONFIGURADOS: 'A mensagem usa {{encargos}}, mas a política de multa e juros ainda não foi confirmada no Financeiro.',
  ESTAGIO_INVALIDO: 'Escolha o momento da mensalidade (início, antes do vencimento, atraso…).',
  CAMPEONATO_OBRIGATORIO: 'Escolha o campeonato.',
  CAMPEONATO_INEXISTENTE: 'O campeonato escolhido não existe mais.',
  PUBLICO_INVALIDO: 'Escolha o público.',
  HORARIO_INVALIDO: 'Informe o horário de envio (HH:MM).',
  DATA_INVALIDA: 'Alguma data informada é inválida.',
  RECORRENCIA_OBRIGATORIA: 'Escolha os dias da semana ou datas específicas.',
};

/** Pendência (inclui `VARIAVEL_INDISPONIVEL:<nome>`) → frase. */
export function describeProblem(code: string): string {
  if (code.startsWith('VARIAVEL_INDISPONIVEL:')) {
    const nome = code.split(':')[1] ?? '';
    return `A variável {{${nome}}} não existe para este tipo de automação.`;
  }
  return PROBLEM_LABEL[code] ?? 'Há uma pendência na configuração.';
}

/** Motivos de exclusão da prévia/execução → frase curta. */
export const REASON_LABEL: Record<string, string> = {
  SOCIO_INATIVO: 'Sócio inativo',
  DEPENDENTE: 'Dependente (o aviso vai ao responsável)',
  CARD_INATIVO_OU_CANCELADO: 'Card inativo ou cancelado',
  ALUNO_PAUSADO_OU_ENCERRADO: 'Aluno pausado ou encerrado',
  VENCIDO_HA_MUITO_TEMPO: 'Card vencido além da janela',
  AINDA_LONGE_DO_VENCIMENTO: 'Card ainda longe do vencimento',
  PROFESSOR_INATIVO: 'Professor inativo',
  CAMPEONATO_NAO_ATIVO: 'Campeonato não está em andamento',
  CONVIDADO_SEM_CADASTRO: 'Convidado sem cadastro',
  SEM_TELEFONE_VALIDO: 'Sem telefone válido',
  OPT_OUT: 'Pediu para não receber',
  COBRANCA_NAO_PENDENTE: 'Cobrança já não está pendente',
  CARD_RENOVADO_OU_ALTERADO: 'Card renovado ou alterado desde o aviso',
  FORA_DO_PUBLICO: 'Saiu do público desde o aviso',
  RESULTADO_ALTERADO: 'Resultado mudou desde o aviso',
  RESULTADO_INCOMPLETO: 'Resultado ainda incompleto',
  PLACAR_INCOMPLETO: 'Placar ainda incompleto',
  AVANCO_NAO_CONFIRMADO_PELO_MOTOR: 'Avanço ainda não confirmado pelo chaveamento',
  PARTIDA_SEGUINTE_JA_INICIADA: 'A próxima partida já começou',
  EVENTO_NAO_CONFIRMADO_AGORA: 'Evento não confirmado no momento do envio',
  VARIAVEL_SEM_VALOR: 'Faltou algum dado para montar a mensagem',
  AUTOMACAO_PAUSED: 'Automação pausada',
  AUTOMACAO_ENDED: 'Automação encerrada',
  AUTOMACAO_ENCERRADA: 'Automação encerrada',
  EXECUCAO_CANCELADA: 'Execução cancelada',
  SEND_FAILED: 'O WhatsApp não aceitou o envio',
};
export const describeReason = (code: string | null | undefined): string => (code ? REASON_LABEL[code] ?? code : '');

export type AutomationDraft = {
  name: string;
  description: string;
  objective: string;
  source: AutomationSource;
  trigger_type: AutomationTrigger;
  definition: Record<string, unknown>;
  schedule: AutomationSchedule;
  message_body: string;
};

export type AutomationTemplate = { id: string; label: string; help: string; draft: AutomationDraft };

const clube = 'Sobral Tênis Clube';

/** Modelos prontos: o texto vem com variáveis, nunca com valores fixos. */
export const TEMPLATES: AutomationTemplate[] = [
  {
    id: 'mensalidade-inicio', label: 'Mensalidade — início do período',
    help: 'Avisa o sócio que a mensalidade do mês foi gerada.',
    draft: {
      name: 'Mensalidade: aviso do mês', description: 'Aviso de mensalidade disponível.', objective: 'Reduzir esquecimento de pagamento.',
      source: 'finance_charge', trigger_type: 'scheduled', definition: { stage: 'period_start', days: 3, exclude_in_review: true },
      schedule: { time: '09:00', weekdays: [1, 2, 3, 4, 5] },
      message_body: `Olá, {{nome}}! A mensalidade de {{competencia}} do ${clube} está disponível: {{valor}}, com vencimento em {{vencimento}}. Qualquer dúvida, é só responder por aqui.`,
    },
  },
  {
    id: 'mensalidade-vencimento', label: 'Mensalidade — antes do vencimento',
    help: 'Lembrete poucos dias antes de vencer.',
    draft: {
      name: 'Mensalidade: lembrete de vencimento', description: 'Lembrete antes do vencimento.', objective: 'Pagar em dia.',
      source: 'finance_charge', trigger_type: 'scheduled', definition: { stage: 'before_due', days: 3, exclude_in_review: true },
      schedule: { time: '09:00', weekdays: [1, 2, 3, 4, 5] },
      message_body: `Olá, {{nome}}! Lembrando que a mensalidade de {{competencia}} ({{valor}}) vence em {{vencimento}}. Se já pagou, pode ignorar esta mensagem.`,
    },
  },
  {
    id: 'mensalidade-atraso', label: 'Mensalidade — em atraso',
    help: 'Aviso de cobrança vencida, repetido a cada 7 dias.',
    draft: {
      name: 'Mensalidade: aviso de atraso', description: 'Aviso de mensalidade em atraso.', objective: 'Recuperar mensalidades vencidas.',
      source: 'finance_charge', trigger_type: 'scheduled', definition: { stage: 'overdue', days: 1, repeat_days: 7, exclude_in_review: true },
      schedule: { time: '10:00', weekdays: [1, 2, 3, 4, 5] },
      message_body: `Olá, {{nome}}! Identificamos que a mensalidade de {{competencia}} ({{valor}}), vencida em {{vencimento}}, ainda está em aberto. Se já pagou, envie o comprovante por aqui que conferimos.`,
    },
  },
  {
    id: 'card-vencer', label: 'Card Mensal — a vencer',
    help: 'Avisa o aluno poucos dias antes do Card vencer.',
    draft: {
      name: 'Card Mensal: renovação', description: 'Aviso de Card Mensal próximo do vencimento.', objective: 'Renovar o Card no prazo.',
      source: 'card_mensal', trigger_type: 'scheduled', definition: { days_before: 7, days_after: 0 },
      schedule: { time: '09:30', weekdays: [1, 2, 3, 4, 5] },
      message_body: `Olá, {{nome}}! Seu Card Mensal no ${clube} vence em {{vencimento}} (faltam {{dias_para_vencer}} dias). Fale com a gente para renovar.`,
    },
  },
  {
    id: 'card-vencido', label: 'Card Mensal — vencido',
    help: 'Avisa o aluno cujo Card venceu há poucos dias.',
    draft: {
      name: 'Card Mensal: vencido', description: 'Aviso de Card Mensal vencido.', objective: 'Reativar o Card.',
      source: 'card_mensal', trigger_type: 'scheduled', definition: { days_before: 0, days_after: 7 },
      schedule: { time: '09:30', weekdays: [1, 3, 5] },
      message_body: `Olá, {{nome}}! Seu Card Mensal venceu em {{vencimento}} (há {{dias_vencido}} dias). Se quiser renovar, é só responder por aqui.`,
    },
  },
  {
    id: 'campeonato-aviso', label: 'Campeonato — aviso aos participantes',
    help: 'Mensagem avulsa a quem está inscrito num campeonato em andamento (você aprova o público antes do envio).',
    draft: {
      name: 'Campeonato: comunicado', description: 'Comunicado aos participantes.', objective: 'Informar os inscritos.',
      source: 'championship_notice', trigger_type: 'manual', definition: { championship_id: '' }, schedule: {},
      message_body: `Olá, {{nome}}! Comunicado do {{campeonato}} ({{classe}}): `,
    },
  },
  {
    id: 'campeonato-resultado', label: 'Campeonato — resultado de partida',
    help: 'Quando o resultado de uma partida é registrado e fica estável, avisa os jogadores.',
    draft: {
      name: 'Campeonato: resultado registrado', description: 'Aviso de resultado.', objective: 'Dar transparência ao resultado.',
      source: 'championship_result', trigger_type: 'event', definition: { settle_minutes: 10 }, schedule: {},
      message_body: `Olá, {{nome}}! Resultado registrado no {{campeonato}} ({{fase}}) contra {{adversario}}: {{placar}} — {{resultado}}.`,
    },
  },
  {
    id: 'campeonato-avanco', label: 'Campeonato — avanço de fase',
    help: 'Quando o chaveamento define a próxima partida, avisa o jogador.',
    draft: {
      name: 'Campeonato: próxima fase', description: 'Aviso de classificação.', objective: 'Avisar o próximo confronto.',
      source: 'championship_advance', trigger_type: 'event', definition: { settle_minutes: 10 }, schedule: {},
      message_body: `Olá, {{nome}}! Você avançou no {{campeonato}}. Próxima fase: {{fase}}, adversário: {{adversario}}.`,
    },
  },
  {
    id: 'aviso-publico', label: 'Aviso a um público',
    help: 'Mensagem avulsa a sócios, alunos, professores… (você aprova o público antes do envio).',
    draft: {
      name: 'Aviso aos sócios', description: 'Comunicado do clube.', objective: 'Comunicar o clube.',
      source: 'audience', trigger_type: 'manual', definition: { audience: 'members' }, schedule: {},
      message_body: `Olá, {{nome}}! Aqui é o ${clube}. `,
    },
  },
];

export const templateById = (id: string): AutomationTemplate | undefined => TEMPLATES.find((t) => t.id === id);

/** `{{a}} {{b}}` → ['a','b'] (mesma regra do banco: minúsculas e `_`). */
export function templateVars(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) out.add(m[1]);
  return [...out];
}

/** Variáveis do texto que a origem não aceita. */
export const unknownVars = (source: AutomationSource, body: string): string[] =>
  templateVars(body).filter((v) => !VARS_BY_SOURCE[source].includes(v));

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validação de apoio (o banco repete e é quem decide). Devolve frases para a pessoa. */
export function draftProblems(d: AutomationDraft): string[] {
  const out: string[] = [];
  if (d.name.trim().length < 3) out.push('Dê um nome com pelo menos 3 letras.');
  if (!d.message_body.trim()) out.push('Escreva a mensagem.');
  for (const v of unknownVars(d.source, d.message_body)) out.push(`A variável {{${v}}} não existe para este tipo de automação.`);
  if (!TRIGGERS_BY_SOURCE[d.source].includes(d.trigger_type)) out.push('Esta origem não aceita este tipo de disparo.');
  if (d.source === 'finance_charge' && !FINANCE_STAGES.some((s) => s.id === d.definition.stage)) out.push('Escolha o momento da mensalidade.');
  if ((d.source === 'championship_notice' || (d.source === 'audience' && d.definition.audience === 'championship_participants')) && !d.definition.championship_id) {
    out.push('Escolha o campeonato.');
  }
  if (d.source === 'audience' && !AUDIENCES.some((a) => a.id === d.definition.audience)) out.push('Escolha o público.');
  if (d.trigger_type === 'scheduled') {
    if (!d.schedule.time || !HHMM.test(d.schedule.time)) out.push('Informe o horário de envio (HH:MM).');
    const datas = d.schedule.dates ?? [];
    if (datas.length === 0 && !(d.schedule.weekdays && d.schedule.weekdays.length > 0)) out.push('Escolha os dias da semana ou datas específicas.');
  }
  return out;
}

/** Texto curto "quando roda" para a lista. */
export function describeSchedule(a: { trigger_type: AutomationTrigger; schedule: AutomationSchedule }): string {
  if (a.trigger_type === 'manual') return 'Só quando você disparar';
  if (a.trigger_type === 'event') return 'Quando o evento acontece (confere todo dia)';
  if (a.trigger_type === 'conditional') return 'Confere todo dia';
  const hora = a.schedule.time ?? '--:--';
  const datas = a.schedule.dates ?? [];
  if (datas.length > 0) return `Em ${datas.map((d) => d.split('-').reverse().slice(0, 2).join('/')).join(', ')} às ${hora}`;
  const dias = (a.schedule.weekdays ?? []).slice().sort().map((d) => WEEKDAYS[d]).join(', ');
  return `${dias || 'sem dias'} às ${hora}${a.schedule.end_date ? ` · até ${a.schedule.end_date.split('-').reverse().join('/')}` : ''}`;
}

/** Renderização local só para a edição: troca `{{x}}` pelos exemplos. O envio real usa os dados do banco. */
export function renderExample(body: string, example: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, k: string) => example[k] ?? all);
}

export const EXAMPLE_VALUES: Record<string, string> = {
  nome: 'Maria', clube, competencia: 'outubro/2026', vencimento: '10/10/2026', valor: 'R$ 150,00', total: 'R$ 150,00', dias_atraso: '5',
  encargos: 'R$ 3,50', dias_para_vencer: '5', dias_vencido: '3', campeonato: 'Copa Saibro', classe: '3ª Classe', fase: 'Quartas de final',
  adversario: 'João', placar: '6/4 6/3', resultado: 'vitória',
};
