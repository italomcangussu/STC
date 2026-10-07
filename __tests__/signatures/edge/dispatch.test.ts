// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Db } from '../../../supabase/functions/_shared/dispatch';
import { dispatchSignatureNotifications, handleSignatureCron } from '../../../supabase/functions/_shared/signatureDispatch';
import type { UazCaller } from '../../../supabase/functions/_shared/uazChat';

const DOC = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
type Call = { name: string; args: Record<string, any> };

const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `N${n}`, document_id: DOC, profile_id: `P${n}`, kind: 'publish', slot: '', phone: `8590000000${n}`, name: `Sócio ${n}`,
  title: 'Termo de uso', due_at: '2026-10-20T21:00:00Z', attempts: 1, ...over,
});

/** Banco falso com uma fila: cada `claim` entrega o próximo item (ou vazio). */
function fake(queue: Record<string, unknown>[], extra: Record<string, (a: any) => unknown> = {}) {
  const calls: Call[] = [];
  const q = [...queue];
  const db: Db = async (name, args) => {
    calls.push({ name, args });
    if (name === 'sig_svc_claim_notifications') return { data: q.length ? [q.shift()] : [], error: null };
    return { data: extra[name]?.(args) ?? null, error: null };
  };
  return { db, calls, finished: () => calls.filter((c) => c.name === 'sig_svc_finish_notification').map((c) => c.args) };
}
const okUaz = (sent: { number: string; text: string }[] = []): UazCaller => async ({ body }) => { sent.push({ number: String(body.number), text: String(body.text) }); return { ok: true, body: { messageid: 'WA1' } }; };
const base = { appUrl: 'https://stcplay.com.br', sleep: async () => {} };

describe('fila de avisos: um por vez, resultado de cada um informado ao banco', () => {
  it('envia, registra o id do provedor e termina quando a fila esvazia', async () => {
    const sent: { number: string; text: string }[] = [];
    const f = fake([row(1), row(2)]);
    const r = await dispatchSignatureNotifications(f.db, okUaz(sent), { ...base, limit: 10 });
    expect(r).toEqual({ configured: true, claimed: 2, sent: 2, failed: 0, reminders: 0, done: true });
    expect(sent.map((s) => s.number)).toEqual(['5585900000001', '5585900000002']);
    expect(sent[0].text).toContain(`https://stcplay.com.br/#documentos/${DOC}`);
    expect(sent[0].text).toContain('Olá, Sócio!');
    expect(f.finished()).toEqual([
      { p_id: 'N1', p_sent: true, p_provider_id: 'WA1', p_error: null },
      { p_id: 'N2', p_sent: true, p_provider_id: 'WA1', p_error: null },
    ]);
  });

  it('a falha de um não derruba os outros e o erro é só um código (nunca a resposta crua)', async () => {
    let n = 0;
    const uaz: UazCaller = async () => (++n === 1 ? { ok: false, error: 'HTTP_503' } : { ok: true, body: { messageid: 'WA2' } });
    const f = fake([row(1), row(2)]);
    const r = await dispatchSignatureNotifications(f.db, uaz, { ...base });
    expect(r).toMatchObject({ claimed: 2, sent: 1, failed: 1, done: true });
    expect(f.finished()[0]).toEqual({ p_id: 'N1', p_sent: false, p_provider_id: null, p_error: 'HTTP_503' });
    expect(f.finished()[1]).toMatchObject({ p_id: 'N2', p_sent: true });
  });

  it('cada tipo sai com o texto certo (publicação, sócio novo, lembrete)', async () => {
    const sent: { number: string; text: string }[] = [];
    const f = fake([row(1), row(2, { kind: 'new_member' }), row(3, { kind: 'reminder', slot: 'd0@2026-10-20' })]);
    await dispatchSignatureNotifications(f.db, okUaz(sent), { ...base });
    expect(sent[0].text).toContain('esperando a sua assinatura');
    expect(sent[1].text).toContain('Bem-vindo(a)');
    expect(sent[2].text).toContain('último dia');
  });

  it('telefone inválido ou tipo desconhecido: nada é enviado e o banco registra a falha', async () => {
    const sent: { number: string; text: string }[] = [];
    const f = fake([row(1, { phone: '123' }), row(2, { kind: 'promo' })]);
    const r = await dispatchSignatureNotifications(f.db, okUaz(sent), { ...base });
    expect(r).toMatchObject({ claimed: 2, sent: 0, failed: 2 });
    expect(sent).toEqual([]);
    expect(f.finished().map((x) => x.p_error)).toEqual(['INVALID_PHONE', 'UNKNOWN_KIND']);
  });

  it('sem WhatsApp configurado nada é pego da fila (não gasta tentativa)', async () => {
    const f = fake([row(1)]);
    const r = await dispatchSignatureNotifications(f.db, null, { ...base });
    expect(r).toEqual({ configured: false, claimed: 0, sent: 0, failed: 0, reminders: 0, done: true });
    expect(f.calls.map((c) => c.name)).not.toContain('sig_svc_claim_notifications');
  });
});

describe('ritmo: intervalo aleatório entre mensagens e limites', () => {
  it('espera entre uma mensagem e outra (não depois da última), dentro da faixa pedida', async () => {
    const waits: number[] = [];
    const f = fake([row(1), row(2), row(3)]);
    await dispatchSignatureNotifications(f.db, okUaz(), { ...base, sleep: async (ms) => { waits.push(ms); }, jitterMs: [1000, 3000], random: () => 0.5 });
    expect(waits).toEqual([2000, 2000]);
    const w2: number[] = [];
    await dispatchSignatureNotifications(fake([row(1), row(2)]).db, okUaz(), { ...base, sleep: async (ms) => { w2.push(ms); }, jitterMs: [1000, 3000], random: () => 0 });
    expect(w2).toEqual([1000]);
  });

  it('para no limite e avisa que ainda há fila (done:false) para o app chamar de novo', async () => {
    const f = fake([row(1), row(2), row(3), row(4)]);
    const r = await dispatchSignatureNotifications(f.db, okUaz(), { ...base, limit: 2 });
    expect(r).toMatchObject({ claimed: 2, sent: 2, done: false });
  });

  it('para ao estourar o tempo da função (done:false) em vez de ser cortado no meio de um envio', async () => {
    let t = 0;
    const f = fake([row(1), row(2), row(3)]);
    const uaz: UazCaller = async () => { t += 60_000; return { ok: true, body: {} }; };
    const r = await dispatchSignatureNotifications(f.db, uaz, { ...base, maxMs: 100_000, now: () => t });
    expect(r).toMatchObject({ claimed: 2, sent: 2, done: false });
  });

  it('o limite é contido (mínimo 1, máximo 50)', async () => {
    const q = Array.from({ length: 60 }, (_, i) => row(i + 1));
    expect((await dispatchSignatureNotifications(fake(q).db, okUaz(), { ...base, limit: 9999 })).claimed).toBe(50);
    expect((await dispatchSignatureNotifications(fake(q).db, okUaz(), { ...base, limit: 0 })).claimed).toBe(1);
  });
});

describe('lembretes e falhas do banco', () => {
  it('só o agendador pede lembretes novos; falha ao criá-los não impede o despacho', async () => {
    const f = fake([row(1)], { sig_svc_enqueue_reminders: () => 7 });
    const r = await dispatchSignatureNotifications(f.db, okUaz(), { ...base, reminders: true });
    expect(r).toMatchObject({ reminders: 7, sent: 1 });
    expect(f.calls[0].name).toBe('sig_svc_enqueue_reminders');

    const g = fake([row(1)]);
    expect((await dispatchSignatureNotifications(g.db, okUaz(), { ...base })).reminders).toBe(0);
    expect(g.calls.map((c) => c.name)).not.toContain('sig_svc_enqueue_reminders');

    const calls: string[] = [];
    const quebra: Db = async (name) => {
      calls.push(name);
      if (name === 'sig_svc_enqueue_reminders') throw new Error('x');
      return { data: name === 'sig_svc_claim_notifications' ? [] : null, error: null };
    };
    expect(await dispatchSignatureNotifications(quebra, okUaz(), { ...base, reminders: true })).toMatchObject({ reminders: 0, done: true });
  });

  it('erro ao pegar a fila encerra a volta sem lançar exceção', async () => {
    const db: Db = async () => ({ data: null, error: { message: 'boom' } });
    expect(await dispatchSignatureNotifications(db, okUaz(), { ...base })).toMatchObject({ claimed: 0, done: false });
  });
});

describe('autorização do agendador (função signature-dispatch)', () => {
  const secret = 'segredo-de-teste-com-mais-de-24-chars';
  const run = async () => ({ configured: true, claimed: 0, sent: 0, failed: 0, reminders: 0, done: true });
  const req = (headers: Record<string, string> = {}, method = 'POST') => new Request('https://x.test/signature-dispatch', { method, headers });

  it('sem cabeçalho, com segredo errado ou com segredo curto demais → 401', async () => {
    expect((await handleSignatureCron(req(), { secret, run })).status).toBe(401);
    expect((await handleSignatureCron(req({ 'x-dispatch-secret': 'errado' }), { secret, run })).status).toBe(401);
    expect((await handleSignatureCron(req({ 'x-dispatch-secret': 'curto' }), { secret: 'curto', run })).status).toBe(401);
    expect((await handleSignatureCron(req({ 'x-dispatch-secret': secret }), { secret: undefined, run })).status).toBe(401);
  });
  it('só POST; segredo certo → 200 com contagens, sem dado de sócio', async () => {
    expect((await handleSignatureCron(req({ 'x-dispatch-secret': secret }, 'GET'), { secret, run })).status).toBe(405);
    const r = await handleSignatureCron(req({ 'x-dispatch-secret': secret }), { secret, run });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ configured: true, claimed: 0, sent: 0, failed: 0, reminders: 0, done: true });
  });
  it('mesmo segredo e mesmo cabeçalho do despacho de Conversas', async () => {
    const { handleDispatchRequest } = await import('../../../supabase/functions/_shared/dispatch');
    const r = await handleDispatchRequest(req({ 'x-dispatch-secret': secret }), { secret, run: async () => ({ tick: null, expiredSessions: 0, automations: { claimed: 0, sent: 0, failed: 0 }, followups: { claimed: 0, sent: 0, failed: 0 } }) });
    expect(r.status).toBe(200);
    expect((await handleDispatchRequest(req({ 'x-dispatch-secret': 'x' }), { secret, run: async () => ({} as never) })).status).toBe(401);
  });
});
