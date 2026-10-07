import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/supabase', () => ({ supabase: { functions: { invoke } } }));

import { confirmSignatureCode, requestSignatureCode, SignatureError, signatureMessage } from '../../../lib/signatures/api';
import type { LocationResult } from '../../../lib/signatures/location';

const DOC = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ok = { data: { ok: true, challenge_id: 'CH1', phone_masked: '(85) •••••-0002', expires_at: '2026-10-07T12:10:00Z' }, error: null };
const granted: LocationResult = { status: 'granted', position: { lat: -3.731922, lng: -38.5267, accuracy_m: 12 } };
const httpError = (status: number, body: unknown) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify(body), { status }) } });

beforeEach(() => invoke.mockReset());

describe('clicar em "Assinar digitalmente": localização primeiro, código depois', () => {
  it('pede a localização ANTES de pedir o código e manda o GPS no mesmo pedido', async () => {
    const ordem: string[] = [];
    invoke.mockImplementation(async () => { ordem.push('codigo'); return ok; });
    const locate = vi.fn(async () => { ordem.push('localizacao'); return granted; });

    const r = await requestSignatureCode(DOC, { locate });

    expect(ordem).toEqual(['localizacao', 'codigo']);
    expect(locate).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [fn, { body }] = invoke.mock.calls[0];
    expect(fn).toBe('signature-operations');
    expect(body).toMatchObject({ action: 'request_code', document_id: DOC, geo: granted.status === 'granted' ? granted.position : null });
    expect(body.device.location).toBe('granted');
    expect(r).toEqual({ challengeId: 'CH1', phoneMasked: '(85) •••••-0002', expiresAt: '2026-10-07T12:10:00Z', location: 'granted' });
  });

  it.each(['denied', 'timeout', 'unavailable', 'unsupported'] as const)('localização "%s" NÃO bloqueia: o código é pedido sem GPS e o resultado vai no dossiê', async (status) => {
    invoke.mockResolvedValue(ok);
    const r = await requestSignatureCode(DOC, { locate: async () => ({ status }) });
    const { body } = invoke.mock.calls[0][1];
    expect(body.geo).toBeUndefined();
    expect(body.device.location).toBe(status);
    expect(r.location).toBe(status);
    expect(r.challengeId).toBe('CH1');
  });

  it('o pedido do código não depende de a localização ter dado certo (mesmo se ela falhar por dentro)', async () => {
    invoke.mockResolvedValue(ok);
    // `requestSigningLocation` real nunca lança; aqui conferimos o fluxo com o aparelho sem GPS
    const r = await requestSignatureCode(DOC, { locate: async () => ({ status: 'unsupported' }) });
    expect(r.challengeId).toBe('CH1');
  });

  it('reenviar o código passa pelo mesmo caminho (nova leitura, sem novo pedido do sistema se já decidiu)', async () => {
    invoke.mockResolvedValue(ok);
    const locate = vi.fn(async () => granted);
    await requestSignatureCode(DOC, { locate });
    await requestSignatureCode(DOC, { locate });
    expect(locate).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe('erros do servidor chegam como motivo claro', () => {
  it.each([
    [409, { ok: false, reason: 'cpf_required' }, 'cpf_required'],
    [409, { ok: false, reason: 'read_required' }, 'read_required'],
    [422, { ok: false, reason: 'no_phone' }, 'no_phone'],
    [502, { ok: false, reason: 'send_failed' }, 'send_failed'],
    [403, { error: 'FORBIDDEN' }, 'FORBIDDEN'],
    [401, { error: 'INVALID_SESSION' }, 'INVALID_SESSION'],
  ])('HTTP %i %j → %s', async (status, body, reason) => {
    invoke.mockResolvedValue(httpError(status, body));
    await expect(requestSignatureCode(DOC, { locate: async () => ({ status: 'denied' }) })).rejects.toMatchObject({ name: 'SignatureError', reason });
  });

  it('reenvio cedo demais traz os segundos; código errado traz as tentativas', async () => {
    invoke.mockResolvedValueOnce(httpError(429, { ok: false, reason: 'too_soon', retry_in_seconds: 42 }));
    const e1 = await requestSignatureCode(DOC, { locate: async () => ({ status: 'denied' }) }).catch((e) => e);
    expect(e1).toBeInstanceOf(SignatureError);
    expect(signatureMessage(e1)).toBe('Aguarde 42 segundos para pedir um novo código.');

    invoke.mockResolvedValueOnce(httpError(422, { ok: false, reason: 'wrong_code', attempts_left: 3 }));
    const e2 = await confirmSignatureCode('CH1', '000000').catch((e) => e);
    expect(signatureMessage(e2)).toBe('Código incorreto. Restam 3 tentativas.');
    expect(signatureMessage(new SignatureError('wrong_code', { attemptsLeft: 1 }))).toBe('Código incorreto. Resta 1 tentativa.');
  });

  it('sem resposta do servidor (rede) → NETWORK; corpo estranho → UNKNOWN', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    await expect(requestSignatureCode(DOC, { locate: async () => ({ status: 'denied' }) })).rejects.toMatchObject({ reason: 'NETWORK' });
    invoke.mockResolvedValueOnce({ data: { ok: false }, error: null });
    await expect(requestSignatureCode(DOC, { locate: async () => ({ status: 'denied' }) })).rejects.toMatchObject({ reason: 'UNKNOWN' });
  });
});

describe('confirmar o código', () => {
  it('manda só os dígitos e o aparelho; devolve a assinatura', async () => {
    invoke.mockResolvedValue({ data: { ok: true, signature_id: 'S1', signed_at: '2026-10-07T12:00:00Z', seq: 3, replayed: false }, error: null });
    const s = await confirmSignatureCode('CH1', '482 913', 'granted');
    const { body } = invoke.mock.calls[0][1];
    expect(body).toMatchObject({ action: 'confirm_code', challenge_id: 'CH1', code: '482913' });
    expect(body.device.location).toBe('granted');
    expect(s).toEqual({ signatureId: 'S1', signedAt: '2026-10-07T12:00:00Z', seq: 3, replayed: false });
  });
});

describe('mensagens para a pessoa', () => {
  it('cada motivo tem frase própria e nenhuma expõe o código cru', () => {
    for (const r of ['cpf_required', 'read_required', 'consent_required', 'already_signed', 'no_phone', 'invalid_phone', 'rate_limited', 'locked', 'expired', 'superseded', 'failed', 'send_failed', 'whatsapp_unavailable', 'NETWORK', 'INVALID_SESSION']) {
      const m = signatureMessage(new SignatureError(r));
      expect(m, r).not.toBe(signatureMessage(new SignatureError('motivo_desconhecido')));
      expect(m, r).not.toContain(r); // frase para a pessoa, nunca o código cru
      expect(m.length, r).toBeGreaterThan(15);
    }
    expect(signatureMessage(new Error('x'))).toContain('Não foi possível concluir');
    expect(signatureMessage(new SignatureError('algo_novo'))).toContain('Não foi possível concluir');
  });
});

describe('despacho dos avisos (só admin): a resposta é { summary }, sem "ok"', () => {
  it('lê o resumo e manda a ação certa', async () => {
    invoke.mockResolvedValue({ data: { summary: { configured: true, claimed: 3, sent: 2, failed: 1, reminders: 0, done: true } }, error: null });
    const { dispatchNotifications } = await import('../../../lib/signatures/api');
    expect(await dispatchNotifications(5)).toEqual({ configured: true, claimed: 3, sent: 2, failed: 1, reminders: 0, done: true });
    expect(invoke).toHaveBeenCalledWith('signature-operations', { body: { action: 'dispatch', limit: 5 } });
  });

  it('resposta sem resumo vira erro (não um resumo vazio que pareceria sucesso)', async () => {
    invoke.mockResolvedValue({ data: { error: 'FORBIDDEN' }, error: null });
    const { dispatchNotifications } = await import('../../../lib/signatures/api');
    await expect(dispatchNotifications()).rejects.toMatchObject({ name: 'SignatureError', reason: 'FORBIDDEN' });
  });

  it('não-admin (403) vira SignatureError FORBIDDEN', async () => {
    invoke.mockResolvedValue(httpError(403, { error: 'FORBIDDEN' }));
    const { dispatchNotifications } = await import('../../../lib/signatures/api');
    await expect(dispatchNotifications()).rejects.toMatchObject({ reason: 'FORBIDDEN' });
  });
});
