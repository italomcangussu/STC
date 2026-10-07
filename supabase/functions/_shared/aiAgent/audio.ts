// O que o João "ouviu": troca o corpo dos áudios da conversa pelo texto transcrito (meta.transcription,
// gravado pelo whatsapp-webhook) só na cópia que vai para o modelo. A mensagem no banco não muda.
//
// A transcrição leva alguns segundos. Se a pessoa manda um áudio e logo um texto, o turno do texto pode
// começar antes de o áudio estar pronto: aqui ele espera um pouco pelos áudios recentes ainda sem texto,
// em vez de responder sem saber o que foi dito.

import type { Ctx } from './prompts.ts';

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error?: unknown }>;
type Heard = { status?: string; text?: string; low_confidence?: boolean };

export type AudioStatus = 'ok' | 'unclear' | 'failed';

export const AUDIO_KINDS = ['audio', 'ptt'];
const PLACEHOLDER = /^🎤\s*Áudio$|^🎵\s*Áudio$/u;
const WAIT_MS = 4000;
const MAX_WAITS = 6;
/** Áudio mais velho que isto sem transcrição não vai chegar: segue sem ele. */
const RECENT_MS = 90_000;

export function audioBody(original: string, heard: Heard | null | undefined): { body: string; status: AudioStatus } {
  const legenda = PLACEHOLDER.test(original.trim()) ? '' : original.trim();
  const extra = legenda ? ` (legenda: ${legenda})` : '';
  if (heard?.status === 'ok' && heard.text) {
    return { status: 'ok', body: `[áudio${heard.low_confidence ? ', reconhecimento incerto' : ''}] ${heard.text}${extra}` };
  }
  if (heard?.status === 'unclear') return { status: 'unclear', body: `[áudio que não deu para entender]${extra}` };
  return { status: 'failed', body: `[áudio que não foi transcrito]${extra}` };
}

export async function hearAudios(transcript: Ctx[], deps: { db: Rpc; sleep(ms: number): Promise<void>; now?: () => number }): Promise<Ctx[]> {
  const ids = transcript.filter((t) => t.direction === 'inbound' && AUDIO_KINDS.includes(String(t.kind))).map((t) => String(t.id));
  if (!ids.length) return transcript;
  const now = deps.now ?? Date.now;
  let heard = new Map<string, Heard>();
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      const r = await deps.db('conv_svc_ai_audio_transcripts', { p_ids: ids });
      const rows = Array.isArray(r.data) ? r.data as { id: string; transcription: Heard | null }[] : [];
      heard = new Map(rows.filter((x) => x.transcription).map((x) => [String(x.id), x.transcription as Heard]));
    } catch { /* sem a função: os áudios seguem como não transcritos */ }
    const esperando = transcript.some((t) => ids.includes(String(t.id)) && !heard.has(String(t.id))
      && now() - new Date(String(t.created_at)).getTime() < RECENT_MS);
    if (!esperando || tentativa >= MAX_WAITS) break;
    await deps.sleep(WAIT_MS);
  }
  return transcript.map((t) => {
    if (!ids.includes(String(t.id))) return t;
    const { body, status } = audioBody(String(t.body ?? ''), heard.get(String(t.id)));
    return { ...t, body, audio: status };
  });
}

/** Tudo o que a pessoa mandou desde a última fala do João é áudio e nenhum foi entendido. */
export function unheardOnly(pendentes: Ctx[]): AudioStatus | null {
  if (!pendentes.length || !pendentes.every((t) => t.audio)) return null;
  if (pendentes.some((t) => t.audio === 'ok')) return null;
  return pendentes.some((t) => t.audio === 'failed') ? 'failed' : 'unclear';
}

export const UNCLEAR_AUDIO_REPLY = 'Não consegui entender seu áudio 😕 Pode mandar de novo, mais pertinho do celular, ou escrever aqui?';
