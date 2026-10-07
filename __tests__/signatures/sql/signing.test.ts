// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { CPF, U, asUser, issue, j, publishedDoc, q, readAndConsent, rpc, rpcError, saveCpf, signAs, svc, verify, world } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await world();
}, 60000);

type Sig = Record<string, any>;
const sigOf = async (doc: string, uid: string) =>
  (await q<Sig>(db, `select * from public.sig_signatures where document_id = '${doc}' and profile_id = '${uid}'`))[0];
const eventsOf = async (doc: string, uid: string) =>
  (await q<{ kind: string }>(db, `select kind from public.sig_events where document_id = '${doc}' and profile_id = '${uid}' order by id`)).map((e) => e.kind);
/** Envelhece os desafios para passar da trava de 60 s sem esperar. */
const age = (doc: string, uid: string, interval = '2 minutes') =>
  db.exec(`update sig_private.challenges set created_at = created_at - interval '${interval}' where document_id = '${doc}' and profile_id = '${uid}'`);

describe('leitura e aceite (sig_log_event)', () => {
  it('respeita a ordem: abrir → ler até o fim → aceitar', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    const ev = (kind: string, meta: unknown = {}) => rpcError(db, U.socioA, `public.sig_log_event('${d.id}', '${kind}', ${j(meta)})`);
    expect(await ev('read_completed', { pages_seen: 3, pages_total: 3 })).toContain('SIG_READ_NOT_STARTED');
    expect(await ev('consent_checked')).toContain('SIG_READ_REQUIRED');
    expect(await ev('viewed')).toBeNull();
    expect(await ev('read_started')).toBeNull();
    expect(await ev('read_completed', { pages_seen: 2, pages_total: 3 })).toContain('SIG_READ_INCOMPLETE');
    expect(await ev('read_completed', { pages_seen: 3, pages_total: 9 })).toContain('SIG_READ_INCOMPLETE');
    expect(await ev('read_completed', { pages_seen: 3, pages_total: 3 })).toBeNull();
    expect(await ev('consent_checked')).toBeNull();
    expect(await eventsOf(d.id, U.socioA)).toEqual(['viewed', 'read_started', 'read_completed', 'consent_checked']);
  });

  it('recusa evento inventado, quem não é destinatário e quem já assinou', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    expect(await rpcError(db, U.socioA, `public.sig_log_event('${d.id}', 'signed')`)).toContain('SIG_EVENT_INVALID');
    expect(await rpcError(db, U.socioB, `public.sig_log_event('${d.id}', 'viewed')`)).toContain('SIG_NOT_FOUND');
    await signAs(db, U.socioA, d.id);
    expect(await rpcError(db, U.socioA, `public.sig_log_event('${d.id}', 'viewed')`)).toContain('SIG_ALREADY_SIGNED');
  });

  it('não registra leitura de documento arquivado', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await rpc(db, U.admin, `public.sig_archive('${d.id}')`);
    expect(await rpcError(db, U.socioA, `public.sig_log_event('${d.id}', 'viewed')`)).toContain('SIG_NOT_PUBLISHED');
  });

  it('guarda IP e aparelho vistos pelo servidor e descarta o resto do meta', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await db.exec(`set request.headers = '{"x-forwarded-for":"198.51.100.5, 10.0.0.1","user-agent":"UA-Teste/1.0"}'`);
    await rpc(db, U.socioA, `public.sig_log_event('${d.id}', 'read_started')`);
    await db.exec(`set request.headers = '{"cf-connecting-ip":"192.0.2.99","x-forwarded-for":"198.51.100.5"}'`);
    await rpc(db, U.socioA, `public.sig_log_event('${d.id}', 'read_completed', ${j({ pages_seen: 3, pages_total: 3, nome: 'invasor', senha: 'x' })})`);
    await db.exec(`reset request.headers`);
    const e = await q<{ kind: string; ip: string; user_agent: string | null; meta: Record<string, unknown> }>(db,
      `select kind, ip, user_agent, meta from public.sig_events where document_id = '${d.id}' order by id`);
    expect(e[0]).toMatchObject({ kind: 'read_started', ip: '198.51.100.5', user_agent: 'UA-Teste/1.0' });
    expect(e[1].ip).toBe('192.0.2.99');
    expect(e[1].meta).toEqual({ pages_seen: 3, pages_total: 3 });
  });
});

describe('entradas hostis', () => {
  it('o mesmo evento repetido em menos de 60 s não vira outra linha', async () => {
    const d = await publishedDoc(db, {}, [U.socioB]);
    const a = await rpc<Sig>(db, U.socioB, `public.sig_log_event('${d.id}', 'viewed')`);
    const b = await rpc<Sig>(db, U.socioB, `public.sig_log_event('${d.id}', 'viewed')`);
    expect(a.deduped).toBeUndefined();
    expect(b).toEqual({ ok: true, deduped: true });
    expect(await eventsOf(d.id, U.socioB)).toEqual(['viewed']);
    await rpc(db, U.socioB, `public.sig_log_event('${d.id}', 'read_started')`);
    expect(await eventsOf(d.id, U.socioB)).toEqual(['viewed', 'read_started']);
  });

  it('páginas lidas que não são número viram "leitura incompleta", não erro bruto', async () => {
    const d = await publishedDoc(db, {}, [U.socioB]);
    await rpc(db, U.socioB, `public.sig_log_event('${d.id}', 'read_started')`);
    for (const ruim of ['abc', '', '3; drop table x', '-1', '99999']) {
      expect(await rpcError(db, U.socioB, `public.sig_log_event('${d.id}', 'read_completed', ${j({ pages_seen: ruim, pages_total: 3 })})`)).toContain('SIG_READ_INCOMPLETE');
    }
  });

  it('GPS e aparelho absurdos são descartados em silêncio; a assinatura segue possível', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB, U.socioC]);
    for (const u of [U.socioA, U.socioB, U.socioC]) { await readAndConsent(db, u, d.id); await saveCpf(db, u, u === U.socioA ? CPF.a : u === U.socioB ? CPF.b : CPF.c); }
    const ev = async (id: string) => (await q<{ evidence: Record<string, any> }>(db, `select evidence from sig_private.challenges where id = '${id}'`))[0].evidence;
    const a = await issue(db, U.socioA, d.id, '123456', { geo: { lat: 'abc', lng: '38; select 1' }, device: ['x'] });
    expect(a.ok).toBe(true);
    expect(await ev(a.challenge_id)).toEqual({ geo: {}, device: {} });
    const b = await issue(db, U.socioB, d.id, '123456', { geo: { lat: -3.7, lng: -38.5, accuracy_m: 'muito' }, device: { x: 'y'.repeat(3000) } });
    expect(await ev(b.challenge_id)).toEqual({ geo: { lat: -3.7, lng: -38.5 }, device: {} });
    const c = await issue(db, U.socioC, d.id, '123456', { geo: 'texto solto', device: 42 });
    expect(await ev(c.challenge_id)).toEqual({ geo: {}, device: {} });
  });
});

describe('CPF declarado', () => {
  it('valida os dígitos, aceita máscara e guarda só números', async () => {
    for (const ruim of ['12345678900', '11111111111', '123', '', 'abc']) {
      expect(await rpcError(db, U.socioB, `public.sig_save_my_cpf('${ruim}')`)).toContain('SIG_CPF_INVALID');
    }
    await rpc(db, U.socioB, `public.sig_save_my_cpf('111.444.777-35')`);
    expect((await q<{ cpf: string }>(db, `select cpf from public.sig_member_identities where profile_id = '${U.socioB}'`))[0].cpf).toBe(CPF.b);
  });

  it('depois da primeira assinatura o CPF não muda pelo app', async () => {
    const d = await publishedDoc(db, {}, [U.socioC]);
    await rpc(db, U.socioC, `public.sig_save_my_cpf('${CPF.a}')`); // ainda sem assinatura: pode corrigir
    await rpc(db, U.socioC, `public.sig_save_my_cpf('${CPF.c}')`);
    await signAs(db, U.socioC, d.id);
    expect(await rpcError(db, U.socioC, `public.sig_save_my_cpf('${CPF.a}')`)).toContain('SIG_CPF_LOCKED');
    expect(await rpcError(db, U.socioC, `public.sig_save_my_cpf('${CPF.c}')`)).toBeNull();
  });
});

describe('pedir o código (sig_svc_issue_challenge)', () => {
  it('só depois da leitura, do aceite e do CPF; as razões voltam sem exceção', async () => {
    // O admin também é sócio e ainda não declarou CPF neste mundo de teste.
    const d = await publishedDoc(db, {}, [U.admin]);
    expect(await issue(db, U.admin, d.id)).toMatchObject({ ok: false, reason: 'cpf_required' });
    await saveCpf(db, U.admin, CPF.admin);
    expect(await issue(db, U.admin, d.id)).toMatchObject({ ok: false, reason: 'read_required' });
    await rpc(db, U.admin, `public.sig_log_event('${d.id}', 'read_started')`);
    await rpc(db, U.admin, `public.sig_log_event('${d.id}', 'read_completed', ${j({ pages_seen: 3, pages_total: 3 })})`);
    expect(await issue(db, U.admin, d.id)).toMatchObject({ ok: false, reason: 'consent_required' });
    await rpc(db, U.admin, `public.sig_log_event('${d.id}', 'consent_checked')`);
    expect(await issue(db, U.admin, d.id)).toMatchObject({ ok: true });
  });

  it('recusa quem não pode assinar', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.semFone]);
    expect(await issue(db, U.socioB, d.id)).toMatchObject({ ok: false, reason: 'not_recipient' });
    expect(await issue(db, U.lanch, d.id)).toMatchObject({ ok: false, reason: 'not_recipient' });
    await readAndConsent(db, U.semFone, d.id);
    await saveCpf(db, U.semFone, CPF.semFone);
    expect(await issue(db, U.semFone, d.id)).toMatchObject({ ok: false, reason: 'no_phone' });
    const arq = await publishedDoc(db, {}, [U.socioA]);
    await rpc(db, U.admin, `public.sig_archive('${arq.id}')`);
    expect(await issue(db, U.socioA, arq.id)).toMatchObject({ ok: false, reason: 'not_published' });
    expect(await issue(db, U.socioA, '00000000-0000-4000-8000-0000000000ff')).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('só aceita código de 6 dígitos', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    for (const ruim of ['12345', '1234567', 'abcdef', '12 456']) {
      await expect(issue(db, U.socioA, d.id, ruim)).rejects.toThrow('SIG_BAD_CODE_FORMAT');
    }
  });

  it('devolve o necessário para o envio e NÃO guarda o código em claro', async () => {
    const d = await publishedDoc(db, { title: 'Termo das quadras' }, [U.socioA]);
    await readAndConsent(db, U.socioA, d.id);
    await saveCpf(db, U.socioA, CPF.a);
    const r = await issue(db, U.socioA, d.id, '482913');
    expect(r).toMatchObject({ ok: true, phone: '85900000002', name: 'Ana Sócia', title: 'Termo das quadras' });
    const min = (new Date(r.expires_at).getTime() - Date.now()) / 60000;
    expect(min).toBeGreaterThan(9);
    expect(min).toBeLessThanOrEqual(10);
    const c = (await q<{ code_hash: string; salt: string; status: string; attempts: number }>(db, `select code_hash, salt, status, attempts from sig_private.challenges where id = '${r.challenge_id}'`))[0];
    expect(c).toMatchObject({ status: 'pending', attempts: 0 });
    expect(JSON.stringify(c)).not.toContain('482913');
    expect(c.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await q<{ ok: boolean }>(db, `select sig_private.sha256_hex('${c.salt}:482913') = '${c.code_hash}' as ok`))[0].ok).toBe(true);
  });

  it('segura reenvio antes de 60 s e substitui o desafio anterior depois', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await readAndConsent(db, U.socioA, d.id);
    await saveCpf(db, U.socioA, CPF.a);
    const a = await issue(db, U.socioA, d.id, '111111');
    const cedo = await issue(db, U.socioA, d.id, '222222');
    expect(cedo).toMatchObject({ ok: false, reason: 'too_soon' });
    expect(cedo.retry_in_seconds).toBeGreaterThan(0);
    expect(cedo.retry_in_seconds).toBeLessThanOrEqual(60);
    await age(d.id, U.socioA, '61 seconds');
    const b = await issue(db, U.socioA, d.id, '222222');
    expect(b.ok).toBe(true);
    expect((await q<{ status: string }>(db, `select status from sig_private.challenges where id = '${a.challenge_id}'`))[0].status).toBe('superseded');
    expect(await verify(db, U.socioA, a.challenge_id, '111111')).toMatchObject({ ok: false, reason: 'superseded' });
    expect(await verify(db, U.socioA, b.challenge_id, '222222')).toMatchObject({ ok: true });
  });

  it('no máximo 5 códigos por hora', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await readAndConsent(db, U.socioA, d.id);
    await saveCpf(db, U.socioA, CPF.a);
    for (let i = 0; i < 5; i++) {
      expect((await issue(db, U.socioA, d.id, `10000${i}`)).ok).toBe(true);
      await age(d.id, U.socioA);
    }
    expect(await issue(db, U.socioA, d.id, '999999')).toMatchObject({ ok: false, reason: 'rate_limited' });
    await age(d.id, U.socioA, '1 hour');
    expect((await issue(db, U.socioA, d.id, '999999')).ok).toBe(true);
  });

  it('GPS entra só se for coordenada plausível; o aparelho é registrado', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    for (const u of [U.socioA, U.socioB]) { await readAndConsent(db, u, d.id); await saveCpf(db, u, u === U.socioA ? CPF.a : CPF.b); }
    const bom = await issue(db, U.socioA, d.id, '123456', { geo: { lat: -3.7319, lng: -38.5267, accuracy_m: 18 }, device: { timezone: 'America/Fortaleza' } });
    const ruim = await issue(db, U.socioB, d.id, '123456', { geo: { lat: 200, lng: 10 } });
    const ev = async (id: string) => (await q<{ evidence: Record<string, any> }>(db, `select evidence from sig_private.challenges where id = '${id}'`))[0].evidence;
    expect((await ev(bom.challenge_id)).geo).toMatchObject({ lat: -3.7319, lng: -38.5267, accuracy_m: 18 });
    expect((await ev(bom.challenge_id)).device).toEqual({ timezone: 'America/Fortaleza' });
    expect((await ev(ruim.challenge_id)).geo).toEqual({});
  });
});

describe('assinar (sig_svc_verify_code)', () => {
  it('grava o dossiê completo', async () => {
    const d = await publishedDoc(db, { title: 'Regulamento das quadras' }, [U.socioA]);
    const r = await signAs(db, U.socioA, d.id);
    expect(r).toMatchObject({ ok: true, seq: 1 });
    const s = await sigOf(d.id, U.socioA);
    expect(s).toMatchObject({
      signer_name: 'Ana Sócia', signer_phone: '85900000002', signer_cpf: CPF.a,
      document_title: 'Regulamento das quadras', document_version: 1,
      consent_text: 'Li e concordo com todos os termos do documento "Regulamento das quadras" (versão 1).',
      pages_seen: 3, pages_total: 3, code_attempts: 1, provider_message_id: 'wamid.482913',
      ip: '203.0.113.8', user_agent: 'Mozilla/5.0 teste', seq: 1, prev_chain_hash: null,
    });
    expect(s.document_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.evidence_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.geo).toEqual({ source: 'ip', city: 'Fortaleza', region: 'CE', country: 'BR' });
    expect(s.device).toEqual({ timezone: 'America/Fortaleza' });
    expect(s.read_seconds).toBeGreaterThanOrEqual(0);
    // a ordem dos fatos é a ordem do servidor
    const t = (k: string) => new Date(s[k]).getTime();
    expect(t('read_started_at')).toBeLessThanOrEqual(t('read_completed_at'));
    expect(t('read_completed_at')).toBeLessThanOrEqual(t('accepted_at'));
    expect(t('code_sent_at')).toBeLessThanOrEqual(t('code_verified_at'));
    expect(t('code_verified_at')).toBeLessThanOrEqual(t('signed_at'));
    // retratos: o documento publicado tem o mesmo hash
    expect((await q<{ content_sha256: string }>(db, `select content_sha256 from public.sig_documents where id = '${d.id}'`))[0].content_sha256).toBe(s.document_sha256);
  });

  it('a trilha de eventos conta a história inteira', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await signAs(db, U.socioA, d.id);
    expect(await eventsOf(d.id, U.socioA)).toEqual(['viewed', 'read_started', 'read_completed', 'consent_checked', 'code_requested', 'code_sent', 'signed']);
  });

  it('com GPS, a prova guarda as coordenadas além da cidade do IP', async () => {
    const d = await publishedDoc(db, {}, [U.socioB]);
    await readAndConsent(db, U.socioB, d.id);
    await saveCpf(db, U.socioB, CPF.b);
    const ch = await issue(db, U.socioB, d.id, '654321', { geo: { lat: -3.73, lng: -38.52, accuracy_m: 25 } });
    await svc(db, `public.sig_svc_mark_code_sent('${ch.challenge_id}', 'wamid.x')`);
    await verify(db, U.socioB, ch.challenge_id, '654321');
    const s = await sigOf(d.id, U.socioB);
    expect(s.geo).toEqual({ source: 'gps', lat: -3.73, lng: -38.52, accuracy_m: 25, city: 'Fortaleza', region: 'CE', country: 'BR' });
  });

  it('marca o destinatário como assinado e atualiza a lista do sócio', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    expect(await rpc<number>(db, U.socioA, `public.sig_my_pending_count()`)).toBeGreaterThanOrEqual(1);
    await signAs(db, U.socioA, d.id);
    const rec = (await q<{ signed_at: string | null; signature_id: string | null }>(db, `select signed_at, signature_id from public.sig_recipients where document_id = '${d.id}'`))[0];
    expect(rec.signed_at).not.toBeNull();
    expect(rec.signature_id).toBe((await sigOf(d.id, U.socioA)).id);
    const mine = await asUser<{ signed_at: string | null; consent_text: string }>(db, U.socioA, `select signed_at, consent_text from public.sig_my_documents() where document_id = '${d.id}'`);
    expect(mine[0].signed_at).not.toBeNull();
    expect(mine[0].consent_text).toContain('(versão 1)');
  });

  it('código errado conta tentativa (e a contagem NÃO é desfeita) até travar na 5ª', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await readAndConsent(db, U.socioA, d.id);
    await saveCpf(db, U.socioA, CPF.a);
    const ch = await issue(db, U.socioA, d.id, '246810');
    expect(await verify(db, U.socioA, ch.challenge_id, '000000')).toEqual({ ok: false, reason: 'wrong_code', attempts_left: 4 });
    expect(await verify(db, U.socioA, ch.challenge_id, '000001')).toMatchObject({ reason: 'wrong_code', attempts_left: 3 });
    expect((await q<{ attempts: number }>(db, `select attempts from sig_private.challenges where id = '${ch.challenge_id}'`))[0].attempts).toBe(2);
    await verify(db, U.socioA, ch.challenge_id, '000002');
    await verify(db, U.socioA, ch.challenge_id, '000003');
    expect(await verify(db, U.socioA, ch.challenge_id, '000004')).toEqual({ ok: false, reason: 'locked', attempts_left: 0 });
    // travado: nem o código certo vale mais
    expect(await verify(db, U.socioA, ch.challenge_id, '246810')).toMatchObject({ ok: false, reason: 'locked' });
    expect(await sigOf(d.id, U.socioA)).toBeUndefined();
    expect(await eventsOf(d.id, U.socioA)).toEqual(expect.arrayContaining(['code_wrong', 'code_locked']));
    // pode pedir outro código depois da espera
    await age(d.id, U.socioA);
    const novo = await issue(db, U.socioA, d.id, '135791');
    expect(await verify(db, U.socioA, novo.challenge_id, '135791')).toMatchObject({ ok: true });
  });

  it('código expirado (10 min) não assina', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await readAndConsent(db, U.socioA, d.id);
    await saveCpf(db, U.socioA, CPF.a);
    const ch = await issue(db, U.socioA, d.id, '246810');
    await db.exec(`update sig_private.challenges set expires_at = now() - interval '1 second' where id = '${ch.challenge_id}'`);
    expect(await verify(db, U.socioA, ch.challenge_id, '246810')).toMatchObject({ ok: false, reason: 'expired' });
    expect((await q<{ status: string }>(db, `select status from sig_private.challenges where id = '${ch.challenge_id}'`))[0].status).toBe('expired');
    expect(await eventsOf(d.id, U.socioA)).toContain('code_expired');
  });

  it('mesmo código certo enviado duas vezes devolve a mesma assinatura, sem duplicar', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    const a = await signAs(db, U.socioA, d.id);
    const ch = (await q<{ id: string }>(db, `select id from sig_private.challenges where document_id = '${d.id}'`))[0];
    const b = await verify(db, U.socioA, ch.id, '482913');
    expect(b).toMatchObject({ ok: true, replayed: true, signature_id: a.signature_id });
    expect(await q(db, `select 1 from public.sig_signatures where document_id = '${d.id}'`)).toHaveLength(1);
    expect(await issue(db, U.socioA, d.id)).toMatchObject({ ok: false, reason: 'already_signed' });
  });

  it('um desafio só vale para o sócio que o pediu', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    await readAndConsent(db, U.socioA, d.id);
    await saveCpf(db, U.socioA, CPF.a);
    const ch = await issue(db, U.socioA, d.id, '246810');
    expect(await verify(db, U.socioB, ch.challenge_id, '246810')).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await verify(db, U.socioA, '00000000-0000-4000-8000-0000000000ff', '246810')).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('falha no envio do WhatsApp invalida o desafio', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await readAndConsent(db, U.socioA, d.id);
    await saveCpf(db, U.socioA, CPF.a);
    const ch = await issue(db, U.socioA, d.id, '246810');
    await svc(db, `public.sig_svc_mark_code_sent('${ch.challenge_id}', null, 'instância desconectada')`);
    expect(await verify(db, U.socioA, ch.challenge_id, '246810')).toMatchObject({ ok: false, reason: 'failed' });
    expect(await eventsOf(d.id, U.socioA)).toContain('code_send_failed');
  });

  it('quem deixou de ser sócio entre o pedido e a digitação não assina', async () => {
    const d = await publishedDoc(db, {}, [U.socioC]);
    await readAndConsent(db, U.socioC, d.id);
    await saveCpf(db, U.socioC, CPF.c);
    const ch = await issue(db, U.socioC, d.id, '246810');
    await db.exec(`update public.profiles set is_active = false where id = '${U.socioC}'`);
    expect(await verify(db, U.socioC, ch.challenge_id, '246810')).toMatchObject({ ok: false, reason: 'not_member' });
    await db.exec(`update public.profiles set is_active = true where id = '${U.socioC}'`);
    expect(await verify(db, U.socioC, ch.challenge_id, '246810')).toMatchObject({ ok: true });
  });

  it('documento arquivado entre o pedido e a digitação não recebe assinatura', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await readAndConsent(db, U.socioA, d.id);
    await saveCpf(db, U.socioA, CPF.a);
    const ch = await issue(db, U.socioA, d.id, '246810');
    await rpc(db, U.admin, `public.sig_archive('${d.id}')`);
    expect(await verify(db, U.socioA, ch.challenge_id, '246810')).toMatchObject({ ok: false, reason: 'not_published' });
  });
});

describe('cadeia de assinaturas e integridade', () => {
  it('numera, encadeia e confere', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB, U.socioC]);
    await signAs(db, U.socioA, d.id);
    await signAs(db, U.socioB, d.id);
    await signAs(db, U.socioC, d.id);
    const s = await q<{ seq: number; prev_chain_hash: string | null; chain_hash: string; evidence_hash: string }>(db,
      `select seq, prev_chain_hash, chain_hash, evidence_hash from public.sig_signatures where document_id = '${d.id}' order by seq`);
    expect(s.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(s[0].prev_chain_hash).toBeNull();
    expect(s[1].prev_chain_hash).toBe(s[0].chain_hash);
    expect(s[2].prev_chain_hash).toBe(s[1].chain_hash);
    expect(new Set(s.map((x) => x.chain_hash)).size).toBe(3);
    expect(await rpc(db, U.admin, `public.sig_verify_integrity('${d.id}')`)).toEqual({ checked: 3, ok: true, problems: [] });
  });

  it('o hash não depende do fuso da sessão', async () => {
    const d = await publishedDoc(db, {}, [U.socioA]);
    await signAs(db, U.socioA, d.id);
    await db.exec(`set time zone 'Asia/Tokyo'`);
    const r = await rpc<{ ok: boolean }>(db, U.admin, `public.sig_verify_integrity('${d.id}')`);
    await db.exec(`reset time zone`);
    expect(r.ok).toBe(true);
  });

  it('adulterar um campo é detectado', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    await signAs(db, U.socioA, d.id);
    await signAs(db, U.socioB, d.id);
    await db.exec(`alter table public.sig_signatures disable trigger sig_signatures_append_only`);
    try {
      await db.exec(`update public.sig_signatures set signer_name = 'Outra Pessoa' where document_id = '${d.id}' and seq = 1`);
    } finally {
      await db.exec(`alter table public.sig_signatures enable trigger sig_signatures_append_only`);
    }
    const r = await rpc<{ ok: boolean; problems: Array<{ seq: number; problem: string }> }>(db, U.admin, `public.sig_verify_integrity('${d.id}')`);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([{ seq: 1, problem: 'evidence_changed' }]);
  });

  it('apagar uma assinatura do meio quebra a cadeia', async () => {
    const d = await publishedDoc(db, {}, [U.socioA, U.socioB, U.socioC]);
    await signAs(db, U.socioA, d.id);
    await signAs(db, U.socioB, d.id);
    await signAs(db, U.socioC, d.id);
    await db.exec(`alter table public.sig_signatures disable trigger sig_signatures_append_only`);
    try {
      await db.exec(`update public.sig_recipients set signed_at = null, signature_id = null where document_id = '${d.id}' and profile_id = '${U.socioB}';
        delete from public.sig_signatures where document_id = '${d.id}' and seq = 2`);
    } finally {
      await db.exec(`alter table public.sig_signatures enable trigger sig_signatures_append_only`);
    }
    const r = await rpc<{ ok: boolean; problems: Array<{ seq: number; problem: string }> }>(db, U.admin, `public.sig_verify_integrity('${d.id}')`);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.problem)).toEqual(expect.arrayContaining(['sequence_gap', 'chain_broken']));
  });

  it('assinaturas simultâneas de documentos diferentes não se misturam', async () => {
    const a = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    const b = await publishedDoc(db, {}, [U.socioA, U.socioB]);
    await signAs(db, U.socioA, a.id);
    await signAs(db, U.socioA, b.id);
    await signAs(db, U.socioB, b.id);
    const seqs = await q<{ document_id: string; seq: number }>(db, `select document_id, seq from public.sig_signatures where document_id in ('${a.id}', '${b.id}') order by document_id, seq`);
    expect(seqs.filter((x) => x.document_id === a.id).map((x) => x.seq)).toEqual([1]);
    expect(seqs.filter((x) => x.document_id === b.id).map((x) => x.seq)).toEqual([1, 2]);
  });
});
