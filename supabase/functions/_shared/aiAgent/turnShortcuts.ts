// Antes do modelo: casos que o servidor resolve sozinho (sem gastar chamada e sem deixar o modelo inventar).
// Ordem importa: silêncio de assessor, configuração, pedido de humano, áudio, figurinha, comprovante, mídia, N3.

import { n3Reply } from './capabilities.ts';
import { isAdminAssistant } from './promptAdmin.ts';
import { actingFor } from './promptContext.ts';
import type { Ctx } from './promptTypes.ts';
import { type ReceiptStage, handleReceiptIntent, loadReceiptStage } from './receiptIntent.ts';
import { deliverForward } from './receiptForward.ts';
import { type ChampReceipt, tryChampionshipPay } from './championshipReceipt.ts';
import { receiptTopic } from './receiptContext.ts';
import { UNCLEAR_AUDIO_REPLY, unheardOnly } from './audio.ts';
import { cadence } from './cadence.ts';
import { delegateSilence } from './delegate.ts';
import { receiptReceivedMessage } from './studentCard.ts';
import { wantsHuman } from './serverRules.ts';
import type { Turn } from './turnKit.ts';
import type { TurnResult } from './turnTypes.ts';

const onlyKinds = (t: Turn, kinds: string[]) => t.pendentes.every((m) => kinds.includes(String(m.kind)));

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
  const mediaOnly = t.deps.mediaOnly === true || t.soMidia;
  const comprovanteDaVez = mediaOnly && (t.ultima?.kind === 'image' || t.ultima?.kind === 'document');
  let stage: ReceiptStage | null = null;
  try {
    stage = await loadReceiptStage({ db, conversation: t.conversation, mediaMessageId: comprovanteDaVez ? t.ultima?.id as string | undefined : undefined, sleep: t.deps.sleep });
  } catch { /* implantação parcial: fluxo geral continua; jamais força baixa */ }
  if (!stage) return null;
  const handled = await handleReceiptIntent({
    stage, messageId: t.ultima?.id as string | undefined, mediaOnly, text: t.buffered, transcript: (t.ctx.transcript ?? []) as Ctx[],
    db, chat: t.deps.chat, model: t.settings.model,
  });
  if (!handled) return null;
  const sent = await t.entregar(cadence(handled.messages));
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
async function stageFor(t: Turn, comMidia: boolean): Promise<ReceiptStage | null> {
  const mediaMessageId = comMidia ? t.ultima?.id as string : undefined;
  try { return await loadReceiptStage({ db: t.deps.db, conversation: t.conversation, mediaMessageId, sleep: t.deps.sleep }); } catch { return null; }
}

async function championshipReceipt(t: Turn): Promise<TurnResult | null> {
  if (t.isGroup) return null;
  const comMidia = t.soMidia && onlyKinds(t, ['image', 'document']);
  const topic = receiptTopic((t.ctx.transcript ?? []) as Ctx[]);
  if (comMidia ? !isAdminAssistant(t.ctx) : topic !== 'campeonato') return null;
  const stage = await stageFor(t, comMidia);
  if (stage?.status !== 'awaiting_purpose') return null;
  const pago = await tryChampionshipPay(t.deps.db, stage.id, topic);
  if (!pago || (!comMidia && pago.action !== 'receipt_championship_paid')) return null;
  return deliverChampionshipReceipt(t, pago, stage.id);
}

/** Fala com a pessoa e avisa o financeiro (menos quando o financeiro é quem está na conversa). */
async function deliverChampionshipReceipt(t: Turn, pago: ChampReceipt, stageId: string): Promise<TurnResult> {
  const sent = await t.entregar(cadence(pago.messages));
  const avisar = pago.forward && pago.forward.admin_conversation_id !== t.conversation;
  const repassadas = avisar ? await deliverForward(pago.forward!, { db: t.deps.db, uaz: t.deps.uaz, signedUrl: t.deps.files?.signedUrl }) : 0;
  await t.save(t.sessionMemory, pago.action, { receipt_stage_id: stageId, bubbles: sent, forwarded: repassadas }, { awaiting: false, close: false });
  return { status: 'replied', bubbles: sent, handoff: null, action: pago.action } as TurnResult;
}

/** Administrador manda o comprovante: o servidor já leu (valor, data, favorecido); o João responde com o que leu, sem equipe. */
async function adminReceipt(t: Turn): Promise<TurnResult | null> {
  if (!t.soMidia || t.isGroup || !isAdminAssistant(t.ctx) || !t.ultima?.id || !onlyKinds(t, ['image', 'document'])) return null;
  let lido: Ctx | null = null;
  for (let tentativa = 0; tentativa < 6 && !lido?.found; tentativa++) {
    if (tentativa) await t.deps.sleep(2000);
    lido = (await t.deps.db('conv_svc_ai_admin_receipt', { p_session: t.session, p_message: t.ultima.id as string })).data as Ctx | null;
  }
  return t.say([receiptReceivedMessage(lido)], 'admin_receipt_received', () => ({ found: lido?.found === true }), { awaiting: true, action: 'admin_receipt_received' });
}

/** Mídia sem texto no privado, sem comprovante em jogo: o João não lê mídia e diz isso. */
const unreadableMedia = (t: Turn) => t.transferir('hard', `Chegou ${[...new Set(t.pendentes.map((m) => m.kind))].join(', ')} sem texto; a IA não lê mídia.`, null,
  { texto: 'Recebi, mas não consigo ver imagem ou documento por aqui. Pode me dizer em texto o que você precisa?' });

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
  if (deps.mediaOnly && !isAdminAssistant(ctx)) return { status: 'skip', reason: 'media_only' };
  const admin = await adminReceipt(t);
  if (admin) return admin;
  if (t.soMidia && !isGroup) return unreadableMedia(t);
  // N3 (destrutivo ou de configuração): o assessor não executa por chat, só indica a tela do painel.
  const n3 = isAdminAssistant(ctx) ? n3Reply(buffered) : null;
  return n3 ? t.say([n3], 'admin_n3_refused', (sent) => ({ bubbles: sent }), { action: 'admin_n3_refused' }) : null;
}
