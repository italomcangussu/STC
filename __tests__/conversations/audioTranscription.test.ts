// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assessTranscription, groqTranscriber, whisperPrompt, type Transcription } from '../../supabase/functions/_shared/audioTranscription';
import { audioBody, hearAudios, unheardOnly } from '../../supabase/functions/_shared/aiAgent/audio';
import { recordInbound, type RecordDeps } from '../../supabase/functions/whatsapp-webhook/record';
import { sha256Hex, type ChannelDelivery } from '../../supabase/functions/whatsapp-webhook/handler';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';

const seg = (text: string, avg_logprob = -0.1, no_speech_prob = 0.01, compression_ratio = 1, start = 0, end = 3) =>
  ({ text, avg_logprob, no_speech_prob, compression_ratio, start, end });

describe('julgamento da transcrição (o que o Whisper ouviu de verdade)', () => {
  it('fala clara: ok, com o texto e confiança alta', () => {
    const r = assessTranscription({ segments: [seg(' Oi João, quero reservar a quadra 2 amanhã às 6 da tarde.', -0.09, 0.002, 0.9)] });
    expect(r).toMatchObject({ status: 'ok', text: 'Oi João, quero reservar a quadra 2 amanhã às 6 da tarde.', low_confidence: false });
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it('silêncio que o Whisper "ouve" como "E aí" (medido no Groq) não vira fala', () => {
    expect(assessTranscription({ text: ' E aí', segments: [seg(' E aí', -0.727, 0.624, 0.43)] })).toMatchObject({ status: 'unclear', reason: 'sem_fala' });
  });

  it('alucinações conhecidas e laços de repetição caem fora; o resto do áudio continua', () => {
    const r = assessTranscription({ segments: [
      seg('Pode cancelar minha reserva de hoje.'),
      seg('Legendas pela comunidade Amara.org', -0.4, 0.3),
      seg('sim sim sim sim sim sim sim sim sim sim', -0.2, 0.05, 3.1),
    ] });
    expect(r).toMatchObject({ status: 'ok', text: 'Pode cancelar minha reserva de hoje.' });
  });

  it('confiança baixa: no geral vira inaudível; trecho duvidoso marca "reconhecimento incerto"', () => {
    expect(assessTranscription({ segments: [seg('quadra doze às dez', -1.3, 0.2)] })).toMatchObject({ status: 'unclear', reason: 'baixa_confianca' });
    expect(assessTranscription({ segments: [seg('sim', -0.8, 0.1)] }).status).toBe('unclear');
    expect(assessTranscription({ segments: [seg('Quero marcar com o Beto', -0.2), seg('às dez', -0.95, 0.1, 1, 3, 4)] }))
      .toMatchObject({ status: 'ok', low_confidence: true });
    expect(assessTranscription({ segments: [seg('Sim, pode confirmar.', -0.15)] })).toMatchObject({ status: 'ok', low_confidence: false });
  });

  it('prompt do Whisper: nomes e vocabulário do clube, com a última fala do João no fim', () => {
    const p = whisperPrompt({ names: ['Maria', 'STC Institucional', 'Maria', ''], previous: 'Confirma a quadra 2 às 18h? Responda "sim".' });
    expect(p).toContain('(Maria, STC Institucional)');
    expect(p).toContain('Day Card');
    expect(p.endsWith('João: Confirma a quadra 2 às 18h? Responda "sim".')).toBe(true);
    expect(whisperPrompt({ previous: 'x'.repeat(5000) }).length).toBeLessThanOrEqual(800);
  });
});

describe('cliente do Groq', () => {
  const input = { bytes: new Uint8Array([1, 2, 3]), mime: 'audio/ogg; codecs=opus', fileName: 'wa1.ogg', previous: null, names: ['Ana'] };
  const okBody = { text: 'Oi', language: 'Portuguese', duration: 2.345, segments: [seg('Oi, tudo bem?')] };

  it('manda o arquivo com idioma pt, verbose_json, temperatura 0 e o prompt; a chave só no cabeçalho', async () => {
    const seen: { url: string; auth: string; form: FormData }[] = [];
    const t = groqTranscriber({ apiKey: 'k-secreta', fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: String((init.headers as Record<string, string>).authorization), form: init.body as FormData });
      return new Response(JSON.stringify(okBody), { status: 200 });
    }) as typeof fetch });
    const r = await t(input);
    expect(r).toMatchObject({ status: 'ok', text: 'Oi, tudo bem?', model: 'whisper-large-v3', language: 'Portuguese', seconds: 2.3 });
    const f = seen[0].form;
    expect(seen[0].url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(seen[0].auth).toBe('Bearer k-secreta');
    expect([f.get('model'), f.get('language'), f.get('response_format'), f.get('temperature')]).toEqual(['whisper-large-v3', 'pt', 'verbose_json', '0']);
    expect(String(f.get('prompt'))).toContain('Ana');
    expect((f.get('file') as File).name).toBe('wa1.ogg');
    expect((f.get('file') as File).type).toBe('audio/ogg');
  });

  it('limite/instabilidade do provedor → tenta o turbo; erro do pedido não insiste; rede caída → failed', async () => {
    const models: string[] = [];
    const seq = [429, 200];
    const t = groqTranscriber({ apiKey: 'k', fetch: (async (_u: string, init: RequestInit) => {
      models.push(String((init.body as FormData).get('model')));
      const status = seq.shift()!;
      return new Response(status === 200 ? JSON.stringify(okBody) : 'rate', { status });
    }) as typeof fetch });
    expect(await t(input)).toMatchObject({ status: 'ok', model: 'whisper-large-v3-turbo' });
    expect(models).toEqual(['whisper-large-v3', 'whisper-large-v3-turbo']);

    let calls = 0;
    const bad = groqTranscriber({ apiKey: 'k', fetch: (async () => { calls += 1; return new Response('bad', { status: 400 }); }) as typeof fetch });
    expect(await bad(input)).toMatchObject({ status: 'failed', reason: 'http_400' });
    expect(calls).toBe(1);

    const down = groqTranscriber({ apiKey: 'k', fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    expect(await down(input)).toEqual({ status: 'failed', reason: 'erro_rede' });
    expect(await down({ ...input, bytes: new Uint8Array() })).toEqual({ status: 'failed', reason: 'arquivo_vazio' });
  });
});

describe('o que o João lê de um áudio', () => {
  it('corpo para o modelo: texto ouvido, incerto, inaudível, não transcrito (legenda preservada)', () => {
    expect(audioBody('🎤 Áudio', { status: 'ok', text: 'quero jogar amanhã' })).toEqual({ status: 'ok', body: '[áudio] quero jogar amanhã' });
    expect(audioBody('🎤 Áudio', { status: 'ok', text: 'às dez', low_confidence: true }).body).toBe('[áudio, reconhecimento incerto] às dez');
    expect(audioBody('🎤 Áudio', { status: 'unclear' })).toEqual({ status: 'unclear', body: '[áudio que não deu para entender]' });
    expect(audioBody('ouve aí', null)).toEqual({ status: 'failed', body: '[áudio que não foi transcrito] (legenda: ouve aí)' });
  });

  it('espera o áudio recente que ainda está sendo transcrito; o antigo sem transcrição não segura o turno', async () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const transcript = [
      { id: 'A1', direction: 'inbound', kind: 'ptt', body: '🎤 Áudio', created_at: '2026-10-07T11:59:55Z' },
      { id: 'A0', direction: 'inbound', kind: 'audio', body: '🎤 Áudio', created_at: '2026-10-07T11:00:00Z' },
      { id: 'T1', direction: 'inbound', kind: 'text', body: 'e aí?', created_at: '2026-10-07T11:59:58Z' },
    ];
    let polls = 0; const sleeps: number[] = [];
    const db = async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('conv_svc_ai_audio_transcripts');
      expect(args.p_ids).toEqual(['A1', 'A0']);
      polls += 1;
      return { data: polls < 3 ? [] : [{ id: 'A1', transcription: { status: 'ok', text: 'reserva a quadra 1' } }] };
    };
    const out = await hearAudios(transcript, { db, sleep: async (ms) => { sleeps.push(ms); }, now: () => now });
    expect(polls).toBe(3);
    expect(sleeps).toEqual([4000, 4000]);
    expect(out.map((t) => [t.body, t.audio])).toEqual([
      ['[áudio] reserva a quadra 1', 'ok'], ['[áudio que não foi transcrito]', 'failed'], ['e aí?', undefined]]);
    // Sem áudio: nenhuma consulta.
    expect(await hearAudios([transcript[2]], { db: async () => { throw new Error('não devia'); }, sleep: async () => undefined })).toEqual([transcript[2]]);
  });

  it('só áudio sem nada entendido decide sozinho; havendo texto ou um áudio ouvido, segue o modelo', () => {
    expect(unheardOnly([{ audio: 'unclear' }, { audio: 'unclear' }])).toBe('unclear');
    expect(unheardOnly([{ audio: 'unclear' }, { audio: 'failed' }])).toBe('failed');
    expect(unheardOnly([{ audio: 'unclear' }, { audio: 'ok' }])).toBeNull();
    expect(unheardOnly([{ audio: 'unclear' }, { body: 'oi' }])).toBeNull();
    expect(unheardOnly([])).toBeNull();
  });
});

describe('webhook: áudio é transcrito antes de acionar o João', () => {
  const TOKEN = 'T'.repeat(48);
  const GROUP = '120363025246125486@g.us';
  const channel = async (): Promise<ChannelDelivery> => ({
    inbound_token_hash: await sha256Hex(TOKEN), bot_phone: '5585988880099', bot_lids: [], ai_direct_enabled: true, ai_group_enabled: true,
    mention_verified_at: '2026-10-06T10:00:00Z', group_session_minutes: 15, institutional_name: 'STC Institucional' });
  const audio = (message: Record<string, unknown> = {}) => ({ EventType: 'messages', message: {
    chatid: '5585999990001@s.whatsapp.net', messageid: `wa-${Math.random()}`, messageTimestamp: 1790000000,
    sender_pn: '5585999990001@s.whatsapp.net', senderName: 'Maria', mediaType: 'ptt', text: '',
    content: { URL: 'u', mediaKey: 'k', mimetype: 'audio/ogg; codecs=opus', seconds: 4, PTT: true }, ...message } });
  const fake = (heard: Transcription | Error = { status: 'ok', text: 'oi joão', model: 'whisper-large-v3' }) => {
    const order: string[] = [];
    const calls: { name: string; args: any }[] = [];
    const asked: any[] = [];
    const deps: RecordDeps = {
      rpc: async (name, args) => { calls.push({ name, args }); order.push(name); return { data: name === 'conv_svc_ingest_message' ? { message_id: 'M1', conversation_id: 'C1' } : true, error: null }; },
      uaz: (async () => ({ ok: true, body: { fileURL: 'https://cdn/a', mimetype: 'audio/ogg; codecs=opus' } })) as UazCaller,
      store: async () => true, broadcast: async () => undefined, background: () => undefined,
      onInbound: (id) => order.push(`ia:${id}`),
      transcribe: async (input) => { asked.push(input); order.push('transcribe'); if (heard instanceof Error) throw heard; return heard; },
    };
    return { deps, calls, order, asked };
  };

  it('privado: baixa, transcreve, grava a transcrição e SÓ ENTÃO aciona a IA (uma vez)', async () => {
    const f = fake();
    expect(await recordInbound(audio(), await channel(), f.deps)).toBe('mensagem_com_midia');
    expect(f.order.filter((x) => x !== 'conv_svc_log_webhook')).toEqual(
      ['conv_svc_ingest_message', 'conv_svc_set_message_media', 'transcribe', 'conv_svc_set_message_transcription', 'ia:M1']);
    expect(f.asked[0]).toMatchObject({ messageId: 'M1', conversationId: 'C1', mime: 'audio/ogg; codecs=opus', contactName: 'Maria', institutionalName: 'STC Institucional' });
    expect(f.asked[0].path).toMatch(/^in\/M1\/wa-.*\.ogg$/);
    expect(f.calls.find((c) => c.name === 'conv_svc_set_message_transcription')!.args).toEqual({ p_message: 'M1', p: { status: 'ok', text: 'oi joão', model: 'whisper-large-v3' } });
    expect(f.calls.some((c) => c.name === 'conv_svc_log_webhook')).toBe(false);
  });

  it('transcrição quebrada ou áudio que não baixou: grava "failed", registra só o motivo e a IA é acionada mesmo assim', async () => {
    const f = fake(new Error('boom'));
    await recordInbound(audio(), await channel(), f.deps);
    expect(f.calls.find((c) => c.name === 'conv_svc_set_message_transcription')!.args.p).toEqual({ status: 'failed', reason: 'erro_transcricao' });
    expect(f.calls.find((c) => c.name === 'conv_svc_log_webhook')!.args).toEqual({ p_event: 'message', p_outcome: 'audio_failed', p_detail: 'erro_transcricao' });
    expect(f.order.at(-1)).toBe('ia:M1');

    const g = fake();
    g.deps.store = async () => false;
    expect(await recordInbound(audio(), await channel(), g.deps)).toBe('mensagem_midia_pendente');
    expect(g.asked).toHaveLength(0);
    expect(g.calls.find((c) => c.name === 'conv_svc_set_message_transcription')!.args.p).toEqual({ status: 'failed', reason: 'midia_indisponivel' });
    expect(g.order.at(-1)).toBe('ia:M1');
  });

  it('não transcreve o que não é para o João: áudio do próprio clube, áudio solto no grupo; sem transcritor, segue como antes', async () => {
    const mine = fake();
    await recordInbound(audio({ fromMe: true }), await channel(), mine.deps);
    expect(mine.asked).toHaveLength(0);
    expect(mine.order.some((x) => x.startsWith('ia:'))).toBe(false);

    const grupo = fake();
    await recordInbound(audio({ chatid: GROUP, isGroup: true, sender_pn: '5585999990002@s.whatsapp.net' }), await channel(), grupo.deps);
    expect(grupo.asked).toHaveLength(0);
    expect(grupo.order[1]).toBe('ia:M1'); // o gatilho no banco decide, como qualquer mensagem do grupo

    const semChave = fake();
    delete semChave.deps.transcribe;
    await recordInbound(audio(), await channel(), semChave.deps);
    expect(semChave.order[1]).toBe('ia:M1');
    expect(semChave.calls.some((c) => c.name === 'conv_svc_set_message_transcription')).toBe(false);
  });
});
