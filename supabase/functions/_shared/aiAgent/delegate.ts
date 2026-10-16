// Assessor de professor (outro agente de IA falando em nome do professor; `conv_contact_delegates`).
// Dois robôs conversando podem se responder para sempre: estas regras puras decidem quando o João fica quieto.

type Ctx = Record<string, unknown>;

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const COURTESY = /^(ok(ay)?|certo|beleza|blz|perfeito|otimo|show|combinado|fechado|entendido|entendi|anotado|obrigad[oa]|muito obrigad[oa]|valeu|vlw|de nada|por nada|disponha|tudo bem|tudo certo|imagina|igualmente|bom dia|boa tarde|boa noite|ate mais|abracos?|grato|grata|agradeco)$/;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** Mensagem só de cortesia (agradecimento, "ok", emoji), sem pedido nem pergunta: não merece resposta entre robôs. */
export function isCourtesyOnly(text: string): boolean {
  const bruto = fold(text);
  if (!bruto || bruto.length > 120 || bruto.includes('?')) return false;
  const partes = bruto.replace(EMOJI, ' ').split(/[\n.!,;]+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return partes.every((p) => COURTESY.test(p) || p === 'joao');
}

export const DELEGATE_WINDOW_MIN = 10;
export const DELEGATE_MAX_REPLIES = 8;

/** Já respondeu demais nos últimos minutos (contados a partir da mensagem mais recente): sinal de laço entre robôs. */
export function delegateOverLimit(transcript: Ctx[]): boolean {
  const tempos = transcript.map((t) => Date.parse(String(t.created_at ?? ''))).filter((n) => Number.isFinite(n));
  if (!tempos.length) return false;
  const desde = Math.max(...tempos) - DELEGATE_WINDOW_MIN * 60_000;
  const respostas = transcript.filter((t) => t.direction === 'outbound' && t.origin === 'ai' && Date.parse(String(t.created_at ?? '')) >= desde);
  return respostas.length >= DELEGATE_MAX_REPLIES;
}

/** Motivo para o João ficar quieto com o assessor (laço ou só cortesia), ou null para responder. */
export function delegateSilence(transcript: Ctx[], text: string): 'delegate_rate_limit' | 'delegate_courtesy' | null {
  if (delegateOverLimit(transcript)) return 'delegate_rate_limit';
  return isCourtesyOnly(text) ? 'delegate_courtesy' : null;
}
