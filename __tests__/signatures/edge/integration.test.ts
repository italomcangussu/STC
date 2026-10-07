// @vitest-environment node
// A edge function ligada ao SQL de verdade (PGlite): publicação → avisos por WhatsApp → pedir código →
// confirmar → assinatura gravada e verificada. Prova o contrato entre o código Deno e as funções `sig_svc_*`.
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminDeps, RpcResult } from '../../../supabase/functions/_shared/adminRequest';
import { dispatchSignatureNotifications } from '../../../supabase/functions/_shared/signatureDispatch';
import { handleSignatureRequest, secureCode, type SignatureEnvironment } from '../../../supabase/functions/_shared/signatureRequest';
import type { UazCaller } from '../../../supabase/functions/_shared/uazChat';
import { cpfOf, inDays, publishedDoc, q, readAndConsent, rpc, saveCpf, U, world } from '../sql/harness';

const ORIGIN = 'https://stcplay.com.br';
const SET_RETURNING = new Set(['sig_svc_claim_notifications']);

/** `rpc` da edge function (service_role) executado no banco em memória. */
function serviceRpc(db: PGlite) {
  return async (name: string, args: Record<string, unknown>): Promise<RpcResult> => {
    const keys = Object.keys(args);
    const params = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}${args[k] !== null && typeof args[k] === 'object' ? '::jsonb' : ''}`).join(', ')})`;
    try {
      await db.exec(`set role service_role; reset request.jwt.claim.sub;`);
      const rows = SET_RETURNING.has(name)
        ? (await db.query(`select * from ${call}`, params)).rows
        : (await db.query<{ r: unknown }>(`select ${call} as r`, params)).rows[0].r;
      return { data: rows, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    } finally {
      await db.exec('reset role;');
    }
  };
}

function edge(db: PGlite) {
  const sent: { number: string; text: string }[] = [];
  const uaz: UazCaller = async ({ body }) => { sent.push({ number: String(body.number), text: String(body.text) }); return { ok: true, body: { messageid: `WA${sent.length}` } }; };
  const deps: AdminDeps = {
    verifyToken: async (t) => (t.startsWith('tok-') ? { userId: t.slice(4) } : null),
    loadActor: async (id) => {
      const r = (await q<{ id: string; role: string; is_active: boolean }>(db, `select id, role::text as role, is_active from public.profiles where id = '${id}'`))[0];
      return r ? { id: r.id, role: r.role, active: r.is_active !== false } : null;
    },
    rpc: serviceRpc(db),
  };
  const env: SignatureEnvironment = {
    origin: ORIGIN, uaz, appUrl: ORIGIN, randomCode: secureCode, sleep: async () => {},
    geo: async (ip) => (ip === '203.0.113.7' ? { city: 'Fortaleza', region: 'Ceará', country: 'Brazil' } : null),
  };
  const call = async (uid: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const r = await handleSignatureRequest(new Request('https://x.test/signature-operations', {
      method: 'POST', body: JSON.stringify(body),
      headers: { origin: ORIGIN, authorization: `Bearer tok-${uid}`, 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0 (iPhone) teste', ...headers },
    }), deps, env);
    return { status: r.status, body: await r.json() as Record<string, any> };
  };
  const codeFromLastMessage = () => /\*(\d{6})\*/.exec(sent[sent.length - 1].text)![1];
  return { sent, uaz, deps, env, call, codeFromLastMessage };
}

describe('publicação → avisos de WhatsApp', () => {
  let db: PGlite; let doc: Awaited<ReturnType<typeof publishedDoc>>;
  beforeAll(async () => { db = await world(); doc = await publishedDoc(db, { due_at: inDays(7) }); });

  it('cada sócio com telefone recebe o link e o passo a passo; quem não tem fica "sem WhatsApp"', async () => {
    expect(doc).toMatchObject({ recipients: 5, queued: 4, skipped_no_phone: 1 });
    const e = edge(db);
    const r = await dispatchSignatureNotifications((n, a) => e.deps.rpc(n, a), e.uaz, { appUrl: ORIGIN, limit: 20, sleep: async () => {} });
    expect(r).toEqual({ configured: true, claimed: 4, sent: 4, failed: 0, reminders: 0, done: true });

    expect(e.sent.map((s) => s.number).sort()).toEqual(['5585900000001', '5585900000002', '5585900000003', '5585900000004']);
    for (const s of e.sent) {
      expect(s.text).toContain(`${ORIGIN}/#documentos/${doc.id}`);
      expect(s.text).toContain('Documentos e Assinaturas');
      expect(s.text).toContain('Li e concordo');
      expect(s.text).toContain('Termo de uso');
    }
    expect(e.sent.find((s) => s.number === '5585900000002')!.text).toContain('Olá, Ana!');

    const st = await q<{ status: string; n: number }>(db, `select status, count(*)::int as n from public.sig_notifications where document_id = '${doc.id}' group by status order by status`);
    expect(st).toEqual([{ status: 'sent', n: 4 }, { status: 'skipped', n: 1 }]);
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.sig_events where document_id = '${doc.id}' and kind = 'notified'`))[0].n).toBe(4);
  });

  it('repetir a varredura não envia de novo', async () => {
    const e = edge(db);
    const r = await dispatchSignatureNotifications((n, a) => e.deps.rpc(n, a), e.uaz, { appUrl: ORIGIN, sleep: async () => {} });
    expect(r).toMatchObject({ claimed: 0, sent: 0, done: true });
    expect(e.sent).toEqual([]);
  });
});

describe('falha de envio: tentativas, falha definitiva e "reenviar falhas"', () => {
  it('3 tentativas com espera crescente; depois fica failed; reenviar traz de volta só o que falhou', async () => {
    const db = await world();
    const doc = await publishedDoc(db, { due_at: inDays(7) }, [U.socioA]);
    const e = edge(db);
    const caiu: UazCaller = async () => ({ ok: false, error: 'HTTP_503' });
    const roda = () => dispatchSignatureNotifications((n, a) => e.deps.rpc(n, a), caiu, { appUrl: ORIGIN, sleep: async () => {} });

    expect(await roda()).toMatchObject({ claimed: 1, failed: 1 });
    await db.exec(`update public.sig_notifications set not_before = now() - interval '1 second' where document_id = '${doc.id}'`);
    expect(await roda()).toMatchObject({ claimed: 1, failed: 1 });
    await db.exec(`update public.sig_notifications set not_before = now() - interval '1 second' where document_id = '${doc.id}'`);
    expect(await roda()).toMatchObject({ claimed: 1, failed: 1 });
    const n = (await q<{ status: string; attempts: number; error: string }>(db, `select status, attempts, error from public.sig_notifications where document_id = '${doc.id}'`))[0];
    expect(n).toEqual({ status: 'failed', attempts: 3, error: 'HTTP_503' });
    expect(await roda()).toMatchObject({ claimed: 0, done: true }); // failed não volta sozinho

    expect(await rpc(db, U.admin, `public.sig_resend_failed('${doc.id}')`)).toBe(1);
    expect(await dispatchSignatureNotifications((nm, a) => e.deps.rpc(nm, a), e.uaz, { appUrl: ORIGIN, sleep: async () => {} })).toMatchObject({ claimed: 1, sent: 1 });
    expect(e.sent[0].number).toBe('5585900000002');
  });
});

describe('lembretes entram na fila e saem com o texto de lembrete', () => {
  it('3 dias antes e no dia do prazo, só para quem não assinou', async () => {
    const db = await world();
    const doc = await publishedDoc(db, { due_at: inDays(10) }, [U.socioA, U.socioB]);
    const e = edge(db);
    await dispatchSignatureNotifications((n, a) => e.deps.rpc(n, a), e.uaz, { appUrl: ORIGIN, sleep: async () => {} }); // avisos de publicação
    e.sent.length = 0;

    // Passa o tempo: a publicação foi há 5 dias e o prazo cai em 2 dias.
    await db.exec(`alter table public.sig_documents disable trigger sig_documents_guard`);
    await db.exec(`update public.sig_documents set published_at = now() - interval '5 days', due_at = now() + interval '2 days' where id = '${doc.id}'`);
    await db.exec(`alter table public.sig_documents enable trigger sig_documents_guard`);
    await db.exec(`update public.sig_notifications set created_at = now() - interval '5 days' where document_id = '${doc.id}'`);

    // Ana assina; Beto não.
    await readAndConsent(db, U.socioA, doc.id);
    await saveCpf(db, U.socioA, cpfOf(U.socioA));
    const pedido = await e.call(U.socioA, { action: 'request_code', document_id: doc.id });
    expect(pedido.status).toBe(200);
    expect((await e.call(U.socioA, { action: 'confirm_code', challenge_id: pedido.body.challenge_id, code: e.codeFromLastMessage() })).status).toBe(200);
    e.sent.length = 0;

    const r = await dispatchSignatureNotifications((n, a) => e.deps.rpc(n, a), e.uaz, { appUrl: ORIGIN, sleep: async () => {}, reminders: true });
    expect(r).toMatchObject({ reminders: 1, claimed: 1, sent: 1 });
    expect(e.sent).toHaveLength(1);
    expect(e.sent[0].number).toBe('5585900000003'); // Beto
    expect(e.sent[0].text).toContain('Faltam 3 dias');
    expect(e.sent[0].text).toContain(`#documentos/${doc.id}`);
  });
});

describe('assinar de ponta a ponta pela edge function', () => {
  it('ler → aceitar → pedir código → digitar o código da mensagem → assinatura com o dossiê completo', async () => {
    const db = await world();
    const doc = await publishedDoc(db, { due_at: inDays(7) });
    const e = edge(db);

    await readAndConsent(db, U.socioA, doc.id);
    await saveCpf(db, U.socioA, cpfOf(U.socioA));

    const pedido = await e.call(U.socioA, { action: 'request_code', document_id: doc.id, geo: { lat: -3.731922222, lng: -38.52667, accuracy_m: 18.26 }, device: { timezone: 'America/Fortaleza', language: 'pt-BR' } });
    expect(pedido.status).toBe(200);
    expect(pedido.body).toMatchObject({ ok: true, phone_masked: '(85) •••••-0002' });
    const code = e.codeFromLastMessage();
    expect(JSON.stringify(pedido.body)).not.toContain(code); // o código vai só no WhatsApp, nunca na resposta

    // no banco só existe o hash do código
    const ch = (await q<{ code_hash: string; salt: string; status: string }>(db, `select code_hash, salt, status from sig_private.challenges`))[0];
    expect(ch.status).toBe('sent');
    expect(JSON.stringify(ch)).not.toContain(code);

    // código errado: erro com tentativas restantes; certo: assina
    const errado = await e.call(U.socioA, { action: 'confirm_code', challenge_id: pedido.body.challenge_id, code: code === '000000' ? '111111' : '000000' });
    expect(errado).toMatchObject({ status: 422, body: { ok: false, reason: 'wrong_code', attempts_left: 4 } });

    const ok = await e.call(U.socioA, { action: 'confirm_code', challenge_id: pedido.body.challenge_id, code }, { 'user-agent': 'Mozilla/5.0 (iPhone) teste' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, seq: 1, replayed: false });

    const s = (await q<Record<string, any>>(db, `select * from public.sig_signatures where document_id = '${doc.id}'`))[0];
    expect(s).toMatchObject({
      profile_id: U.socioA, signer_name: 'Ana Sócia', signer_phone: '85900000002', signer_cpf: cpfOf(U.socioA),
      ip: '203.0.113.7', user_agent: 'Mozilla/5.0 (iPhone) teste', code_attempts: 2, provider_message_id: 'WA1', pages_seen: 3, pages_total: 3,
    });
    expect(s.geo).toMatchObject({ source: 'gps', city: 'Fortaleza', region: 'Ceará', country: 'Brazil', lat: -3.731922, lng: -38.52667 });
    expect(s.device).toMatchObject({ timezone: 'America/Fortaleza', language: 'pt-BR' });

    // a cadeia de integridade fecha
    expect(await rpc(db, U.admin, `public.sig_verify_integrity('${doc.id}')`)).toMatchObject({ checked: 1, ok: true });

    // repetir a mesma confirmação devolve a mesma assinatura, sem duplicar
    const de_novo = await e.call(U.socioA, { action: 'confirm_code', challenge_id: pedido.body.challenge_id, code });
    expect(de_novo.body).toMatchObject({ ok: true, replayed: true, signature_id: ok.body.signature_id });
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.sig_signatures`))[0].n).toBe(1);
  });

  it('sem GPS e com a cidade indisponível, assina só com o IP', async () => {
    const db = await world();
    const doc = await publishedDoc(db, { due_at: inDays(7) });
    const e = edge(db);
    await readAndConsent(db, U.socioB, doc.id);
    await saveCpf(db, U.socioB, cpfOf(U.socioB));
    const pedido = await e.call(U.socioB, { action: 'request_code', document_id: doc.id }, { 'cf-connecting-ip': '198.51.100.9' });
    const ok = await e.call(U.socioB, { action: 'confirm_code', challenge_id: pedido.body.challenge_id, code: e.codeFromLastMessage() }, { 'cf-connecting-ip': '198.51.100.9' });
    expect(ok.status).toBe(200);
    const s = (await q<Record<string, any>>(db, `select ip, geo from public.sig_signatures`))[0];
    expect(s.ip).toBe('198.51.100.9');
    expect(s.geo).toEqual({ source: 'ip' });
  });

  it('as regras do banco chegam ao app como motivos claros', async () => {
    const db = await world();
    const doc = await publishedDoc(db, { due_at: inDays(7) });
    const e = edge(db);
    // sem ler
    expect((await e.call(U.socioA, { action: 'request_code', document_id: doc.id })).body).toEqual({ ok: false, reason: 'cpf_required' });
    await saveCpf(db, U.socioA, cpfOf(U.socioA));
    expect((await e.call(U.socioA, { action: 'request_code', document_id: doc.id })).body).toEqual({ ok: false, reason: 'read_required' });
    await readAndConsent(db, U.socioA, doc.id);
    const p1 = await e.call(U.socioA, { action: 'request_code', document_id: doc.id });
    expect(p1.status).toBe(200);
    // reenvio imediato
    const p2 = await e.call(U.socioA, { action: 'request_code', document_id: doc.id });
    expect(p2.status).toBe(429);
    expect(p2.body).toMatchObject({ ok: false, reason: 'too_soon' });
    expect(p2.body.retry_in_seconds).toBeGreaterThan(0);
    // sem telefone no cadastro
    await readAndConsent(db, U.semFone, doc.id);
    await saveCpf(db, U.semFone, cpfOf(U.semFone));
    expect((await e.call(U.semFone, { action: 'request_code', document_id: doc.id })).body).toEqual({ ok: false, reason: 'no_phone' });
    // lanchonete não é sócio
    expect((await e.call(U.lanch, { action: 'request_code', document_id: doc.id })).status).toBe(403);
    // 5 erros trancam o código
    const ch = p1.body.challenge_id;
    const certo = e.codeFromLastMessage();
    const errado = certo === '000000' ? '111111' : '000000';
    let ult: Awaited<ReturnType<typeof e.call>> | null = null;
    for (let i = 0; i < 5; i += 1) ult = await e.call(U.socioA, { action: 'confirm_code', challenge_id: ch, code: errado });
    expect(ult).toMatchObject({ status: 423, body: { ok: false, reason: 'locked' } });
    expect((await e.call(U.socioA, { action: 'confirm_code', challenge_id: ch, code: certo })).body).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('ninguém assina no lugar de outro: o código de um sócio não vale no token de outro', async () => {
    const db = await world();
    const doc = await publishedDoc(db, { due_at: inDays(7) });
    const e = edge(db);
    await readAndConsent(db, U.socioA, doc.id);
    await saveCpf(db, U.socioA, cpfOf(U.socioA));
    const pedido = await e.call(U.socioA, { action: 'request_code', document_id: doc.id });
    const code = e.codeFromLastMessage();
    const roubo = await e.call(U.socioB, { action: 'confirm_code', challenge_id: pedido.body.challenge_id, code });
    expect(roubo).toMatchObject({ status: 404, body: { ok: false, reason: 'not_found' } });
    expect((await q<{ n: number }>(db, `select count(*)::int as n from public.sig_signatures`))[0].n).toBe(0);
  });

  it('o despacho imediato do admin envia a fila de uma publicação recém-feita', async () => {
    const db = await world();
    await publishedDoc(db, { due_at: inDays(7) });
    const e = edge(db);
    expect((await e.call(U.socioA, { action: 'dispatch' })).status).toBe(403);
    const r = await e.call(U.admin, { action: 'dispatch', limit: 25 });
    expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({ claimed: 4, sent: 4, failed: 0, done: true });
  });
});
