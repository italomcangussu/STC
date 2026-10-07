// @vitest-environment node
/**
 * O João ouve áudio, de ponta a ponta: SQL real (PGlite) + `turn.ts` real. Só o modelo e o WhatsApp são simulados;
 * a transcrição entra pelo mesmo RPC que o webhook usa.
 */
import { describe, expect, it } from 'vitest';
import { U, j, key, pgDb, q, rpc, svc, world } from './sql/harness';
import { runTurn } from '../../supabase/functions/_shared/aiAgent/turn';
import { UNCLEAR_AUDIO_REPLY } from '../../supabase/functions/_shared/aiAgent/audio';
import type { Chat } from '../../supabase/functions/_shared/aiAgent/llm';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;

const reply = (text: string) => JSON.stringify({ messages: [text], intent: 'outro', ready: false, customer_confirmed: false, declined: false,
  awaiting: true, transfer: false, handoff_kind: null, handoff_note: null, close: false, slots: {} });
const script = (...outs: string[]) => {
  const calls: { system: string; user: string }[] = [];
  const chat: Chat = async (messages) => {
    calls.push({ system: messages[0].content, user: messages[1].content });
    const out = outs.shift();
    if (out === undefined) throw new Error('modelo chamado além do roteiro');
    return { output: out, model: 'teste', usage: null };
  };
  return { chat, calls };
};
const provider = () => {
  const sent: string[] = [];
  const uaz: UazCaller = async ({ path, body }) => {
    if (path === '/send/text') { sent.push(String(body.text)); return { ok: true, body: { messageid: `OUT${++n}` } }; }
    return { ok: true, body: {} };
  };
  return { uaz, sent };
};

async function setup() {
  const w = await world();
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste', buffer_seconds: 0, max_turns: 12 })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5599900000099', ai_direct_enabled: true })})`);
  return w;
}
const voice = (w: W, body = '🎤 Áudio') => svc<any>(w.db, `public.conv_svc_ingest_message(${j({
  provider_id: `V${++n}${Math.random()}`, chat_kind: 'direct', phone: '5599900000001', name: 'Ana', kind: 'ptt', body, mime: 'audio/ogg' })})`);
const hear = (w: W, id: string, t: Record<string, unknown>) => svc<boolean>(w.db, `public.conv_svc_set_message_transcription('${id}', ${j(t)})`);
const turn = (w: W, id: string, chat: Chat, uaz: UazCaller) => runTurn(id, { db: pgDb(w.db), chat, uaz, sleep: async () => undefined });

describe('o João ouve áudio (turno completo)', () => {
  it('áudio entendido: o modelo recebe o que foi dito, marcado como áudio, e a regra de como tratar', async () => {
    const w = await setup();
    const p = provider();
    const m = await voice(w);
    expect(await hear(w, m.message_id, { status: 'ok', text: 'Quero reservar a quadra 2 amanhã às 18h', low_confidence: true, confidence: 0.61, model: 'whisper-large-v3' })).toBe(true);
    const s = script(reply('Fechado! Com quem você vai jogar?'));
    const r = await turn(w, m.message_id, s.chat, p.uaz);
    expect(r.status).toBe('replied');
    expect(s.calls[0].user).toContain('Pessoa: [áudio, reconhecimento incerto] Quero reservar a quadra 2 amanhã às 18h');
    expect(s.calls[0].user).not.toContain('🎤 Áudio');
    expect(s.calls[0].system).toContain('Fala que começa com "[áudio]"');
    expect(p.sent).toEqual(['Fechado! Com quem você vai jogar?']);
    // No banco a mensagem continua sendo um áudio; a transcrição fica ao lado.
    const [row] = await q<any>(w.db, `select body, meta->'transcription' as t from public.conv_messages where id = '${m.message_id}'`);
    expect(row.body).toBe('🎤 Áudio');
    expect(row.t).toMatchObject({ status: 'ok', low_confidence: true, confidence: 0.61, model: 'whisper-large-v3' });
  }, 60000);

  it('áudio inaudível: o João pede para repetir sem chamar o modelo nem a equipe', async () => {
    const w = await setup();
    const p = provider();
    const m = await voice(w);
    await hear(w, m.message_id, { status: 'unclear', reason: 'sem_fala' });
    const r = await turn(w, m.message_id, script().chat, p.uaz);
    expect(r).toMatchObject({ status: 'replied', action: 'audio_unclear', handoff: null });
    expect(p.sent).toEqual([UNCLEAR_AUDIO_REPLY]);
    const [c] = await q<any>(w.db, `select ai_status from public.conv_conversations`);
    expect(c.ai_status).toBe('ai');
  }, 60000);

  it('transcrição falhou no privado: sócio não é transferido, o João pede texto ou novo áudio', async () => {
    const w = await setup();
    const p = provider();
    const m = await voice(w);
    await hear(w, m.message_id, { status: 'failed', reason: 'http_500' });
    const r = await turn(w, m.message_id, script().chat, p.uaz);
    expect(r).toMatchObject({ status: 'replied', handoff: null });
    expect(p.sent.at(-1)!).toMatch(/Não consegui ouvir seu áudio/);
    const [c] = await q<any>(w.db, `select ai_status, handoff_kind from public.conv_conversations`);
    expect(c).toEqual({ ai_status: 'ai', handoff_kind: null });
  }, 60000);
});

describe('SQL da transcrição', () => {
  it('grava só chaves conhecidas, só em áudio recebido; status inválido é recusado; fora do service_role não executa', async () => {
    const w = await setup();
    const m = await voice(w);
    expect(await hear(w, m.message_id, { status: 'ok', text: '  ', confidence: 'alta', extra: 'x', seconds: 3.2 })).toBe(true);
    const [row] = await q<any>(w.db, `select meta->'transcription' as t from public.conv_messages where id = '${m.message_id}'`);
    expect(row.t).toMatchObject({ status: 'unclear', reason: 'sem_texto', seconds: 3.2 });
    expect(row.t).not.toHaveProperty('extra');
    expect(row.t).not.toHaveProperty('confidence');

    const texto = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `T${++n}`, chat_kind: 'direct', phone: '5599900000001', name: 'Ana', kind: 'text', body: 'oi' })})`);
    expect(await hear(w, texto.message_id, { status: 'ok', text: 'não' })).toBe(false);
    await expect(hear(w, m.message_id, { status: 'talvez' })).rejects.toThrow(/INVALID_TRANSCRIPTION/);

    const lidos = await svc<any[]>(w.db, `public.conv_svc_ai_audio_transcripts(array['${m.message_id}', '${texto.message_id}', 'nao-e-uuid'])`);
    expect(lidos).toHaveLength(1);
    expect(lidos[0]).toMatchObject({ id: m.message_id, transcription: { status: 'unclear' } });

    await expect(rpc(w.db, U.admin, `public.conv_svc_set_message_transcription('${m.message_id}', '{"status":"ok","text":"x"}')`)).rejects.toThrow(/permission denied/);
    await expect(rpc(w.db, U.admin, `public.conv_svc_ai_audio_transcripts(array['${m.message_id}'])`)).rejects.toThrow(/permission denied/);
  }, 60000);
});
