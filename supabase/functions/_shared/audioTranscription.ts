// O João "ouve" áudio: a mensagem de voz vira texto no Whisper (Groq) antes de a IA ler a conversa.
//
// Não basta mandar o arquivo e confiar no texto. O Whisper inventa frases no silêncio ("Legendas pela
// comunidade Amara.org", "Obrigado por assistir") e repete trechos em ruído. Por isso a resposta vem em
// `verbose_json` e cada trecho é julgado pela confiança do próprio modelo: o que é silêncio ou
// alucinação cai fora, e o áudio inteiro é classificado como entendido, incerto ou inaudível.
// O prompt do Whisper leva o vocabulário do clube e a última fala do João: é isso que faz "sim",
// "quadra 2" e o nome do sócio saírem certos. O texto transcrito nunca vai para log.

export type TranscriptionStatus = 'ok' | 'unclear' | 'failed';

export type Transcription = {
  status: TranscriptionStatus;
  /** Só quando `ok`. */
  text?: string;
  /** Entendido, mas com trechos de baixa confiança: a IA confirma dados decisivos antes de agir. */
  low_confidence?: boolean;
  confidence?: number;
  model?: string;
  language?: string;
  seconds?: number;
  /** Motivo curto quando não deu certo (sem conteúdo do áudio). */
  reason?: string;
};

export type TranscribeInput = {
  bytes: Uint8Array;
  mime: string;
  fileName: string;
  /** Última fala do João/equipe na conversa: o Whisper usa como continuação. */
  previous?: string | null;
  /** Nomes que provavelmente aparecem (contato, clube). */
  names?: string[];
};

export type Transcriber = (input: TranscribeInput) => Promise<Transcription>;

type Segment = { text?: string; start?: number; end?: number; avg_logprob?: number; no_speech_prob?: number; compression_ratio?: number };
type Verbose = { text?: string; language?: string; duration?: number; segments?: Segment[] };

export const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const DEFAULT_MODELS = ['whisper-large-v3', 'whisper-large-v3-turbo'];
const MAX_BYTES = 25 * 1024 * 1024; // limite do Groq por arquivo

const VOCABULARY = 'Reserva de quadra, saibro, horário, Day Card, mensalidade, pendência, Pix, sócio, convidado, aula, professor, ranking, campeonato.';

/** Frases que o Whisper costuma inventar em silêncio/ruído (comparação sem acento e pontuação). */
const HALLUCINATIONS = [
  'legendas pela comunidade amara org', 'legenda adriana zanotto', 'legendas adriana zanotto', 'obrigado por assistir',
  'obrigada por assistir', 'inscreva se no canal', 'se inscreva no canal', 'deixe seu like', 'ate o proximo video',
  'transcricao e legendas', 'subtitles by the amara org community', 'thank you for watching', 'thanks for watching',
];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function whisperPrompt(input: Pick<TranscribeInput, 'previous' | 'names'>): string {
  const names = [...new Set((input.names ?? []).map((n) => n.trim()).filter(Boolean))].slice(0, 6);
  const partes = [`Conversa de WhatsApp com o João, assistente do clube de tênis${names.length ? ` (${names.join(', ')})` : ''}.`, VOCABULARY];
  const previous = (input.previous ?? '').replace(/\s+/g, ' ').trim();
  // O Whisper usa o fim do prompt como "o que veio antes": a última fala do João vai por último.
  if (previous) partes.push(`João: ${previous.slice(-280)}`);
  return partes.join(' ').slice(0, 800);
}

/**
 * Julga os trechos do Whisper. Silêncio, repetição e alucinação conhecida saem; o que sobra decide o status.
 * Limiares partindo dos do Whisper (no_speech_prob > 0,6 = silêncio; compression_ratio > 2,4 = laço), ajustados
 * com áudio real no Groq.
 */
export function assessTranscription(v: Verbose): Pick<Transcription, 'status' | 'text' | 'low_confidence' | 'confidence' | 'reason'> {
  const segments: Segment[] = Array.isArray(v.segments) && v.segments.length ? v.segments : [{ text: v.text ?? '' }];
  const kept: { text: string; logprob: number; weight: number }[] = [];
  for (const s of segments) {
    const text = String(s.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const logprob = typeof s.avg_logprob === 'number' ? s.avg_logprob : -0.3;
    const noSpeech = typeof s.no_speech_prob === 'number' ? s.no_speech_prob : 0;
    // Silêncio puro o Whisper ainda "ouve" como "E aí" (no_speech 0,62, logprob -0,73): fala real fica perto de 0.
    if ((noSpeech > 0.6 && logprob < -0.6) || noSpeech > 0.85) continue;
    if (typeof s.compression_ratio === 'number' && s.compression_ratio > 2.4) continue;
    const f = fold(text);
    if (!f || HALLUCINATIONS.some((h) => f === h || f.includes(h))) continue;
    const weight = Math.max(0.5, (Number(s.end) || 0) - (Number(s.start) || 0)) || 1;
    kept.push({ text, logprob, weight });
  }
  if (!kept.length) return { status: 'unclear', reason: 'sem_fala' };
  const total = kept.reduce((a, k) => a + k.weight, 0);
  const avg = kept.reduce((a, k) => a + k.logprob * k.weight, 0) / total;
  const confidence = Math.round(Math.exp(avg) * 100) / 100;
  const text = kept.map((k) => k.text).join(' ').trim();
  // Uma palavra solta com confiança baixa não é base para nada; um "sim" claro é.
  if (avg < -1.0 || (avg < -0.7 && fold(text).split(' ').length <= 2)) return { status: 'unclear', confidence, reason: 'baixa_confianca' };
  return { status: 'ok', text, confidence, low_confidence: avg < -0.55 || kept.some((k) => k.logprob < -0.9) };
}

export function groqTranscriber(deps: { apiKey: string; models?: string[]; fetch?: typeof fetch; timeoutMs?: number; url?: string }): Transcriber {
  const doFetch = deps.fetch ?? fetch;
  const models = deps.models?.length ? deps.models : DEFAULT_MODELS;
  return async (input) => {
    if (!input.bytes.byteLength) return { status: 'failed', reason: 'arquivo_vazio' };
    if (input.bytes.byteLength > MAX_BYTES) return { status: 'failed', reason: 'arquivo_grande' };
    const prompt = whisperPrompt(input);
    let reason = 'sem_modelo';
    // Modelo principal (mais preciso em português); se o provedor recusar por limite/instabilidade, o turbo.
    for (const model of models) {
      const form = new FormData();
      form.append('file', new Blob([input.bytes], { type: input.mime.split(';')[0] || 'audio/ogg' }), input.fileName);
      form.append('model', model);
      form.append('language', 'pt');
      form.append('response_format', 'verbose_json');
      form.append('temperature', '0');
      form.append('prompt', prompt);
      try {
        const r = await doFetch(deps.url ?? GROQ_TRANSCRIPTION_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${deps.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(deps.timeoutMs ?? 45000),
        });
        if (!r.ok) {
          reason = `http_${r.status}`;
          await r.text().catch(() => '');
          // Erro do pedido (arquivo inválido, chave errada) não melhora trocando de modelo.
          if (r.status === 429 || r.status >= 500) continue;
          return { status: 'failed', model, reason };
        }
        const v = await r.json() as Verbose;
        const verdict = assessTranscription(v);
        return {
          ...verdict, model,
          language: typeof v.language === 'string' ? v.language.slice(0, 20) : undefined,
          seconds: typeof v.duration === 'number' ? Math.round(v.duration * 10) / 10 : undefined,
        };
      } catch (e) {
        reason = e instanceof Error && e.name === 'TimeoutError' ? 'tempo_esgotado' : 'erro_rede';
      }
    }
    return { status: 'failed', reason };
  };
}
