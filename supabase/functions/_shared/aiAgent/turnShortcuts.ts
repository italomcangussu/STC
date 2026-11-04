// Antes do modelo: casos que o servidor resolve sozinho (sem gastar chamada e sem deixar o modelo inventar).
// Ordem importa: silêncio de assessor, configuração, pedido de humano, áudio, figurinha, comprovante, mídia, N3.

import { n3Reply } from './capabilities.ts';
import { mySignups } from './championshipPrompt.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import { actingFor } from './promptContext.ts';
import type { Ctx } from './promptTypes.ts';
import { type ReceiptStage, handleReceiptIntent, loadReceiptStage } from './receiptIntent.ts';
import { deliverForward, forwardMembershipReview, tryMembershipAutoPay } from './receiptForward.ts';
import { type ChampReceipt, HOLD, tryChampionshipPay } from './championshipReceipt.ts';
import { membershipReference, receiptEvidence, receiptTopic, talksAboutOwnMembership } from './receiptContext.ts';
import { UNCLEAR_AUDIO_REPLY, unheardOnly } from './audio.ts';
import { cadence } from './cadence.ts';
import { delegateSilence } from './delegate.ts';
import { receiptReceivedMessage } from './studentCard.ts';
import { wantsHuman } from './serverRules.ts';
import type { Turn } from './turnKit.ts';
import type { TurnResult } from './turnTypes.ts';

/** Avisos de algo que o servidor já fez com o comprovante: saem mesmo se a pessoa escreveu de novo no meio. */
const DONE = new Set(['receipt_championship_paid', 'receipt_membership_paid', 'receipt_escalated', 'receipt_registered', 'receipt_donation_registered', 'receipt_pending_review']);

const onlyKinds = (t: Turn, kinds: string[]) => t.pendentes.every((m) => kinds.includes(String(m.kind)));
const receiptAttachment = (t: Turn) => t.pendentes.filter(m => m.kind === 'image' || m.kind === 'document').slice(-1)[0];
const receiptSenderName = (t: Turn) => String(((t.ctx.requester as Ctx | undefined)?.profile as Ctx | undefined)?.name ?? '');
const receiptToday = (t: Turn) => t.today ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
const receiptMediaTurn = (t: Turn) => t.deps.mediaOnly === true || t.soMidia || Boolean(receiptAttachment(t));

/** Áudio que não deu para ouvir: transcrição falhou → equipe ouve; ruído ou fala inaudível → pede de novo. */
function unheardAudio(t: Turn): Promise<TurnResult> | null {
  const naoOuvido = unheardOnly(t.pendentes);
  if (!naoOuvido) return null;
  if (naoOuvido === 'failed' && !t.isGroup) {
    return t.transferir('hard', 'Chegou áudio e a transcrição automática falhou; ouça na conversa.', null, { texto: 'Não consegui ouvir seu áudio. Pode escrever, ou mandar de novo?' });
  }
  return t.say([UNCLEAR_AUDIO_REPLY], 'audio_unclear', (sent) => ({ bubbles: sent }), { awaiting: true, action: 'audio_unclear' });
}

/**
 * Comprovante no privado: o OCR apenas prepara a leitura; finalidade e consentimento são obrigatórios.
 * Prioridade sobre o antigo fluxo de Card Mensal: evita classificação por valor e por cobrança aberta.
 * Administrador não passa por aqui: o comprovante dele é despesa ou pagamento de terceiro, tratado pelo assessor.
 */
async function memberReceipt(t: Turn): Promise<TurnResult | null> {
  if (t.isGroup || isAdminAssistant(t.ctx)) return null;
  const { db } = t.deps;
  const attachment = receiptAttachment(t);
  const mediaOnly = receiptMediaTurn(t);
  const comprovanteDaVez = attachment?.id as string | undefined;
  let stage: ReceiptStage | null = null;
  try {
    stage = await loadReceiptStage({ db, conversation: t.conversation, mediaMessageId: comprovanteDaVez, sleep: t.deps.sleep });
  } catch { /* implantação parcial: fluxo geral continua; jamais força baixa */ }
  if (!stage) return null;
  const handled = await handleReceiptIntent({
    stage, messageId: t.ultima?.id as string | undefined, mediaOnly, text: t.buffered, transcript: (t.ctx.transcript ?? []) as Ctx[],
    db, chat: t.deps.chat, model: t.settings.model, today: t.today,
    ownName: receiptSenderName(t),
  });
  if (!handled) return null;
  const sent = await t.entregar(cadence(handled.messages), { firme: DONE.has(handled.action) });
  const repassadas = handled.forward ? await deliverForward(handled.forward, { db, uaz: t.deps.uaz, signedUrl: t.deps.files?.signedUrl }) : 0;
  await t.save(t.sessionMemory, handled.action, { receipt_stage_id: stage.id, bubbles: sent, forwarded: repassadas }, { awaiting: true, close: false });
  return { status: 'replied', bubbles: sent, handoff: null, action: handled.action } as TurnResult;
}

/**
 * Comprovante da inscrição no campeonato, pelo contexto da conversa:
 *  · administrador manda o Pix (ele também se inscreve e inscreve atletas): antes de tratar como despesa ou Card, confere
 *    se é o pagamento das inscrições que ele deixou esperando (sócio comum passa por autoPay, no fluxo do comprovante);
 *  · qualquer pessoa, DEPOIS do comprovante, fala da inscrição ("é da inscrição", "estou inscrito?"): o comprovante que
 *    ainda espera finalidade é conferido contra as inscrições dela. Na conversa de texto só a confirmação responde; a
 *    explicação de valor diferente fica para quando o comprovante chega.
 */
async function stageFor(t: Turn): Promise<ReceiptStage | null> {
  const mediaMessageId = receiptAttachment(t)?.id as string | undefined;
  try { return await loadReceiptStage({ db: t.deps.db, conversation: t.conversation, mediaMessageId, sleep: t.deps.sleep }); } catch { return null; }
}

async function championshipReceipt(t: Turn): Promise<TurnResult | null> {
  if (t.isGroup) return null;
  const comMidia = t.soMidia && onlyKinds(t, ['image', 'document']);
  const topic = receiptTopic((t.ctx.transcript ?? []) as Ctx[]);
  if (topic !== 'campeonato') return null;
  if (comMidia && !isAdminAssistant(t.ctx)) return null;
  const stage = await stageFor(t);
  if (stage?.status !== 'awaiting_purpose') return null;
  const pago = await tryChampionshipPay(t.deps.db, stage.id, topic);
  // Guardar o comprovante é para o atleta; o administrador sem inscrição pendente segue para o fluxo dele (despesa).
  if (!pago || !deliverSignupInTurn({ receipt: pago, mediaOnly: comMidia })) return null;
  return deliverAutoReceipt(t, pago, stage.id);
}

function deliverSignupInTurn(input: { receipt: ChampReceipt | null; mediaOnly: boolean }): boolean {
  if (!input.receipt || input.receipt.action === HOLD) return false;
  return input.mediaOnly || input.receipt.action === 'receipt_championship_paid';
}

/** Fala com a pessoa e avisa o financeiro (menos quando o financeiro é quem está na conversa). */
async function deliverAutoReceipt(t: Turn, pago: ChampReceipt, stageId: string): Promise<TurnResult> {
  const sent = await t.entregar(cadence(pago.messages), { firme: DONE.has(pago.action) });
  const avisar = pago.forward && pago.forward.admin_conversation_id !== t.conversation;
  const repassadas = avisar ? await deliverForward(pago.forward!, { db: t.deps.db, uaz: t.deps.uaz, signedUrl: t.deps.files?.signedUrl }) : 0;
  await t.save(t.sessionMemory, pago.action, { receipt_stage_id: stageId, bubbles: sent, forwarded: repassadas }, { awaiting: false, close: false });
  return { status: 'replied', bubbles: sent, handoff: null, action: pago.action } as TurnResult;
}

/** Administrador manda o comprovante: o servidor já leu (valor, data, favorecido); o João responde com o que leu, sem equipe. */
async function adminReceipt(t: Turn): Promise<TurnResult | null> {
  // Texto depois do comprovante: "referente à mensalidade de novembro de Hermeson Veras".
  if (!t.soMidia) return adminOwnMembership(t);
  if (t.isGroup || !isAdminAssistant(t.ctx) || !t.ultima?.id || !onlyKinds(t, ['image', 'document'])) return null;
  const lido = await readAdminReceipt(t, t.ultima.id as string);
  const propria = isFreshReceipt(lido) ? await adminOwnMembership(t) : null;
  if (propria) return propria;
  return t.say([receiptReceivedMessage(lido, receiptTopic((t.ctx.transcript ?? []) as Ctx[]))], 'admin_receipt_received', () => ({ found: lido?.found === true }), { awaiting: true, action: 'admin_receipt_received' });
}

/** A leitura do comprovante chega alguns segundos depois da mídia: tenta por até ~10 s. */
async function readAdminReceipt(t: Turn, messageId: string): Promise<Ctx | null> {
  let lido: Ctx | null = null;
  for (let tentativa = 0; tentativa < 6 && !lido?.found; tentativa++) {
    if (tentativa) await t.deps.sleep(2000);
    lido = (await t.deps.db('conv_svc_ai_admin_receipt', { p_session: t.session, p_message: messageId })).data as Ctx | null;
  }
  return lido;
}

const isFreshReceipt = (r: Ctx | null) => r?.found === true && r.duplicate !== true && r.status !== 'approved';

/**
 * Administrador que também é sócio manda o Pix da PRÓPRIA mensalidade (Hermeson, 03/11: "quero te enviar meu comprovante da
 * mensalidade de novembro" e o João perguntou de qual aluno era o Card). A baixa automática confere valor exato, favorecido e
 * duplicado; só tenta quando o assunto recente é mensalidade e ele disse que é a dele (na legenda, antes ou logo depois do arquivo).
 */
async function adminOwnMembership(t: Turn): Promise<TurnResult | null> {
  if (t.isGroup || !isAdminAssistant(t.ctx)) return null;
  const falaAgora = t.soMidia ? [] : [{ direction: 'inbound', body: t.buffered } as Ctx];
  const stage = await stageFor(t);
  if (stage?.status !== 'awaiting_purpose') return null;
  const transcript = receiptEvidence([...((t.ctx.transcript ?? []) as Ctx[]), ...falaAgora], stage);
  const nome = receiptSenderName(t);
  if (receiptTopic(transcript) !== 'mensalidade' || !talksAboutOwnMembership(transcript, nome)) return null;
  const reference = membershipReference(transcript, receiptToday(t));
  if (reference.ambiguous) return t.say(['Esse comprovante é de quais meses? Ainda não dei baixa.'], 'receipt_membership_review', () => ({}), { awaiting: true });
  const pago = await tryMembershipAutoPay(t.deps.db, stage.id, { month: reference.month, purpose_kind: 'membership' });
  if (!pago) return null;
  const result = await forwardMembershipReview({ db: t.deps.db, stage: stage.id, message: t.ultima?.id as string, month: reference.month, receipt: pago });
  return deliverAutoReceipt(t, result, stage.id);
}

/** Mídia sem texto no privado, sem comprovante em jogo: o João não lê mídia e diz isso. */
const unreadableMedia = (t: Turn) => t.transferir('hard', `Chegou ${[...new Set(t.pendentes.map((m) => m.kind))].join(', ')} sem texto; a IA não lê mídia.`, null,
  { texto: 'Recebi, mas não consigo ver imagem ou documento por aqui. Pode me dizer em texto o que você precisa?' });

/**
 * Foto de quem tem inscrição esperando o Pix, mas que não virou comprovante (a leitura falhou: Emanuel, 28/10, ficou sem
 * resposta). O João avisa que recebeu e que a equipe confere, em vez de ficar mudo.
 */
const UNCHECKED = 'Recebi seu comprovante 🧾 Não consegui conferir pelo sistema agora; a equipe vai conferir e eu te confirmo a inscrição por aqui.';
function uncheckedSignupReceipt(t: Turn): Promise<TurnResult> | null {
  if (!mySignups(t.ctx).some((s) => s.status === 'pre')) return null;
  return t.say([UNCHECKED], 'receipt_championship_unchecked', (sent) => ({ bubbles: sent }), { action: 'receipt_championship_unchecked' });
}

/** Resposta do servidor quando o turno não precisa do modelo; null segue para o modelo. */
export async function beforeModel(t: Turn): Promise<TurnResult | null> {
  const { ctx, deps, isGroup, buffered, settings } = t;
  // Assessor de professor (outro robô): não responde cortesia nem entra em laço de resposta.
  const quieto = !isGroup && actingFor(ctx) ? delegateSilence((ctx.transcript ?? []) as Ctx[], t.soMidia ? '' : buffered) : null;
  if (quieto) {
    await t.save(t.sessionMemory, quieto, {}, { awaiting: false, close: false });
    return { status: 'skip', reason: quieto };
  }
  if (!deps.chat || !settings.model) return t.transferir('hard', 'Agente de IA sem provedor ou modelo configurado.', null, { falar: t.socioNoPrivado });
  // max_turns é um limiar para resumir contexto, NUNCA para interromper um assunto.
  if (wantsHuman(buffered, settings.handoff_keywords ?? [])) return t.transferir('hard', 'A pessoa pediu atendimento humano.', null);
  const audio = unheardAudio(t);
  if (audio) return audio;
  // Figurinha sozinha é reação, não pedido: não chama a equipe nem responde.
  if (t.soMidia && !isGroup && onlyKinds(t, ['sticker'])) return t.say([], 'sticker_ignored', () => ({}), { action: 'sticker_ignored' });
  const inscricao = await championshipReceipt(t);
  if (inscricao) return inscricao;
  const receipt = await memberReceipt(t);
  if (receipt) return receipt;
  // Mídia solta de quem não é administrador, sem comprovante em análise: segue só pelo financeiro, o João não pergunta nada.
  if (deps.mediaOnly && !isAdminAssistant(ctx)) return uncheckedSignupReceipt(t) ?? { status: 'skip', reason: 'media_only' };
  const admin = await adminReceipt(t);
  if (admin) return admin;
  if (t.soMidia && !isGroup) return unreadableMedia(t);
  // N3 (destrutivo ou de configuração): o assessor não executa por chat, só indica a tela do painel.
  const n3 = isAdminAssistant(ctx) ? n3Reply(buffered) : null;
  return n3 ? t.say([n3], 'admin_n3_refused', (sent) => ({ bubbles: sent }), { action: 'admin_n3_refused' }) : null;
}
