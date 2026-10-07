// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AdminActor, AdminDeps, RpcResult } from '../../../supabase/functions/_shared/adminRequest';
import { handleSignatureRequest, secureCode, type SignatureEnvironment } from '../../../supabase/functions/_shared/signatureRequest';
import type { UazCaller } from '../../../supabase/functions/_shared/uazChat';

const ORIGIN = 'https://stcplay.com.br';
const DOC = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const CH = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ANA = '00000000-0000-4000-8000-000000000002';
const OUTRA = '00000000-0000-4000-8000-000000000003';

type Call = { name: string; args: Record<string, any> };

function setup(over: { actor?: Partial<AdminActor> | null; rpc?: Record<string, (a: any) => RpcResult | unknown>; uaz?: UazCaller | null; geo?: any } = {}) {
  const calls: Call[] = [];
  const sent: { number: string; text: string }[] = [];
  const actor: AdminActor | null = over.actor === null ? null : { id: ANA, role: 'socio', active: true, ...over.actor };
  const deps: AdminDeps = {
    verifyToken: async (t) => (t === 'tok' ? { userId: ANA } : null),
    loadActor: async () => actor,
    rpc: async (name, args) => {
      calls.push({ name, args });
      const h = over.rpc?.[name];
      const r = h ? h(args) : null;
      if (r && typeof r === 'object' && ('data' in (r as object) || 'error' in (r as object))) return r as RpcResult;
      return { data: r ?? null, error: null };
    },
  };
  const uaz: UazCaller | null = over.uaz === undefined
    ? async ({ body }) => { sent.push({ number: String(body.number), text: String(body.text) }); return { ok: true, body: { messageid: 'WAMID1' } }; }
    : over.uaz;
  const env: SignatureEnvironment = {
    origin: ORIGIN, uaz, appUrl: ORIGIN, geo: over.geo ?? (async () => ({ city: 'Fortaleza', region: 'CE', country: 'BR' })),
    randomCode: () => '482913', sleep: async () => {},
  };
  const call = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => handleSignatureRequest(
    new Request('https://x.test/functions/v1/signature-operations', {
      method, headers: { origin: ORIGIN, authorization: 'Bearer tok', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0 teste', ...headers },
      body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    }), deps, env);
  return { call, calls, sent, env };
}
const json = async (r: Response) => r.json() as Promise<Record<string, any>>;

const issueOk = { ok: true, challenge_id: CH, phone: '85900000002', name: 'Ana Sócia', title: 'Termo de uso', expires_at: '2026-10-07T12:10:00Z' };

describe('porta de entrada: quem pode chamar', () => {
  it('origem fora da lista é recusada; OPTIONS responde o CORS; só POST', async () => {
    const s = setup();
    expect((await s.call({}, { origin: 'https://outro.site' })).status).toBe(403);
    const opt = await s.call({}, {}, 'OPTIONS');
    expect(opt.status).toBe(204);
    expect(opt.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await s.call({}, {}, 'GET')).status).toBe(405);
  });
  it('corpo inválido, grande demais ou que não é objeto', async () => {
    const s = setup();
    expect((await s.call('{nao-json')).status).toBe(400);
    expect((await s.call('[1,2]')).status).toBe(400);
    expect((await s.call('x'.repeat(70_000))).status).toBe(413);
  });
  it('sem token → 401; token inválido → 401; nada vai ao banco', async () => {
    const s = setup();
    expect((await s.call({ action: 'request_code' }, { authorization: '' })).status).toBe(401);
    expect((await s.call({ action: 'request_code' }, { authorization: 'Bearer falso' })).status).toBe(401);
    expect(s.calls).toEqual([]);
  });
  it('aluno, professor, lanchonete, inativo ou sem perfil não passam; admin e sócio passam', async () => {
    for (const role of ['aluno', 'professor', 'lanchonete', 'student']) {
      expect((await setup({ actor: { role } }).call({ action: 'confirm_code' })).status).toBe(403);
    }
    expect((await setup({ actor: { active: false } }).call({ action: 'confirm_code' })).status).toBe(403);
    expect((await setup({ actor: null }).call({ action: 'confirm_code' })).status).toBe(403);
    for (const role of ['socio', 'admin']) {
      expect((await setup({ actor: { role } }).call({ action: 'confirm_code' })).status).toBe(400); // passou da porta; falta o corpo
    }
  });
  it('ação desconhecida → 400', async () => {
    expect((await setup().call({ action: 'apagar_tudo' })).status).toBe(400);
  });
});

describe('request_code: gera, grava só o hash, envia ao WhatsApp do CADASTRO', () => {
  it('caminho feliz: o código vai no WhatsApp e NÃO na resposta nem em lugar nenhum além disso', async () => {
    const s = setup({ rpc: { sig_svc_issue_challenge: () => issueOk } });
    const r = await s.call({ action: 'request_code', document_id: DOC });
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body).toEqual({ ok: true, challenge_id: CH, phone_masked: '(85) •••••-0002', expires_at: issueOk.expires_at });
    expect(JSON.stringify(body)).not.toContain('482913');
    expect(JSON.stringify(body)).not.toContain('900000002');

    // a mensagem leva o código, para o número do cadastro com DDI
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0].number).toBe('5585900000002');
    expect(s.sent[0].text).toContain('*482913*');
    expect(s.sent[0].text).toContain('Termo de uso');

    // o banco recebe o código só para gravar o hash; o envio é registrado com o id do provedor
    const issue = s.calls.find((c) => c.name === 'sig_svc_issue_challenge')!;
    expect(issue.args).toMatchObject({ p_profile: ANA, p_document: DOC, p_code: '482913', p_ip: '203.0.113.7', p_ua: 'Mozilla/5.0 teste' });
    expect(s.calls.find((c) => c.name === 'sig_svc_mark_code_sent')!.args).toEqual({ p_challenge: CH, p_provider_id: 'WAMID1', p_error: null });
    // o código não é gravado em mais nenhuma chamada
    expect(s.calls.filter((c) => JSON.stringify(c.args).includes('482913')).map((c) => c.name)).toEqual(['sig_svc_issue_challenge']);
  });

  it('quem pede é o dono do TOKEN: perfil e telefone enviados no corpo são ignorados', async () => {
    const s = setup({ rpc: { sig_svc_issue_challenge: () => issueOk } });
    await s.call({ action: 'request_code', document_id: DOC, profile_id: OUTRA, p_profile: OUTRA, phone: '85999990000' });
    const issue = s.calls.find((c) => c.name === 'sig_svc_issue_challenge')!;
    expect(issue.args.p_profile).toBe(ANA);
    expect(JSON.stringify(issue.args)).not.toContain('85999990000');
    expect(s.sent[0].number).toBe('5585900000002');
  });

  it('documento inválido → 400 sem tocar no banco; sem WhatsApp → 503 ANTES de gastar uma tentativa', async () => {
    const s = setup();
    expect((await s.call({ action: 'request_code', document_id: 'abc' })).status).toBe(400);
    expect((await s.call({ action: 'request_code' })).status).toBe(400);
    expect(s.calls).toEqual([]);
    const sem = setup({ uaz: null });
    const r = await sem.call({ action: 'request_code', document_id: DOC });
    expect(r.status).toBe(503);
    expect(await json(r)).toEqual({ ok: false, reason: 'whatsapp_unavailable' });
    expect(sem.calls).toEqual([]);
  });

  it.each([
    ['cpf_required', 409], ['read_required', 409], ['consent_required', 409], ['already_signed', 409], ['not_published', 409],
    ['not_recipient', 403], ['not_member', 403], ['not_found', 404], ['no_phone', 422], ['rate_limited', 429],
  ])('motivo %s → HTTP %i, e nada é enviado', async (reason, status) => {
    const s = setup({ rpc: { sig_svc_issue_challenge: () => ({ ok: false, reason }) } });
    const r = await s.call({ action: 'request_code', document_id: DOC });
    expect(r.status).toBe(status);
    expect(await json(r)).toEqual({ ok: false, reason });
    expect(s.sent).toEqual([]);
    expect(s.calls.map((c) => c.name)).toEqual(['sig_svc_issue_challenge']);
  });

  it('reenvio cedo demais: 429 com os segundos que faltam', async () => {
    const s = setup({ rpc: { sig_svc_issue_challenge: () => ({ ok: false, reason: 'too_soon', retry_in_seconds: 42 }) } });
    const r = await s.call({ action: 'request_code', document_id: DOC });
    expect(r.status).toBe(429);
    expect(await json(r)).toEqual({ ok: false, reason: 'too_soon', retry_in_seconds: 42 });
  });

  it('o WhatsApp falhou: 502, o banco registra o erro e o código não vaza', async () => {
    const s = setup({ rpc: { sig_svc_issue_challenge: () => issueOk }, uaz: async () => ({ ok: false, error: 'HTTP_503' }) });
    const r = await s.call({ action: 'request_code', document_id: DOC });
    expect(r.status).toBe(502);
    const text = JSON.stringify(await json(r));
    expect(text).toContain('send_failed');
    expect(text).not.toContain('482913');
    expect(s.calls.find((c) => c.name === 'sig_svc_mark_code_sent')!.args).toEqual({ p_challenge: CH, p_provider_id: null, p_error: 'HTTP_503' });
  });

  it('telefone do cadastro que não vale como WhatsApp → 422, nada enviado, erro registrado', async () => {
    const s = setup({ rpc: { sig_svc_issue_challenge: () => ({ ...issueOk, phone: '123' }) } });
    const r = await s.call({ action: 'request_code', document_id: DOC });
    expect(r.status).toBe(422);
    expect(await json(r)).toEqual({ ok: false, reason: 'invalid_phone' });
    expect(s.sent).toEqual([]);
    expect(s.calls.find((c) => c.name === 'sig_svc_mark_code_sent')!.args.p_error).toBe('INVALID_PHONE');
  });

  it('exceção do banco vira REJECTED, sem a mensagem crua do Postgres', async () => {
    const s = setup({ rpc: { sig_svc_issue_challenge: () => ({ data: null, error: { message: 'relation "sig_private.challenges" violates something' } }) } });
    const r = await s.call({ action: 'request_code', document_id: DOC });
    expect(r.status).toBe(400);
    const text = JSON.stringify(await json(r));
    expect(text).toBe('{"error":"REJECTED"}');
    expect(s.sent).toEqual([]);
  });

  describe('GPS (opcional) e aparelho', () => {
    const evidenceOf = async (body: Record<string, unknown>) => {
      const s = setup({ rpc: { sig_svc_issue_challenge: () => issueOk } });
      await s.call({ action: 'request_code', document_id: DOC, ...body });
      return s.calls.find((c) => c.name === 'sig_svc_issue_challenge')!.args.p_evidence;
    };
    it('GPS válido entra arredondado na precisão que o banco aceita', async () => {
      const e = await evidenceOf({ geo: { lat: -3.731922222222, lng: -38.526669999999, accuracy_m: 12.3456 }, device: { timezone: 'America/Fortaleza' } });
      expect(e).toEqual({ geo: { lat: -3.731922, lng: -38.52667, accuracy_m: 12.3 }, device: { timezone: 'America/Fortaleza' } });
    });
    it('GPS inválido é descartado em silêncio (nunca bloqueia)', async () => {
      for (const geo of [{ lat: '1', lng: '2' }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: NaN, lng: 0 }, 'x', null, [1, 2], {}]) {
        expect((await evidenceOf({ geo })).geo).toBeUndefined();
      }
    });
    it('aparelho que não é objeto vira {}', async () => {
      for (const device of ['x', 5, null, [1]]) expect((await evidenceOf({ device })).device).toEqual({});
    });
  });
});

describe('confirm_code: confere o código e assina', () => {
  const okVerify = { ok: true, signature_id: 'SIG1', signed_at: '2026-10-07T12:00:00Z', seq: 3, evidence_hash: 'h'.repeat(64) };

  it('caminho feliz: IP, aparelho e cidade vão ao banco; quem assina é o dono do TOKEN', async () => {
    const s = setup({ rpc: { sig_svc_verify_code: () => okVerify } });
    const r = await s.call({ action: 'confirm_code', challenge_id: CH, code: '482913', profile_id: OUTRA, device: { timezone: 'America/Fortaleza' } });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true, signature_id: 'SIG1', signed_at: '2026-10-07T12:00:00Z', seq: 3, replayed: false });
    expect(s.calls[0]).toEqual({ name: 'sig_svc_verify_code', args: {
      p_challenge: CH, p_profile: ANA, p_code: '482913', p_ip: '203.0.113.7', p_ua: 'Mozilla/5.0 teste',
      p_geo: { city: 'Fortaleza', region: 'CE', country: 'BR' }, p_device: { timezone: 'America/Fortaleza' } } });
  });

  it('chamada repetida com o código certo devolve a mesma assinatura (replayed)', async () => {
    const s = setup({ rpc: { sig_svc_verify_code: () => ({ ok: true, replayed: true, signature_id: 'SIG1', signed_at: 'x', seq: 3 }) } });
    expect((await json(await s.call({ action: 'confirm_code', challenge_id: CH, code: '482913' }))).replayed).toBe(true);
  });

  it('sem cidade (serviço fora do ar) a assinatura segue só com o IP', async () => {
    const s = setup({ rpc: { sig_svc_verify_code: () => okVerify }, geo: async () => null });
    expect((await s.call({ action: 'confirm_code', challenge_id: CH, code: '482913' })).status).toBe(200);
    expect(s.calls[0].args.p_geo).toEqual({});
  });

  it('formato inválido não chega ao banco', async () => {
    const s = setup();
    for (const code of ['12345', '1234567', 'abcdef', '12 345', '', 123456]) {
      expect((await s.call({ action: 'confirm_code', challenge_id: CH, code })).status).toBe(400);
    }
    expect((await s.call({ action: 'confirm_code', challenge_id: 'x', code: '482913' })).status).toBe(400);
    expect(s.calls).toEqual([]);
  });

  it.each([
    ['wrong_code', 422, { attempts_left: 3 }], ['locked', 423, { attempts_left: 0 }], ['expired', 410, {}], ['superseded', 409, {}],
    ['failed', 409, {}], ['not_found', 404, {}], ['already_signed', 409, {}],
  ])('motivo %s → HTTP %i', async (reason, status, extra) => {
    const s = setup({ rpc: { sig_svc_verify_code: () => ({ ok: false, reason, ...extra }) } });
    const r = await s.call({ action: 'confirm_code', challenge_id: CH, code: '000000' });
    expect(r.status).toBe(status);
    expect(await json(r)).toEqual({ ok: false, reason, ...extra });
  });

  it('motivo que o servidor não conhece vira 400 genérico, não 200', async () => {
    const s = setup({ rpc: { sig_svc_verify_code: () => ({ ok: false, reason: 'algo_novo' }) } });
    expect((await s.call({ action: 'confirm_code', challenge_id: CH, code: '000000' })).status).toBe(400);
  });
});

describe('dispatch: só o admin manda despachar a fila', () => {
  it('sócio comum → 403 e nada é despachado', async () => {
    const s = setup({ actor: { role: 'socio' } });
    expect((await s.call({ action: 'dispatch' })).status).toBe(403);
    expect(s.calls).toEqual([]);
  });
  it('admin → resumo; o limite é contido entre 1 e 25', async () => {
    const claim = vi.fn(() => []);
    const s = setup({ actor: { role: 'admin' }, rpc: { sig_svc_claim_notifications: claim } });
    const r = await s.call({ action: 'dispatch', limit: 1000 });
    expect(r.status).toBe(200);
    expect((await json(r)).summary).toEqual({ configured: true, claimed: 0, sent: 0, failed: 0, reminders: 0, done: true });
    expect(claim).toHaveBeenCalledTimes(1); // fila vazia: uma consulta
  });
  it('sem WhatsApp configurado informa configured:false e não pega nada da fila', async () => {
    const s = setup({ actor: { role: 'admin' }, uaz: null });
    const r = await json(await s.call({ action: 'dispatch' }));
    expect(r.summary.configured).toBe(false);
    expect(s.calls).toEqual([]);
  });
});

describe('código de 6 dígitos', () => {
  it('sempre 6 dígitos, com zeros à esquerda quando precisa, e não repete em série', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const c = secureCode();
      expect(c).toMatch(/^[0-9]{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(1900);
  });
  it('distribuição sem viés grosseiro: cada dígito inicial aparece', () => {
    const first = new Set<string>();
    for (let i = 0; i < 3000; i += 1) first.add(secureCode()[0]);
    expect(first.size).toBe(10);
  });
});
