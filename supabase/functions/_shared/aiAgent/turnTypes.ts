// Tipos e vocabulário do turno do João: dependências injetadas, dados do pedido (slots), ações e resposta do modelo.

import type { AdminPlan } from './adminPlan.ts';
import type { AdminReadDomain } from './adminReads.ts';
import type { Chat } from './llm.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import type { Ctx } from './promptTypes.ts';
import type { FileKind, FileKit } from './adminFiles.ts';
import type { Provision } from '../athleteProvision.ts';
import type { TopicMode, TopicSnapshot } from './topicState.ts';
import type { UazCaller } from '../uazChat.ts';
import type { ReceiptForward } from './receiptForward.ts';
import { participantes } from './decide.ts';

export type RpcResult = { data: unknown; error: { message: string } | null };
export type Db = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

export type TurnDeps = {
  db: Db;
  chat: Chat | null;
  uaz: UazCaller | null;
  sleep: (ms: number) => Promise<void>;
  /** Cria o acesso do sócio novo no Auth + perfil (só a borda alcança o Auth). Sem isso o João não cadastra sócio. */
  provision?: Provision;
  /** Turno disparado pela mídia (comprovante já lido): só vale para administrador no privado; o resto não responde por aqui. */
  mediaOnly?: boolean;
  /** Gera PDF e entrega arquivos ao administrador no privado. Sem isso o João diz que não consegue gerar o arquivo agora. */
  files?: FileKit;
};

export type Slots = {
  type?: 'Play' | 'Aula' | null;
  date?: string | null;
  start?: string | null;
  /** Janela para consultas de disponibilidade. Ex.: noite = 18:00–23:00. */
  availability_from?: string | null;
  availability_to?: string | null;
  duration?: number | null;
  court_label?: string | null;
  participant_names?: string[];
  participants_known?: boolean;
  guest_name?: string | null;
  professor_name?: string | null;
  student_names?: string[];
  /** Aulas em lote (professor ou assessor): a lista inteira de uma vez. */
  lessons?: Lesson[];
  reservation_ref?: string | null;
  /** Mexer nos atletas de uma reserva existente (sair, retirar, adicionar). */
  add_names?: string[];
  remove_names?: string[];
  remove_guest?: boolean;
  /** Plano em passos de um pedido composto do administrador (vive no assunto até o último passo). */
  plan?: AdminPlan | null;
  /** Assessor administrativo (só administrador, no privado). */
  fin_action?: FinAction | null;
  member_name?: string | null;
  description?: string | null;
  /** Valor em reais, como a pessoa disse. */
  amount?: number | null;
  due_date?: string | null;
  pendency_kind?: PendencyKind | null;
  guest_date?: string | null;
  send_now?: boolean;
  pendency_ref?: string | null;
  paid_on?: string | null;
  method?: PayMethod | null;
  account_name?: string | null;
  /** Consultas do assessor (Onda 1): domínio e período. */
  /** Onda 2 (financeiro N2). */
  reason?: string | null;
  adjust_kind?: typeof ADJUST_KINDS[number] | null;
  category_name?: string | null;
  /** O administrador pediu (ou aceitou) criar category_name como categoria nova. */
  category_new?: boolean;
  /** Sócio novo que entrou no meio do mês: o que pagou agora, em reais (amount segue sendo a mensalidade cheia). */
  first_amount?: number | null;
  receipt_date?: string | null;
  entry_status?: 'paid' | 'pending' | null;
  /** Onda 3 (administrativo N1). */
  adm_action?: AdmAction | null;
  ann_title?: string | null;
  ann_message?: string | null;
  active?: boolean | null;
  doc_title?: string | null;
  by_name?: string | null;
  /** Onda 7 (cadastro de sócio). */
  phone?: string | null;
  email?: string | null;
  /** Dependente de sócio: nome do dependente e parentesco (member_name = sócio responsável). */
  dependent_name?: string | null;
  relationship?: 'esposa' | 'esposo' | 'filho' | 'filha' | 'outro' | null;
  /** Aluno novo (aluno_criar): nome, plano (mensalista, Mensalista Kids = metade, Day Card) e se já pagou. */
  student_name?: string | null;
  student_plan?: 'mensalista' | 'kids' | 'day_card' | null;
  paid?: boolean | null;
  /** Onda 8 (retornos, bloqueio de quadra, preferências). */
  note?: string | null;
  send_body?: string | null;
  pref?: 'resumo' | 'estilo' | 'alertas' | 'saldo_minimo' | 'dias_atraso' | 'conta_padrao' | null;
  pref_value?: string | null;
  /** Aniversário que o administrador contou ("14/01"): dia/mês, sem ano. */
  birthday?: string | null;
  read_domain?: AdminReadDomain | null;
  /** Formulários do clube: qual (nome ou parte do nome), título e perguntas do novo, votação secreta, resposta múltipla. */
  form_ref?: string | null;
  form_title?: string | null;
  form_questions?: FormQuestionSlot[] | null;
  form_secret?: boolean | null;
  form_multiple?: boolean | null;
  /** Pedido de arquivo ao administrador: relatório em PDF, comprovante de sócio, anexo de despesa ou documento de assinatura. */
  file_kind?: FileKind | null;
  read_from?: string | null;
  read_to?: string | null;
  /** Campeonato com inscrição pelo João: o que a pessoa quer e os dados do atleta. */
  champ_action?: ChampAction | null;
  athlete_name?: string | null;
  /** O atleta é a própria pessoa que fala (telefone = o dela, já confirmado na conversa). */
  athlete_self?: boolean;
  athlete_phone?: string | null;
  athlete_city?: string | null;
  champ_class?: string | null;
  shirt_size?: string | null;
  /** Administrador: cabeças de chave na ordem (o primeiro é o cabeça 1). */
  seed_names?: string[];
};

export const CHAMP_ACTIONS = ['info', 'inscrever', 'camisa', 'cabecas', 'sortear'] as const;
export type ChampAction = typeof CHAMP_ACTIONS[number];

/** Pergunta de formulário como o servidor a entende: o modelo só transcreve o que o administrador ditou. */
export type FormQuestionSlot = { title: string; type: 'single_choice' | 'multiple_choice' | 'open_text'; required: boolean; options: string[] };
export const QUESTION_TYPES: Record<string, FormQuestionSlot['type']> = { unica: 'single_choice', multipla: 'multiple_choice', texto: 'open_text',
  single_choice: 'single_choice', multiple_choice: 'multiple_choice', open_text: 'open_text' };

export type FinAction = 'lancar' | 'cobrar' | 'pausar' | 'retomar' | 'baixa' | 'renovar_card'
  | 'cancelar_pendencia' | 'ajustar' | 'estornar' | 'rejeitar_comprovante' | 'despesa' | 'receita' | 'aprovar_comprovante' | 'gerar_cobrancas';
export type PendencyKind = 'day_card' | 'consumo' | 'evento' | 'multa' | 'dano_reposicao' | 'outros';
export type PayMethod = 'pix' | 'transfer' | 'cash' | 'card' | 'other';
export const FIN_ACTIONS: FinAction[] = ['lancar', 'cobrar', 'pausar', 'retomar', 'baixa', 'renovar_card',
  'cancelar_pendencia', 'ajustar', 'estornar', 'rejeitar_comprovante', 'despesa', 'receita', 'aprovar_comprovante', 'gerar_cobrancas'];
export const ADM_ACTIONS = ['aviso', 'aviso_desativar', 'aluno_status', 'socio_status', 'assinatura_reenviar', 'reserva_cancelar', 'acesso_aprovar', 'acesso_recusar', 'socio_criar',
  'followup_criar', 'followup_concluir', 'quadra_bloquear', 'preferencia', 'dependente_criar', 'mensagem_enviar', 'comunicado_enviar', 'resumo_destinatario', 'memoria_esquecer',
  'formulario_criar', 'formulario_status', 'formulario_cobrar', 'aniversario', 'resenha_grupo', 'aluno_criar'] as const;
export type AdmAction = typeof ADM_ACTIONS[number];
export const ADJUST_KINDS = ['discount', 'increase', 'fee_waiver'] as const;
export const PENDENCY_KINDS: PendencyKind[] = ['day_card', 'consumo', 'evento', 'multa', 'dano_reposicao', 'outros'];
export const PAY_METHODS: PayMethod[] = ['pix', 'transfer', 'cash', 'card', 'other'];

export type Intent = 'reservar' | 'cancelar' | 'remarcar' | 'consultar' | 'consultar_disponibilidade' | 'informar' | 'entrar' | 'participantes' | 'aulas_lote' | 'admin_financeiro' | 'admin_consulta' | 'admin_acao' | 'campeonato' | 'outro';

export type Lesson = { date: string; start: string; end: string | null; student_names: string[] };

export type Answer = {
  messages: string[];
  intent: Intent;
  slots: Slots;
  ready: boolean;
  customer_confirmed: boolean;
  declined: boolean;
  awaiting: boolean;
  transfer: boolean;
  handoff_kind: 'soft' | 'hard' | null;
  handoff_note: string | null;
  close: boolean;
  /** 'new' apenas quando realmente iniciar outro assunto; 'resume' recupera pendência anterior. */
  topic_mode?: TopicMode;
  /** Referência do assunto pendente (t1, t2…) a que a fala se refere, quando há mais de um. */
  topic_ref?: string | null;
  /** Pedido do administrador sem ação única no catálogo: o plano em passos (já validado contra o catálogo). */
  plan?: AdminPlan | null;
  /** Resumo compactado da conversa (o agente reescreve a cada turno); ausente = manter o anterior. */
  summary?: string | null;
  /** Aprendizados sociais candidatos; o servidor só registra como pendentes para revisão. */
  memory_candidates?: { subject_name: string; kind: string; content: string; confidence?: number }[];
  /** Emoji que o servidor coloca na mensagem da pessoa (como um amigo que curte). Só os da lista `REACTIONS`. */
  reaction?: string | null;
  /** No grupo, citaram alguém de quem o João não sabe nada: ele pergunta ao presidente no privado (o servidor freia). */
  ask_curator?: { subject_name: string; question: string } | null;
  /** Assessor de outro assistente: a mensagem não pede nada (aviso, "vou conferir e te mando"); o João não responde. */
  silent?: boolean;
};

/** Reações que o João pode dar. O modelo escolhe; o servidor só aceita estas (e nunca reage em nome de outro assunto). */
/** Teto da resposta do modelo: o assessor administrativo devolve planos e dados de formulário, maiores que um pedido de quadra. */
export const answerBudget = (ctx: Ctx) => (isAdminAssistant(ctx) ? 1800 : 900);

export const first = <T,>(r: RpcResult): T | null => (Array.isArray(r.data) ? (r.data[0] as T) ?? null : (r.data as T) ?? null);

export type TurnResult = { status: string; reason?: string; bubbles?: number; handoff?: string | null; action?: string | null };

export type Memory = { intent?: Intent; slots?: Slots; proposal_names?: string[]; pending_guest?: string | null; summary?: string;
  /** Assuntos do solicitante (pendentes completos + encerrados recentes) e o que está em andamento agora. */
  topics?: TopicSnapshot[]; active_topic_id?: string | null; [k: string]: unknown };

export type Decision = { bubbles: string[]; awaiting: boolean; close: boolean; action: string | null; memory: Memory; handoff?: { kind: 'soft' | 'hard'; note: string };
  /** Dados do assunto depois do turno, quando o servidor os muda (passo do plano). */ slots?: Slots;
  /** Relatório do servidor: vai numa mensagem só, com as quebras de linha (sem picotar em microbolhas). */ verbatim?: boolean;
  /** Arquivos para o administrador (já copiados para a mídia da conversa): saem como documento depois da fala. */ files?: OutFile[];
  /** Pix conferido no turno (inscrição com comprovante guardado): a fala sai firme e o financeiro recebe o aviso. */ forward?: ReceiptForward };

/** `kind` image sai como foto (a camisa do campeonato); sem ele, como documento. */
export type OutFile = { path: string; name: string; mime: string; caption: string; kind?: 'image' | 'document' };
