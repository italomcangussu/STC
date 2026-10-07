// Fronteira HTTP de Documentos e Assinaturas (função `signature-operations`).
//
// Três ações, três regras de quem pode chamar:
//   request_code   sócio ativo (ou admin, que também assina): gera o código de 6 dígitos, grava só o hash
//                  (`sig_svc_issue_challenge`) e o envia pelo WhatsApp do CADASTRO dele;
//   confirm_code   sócio ativo: confere o código e grava a assinatura com o dossiê (`sig_svc_verify_code`);
//   dispatch       só admin: despacha a fila de avisos agora (o app chama logo após publicar, em voltas).
//
// Quem é o sócio vem do TOKEN validado, nunca do corpo (o corpo é o que o atacante controla); o telefone
// que recebe o código vem do banco, nunca do corpo. O código em claro existe só aqui, entre gerar e enviar:
// não é gravado, não é logado, não volta na resposta. O que o usuário pode errar (código errado, expirado,
// muito cedo) volta como `{ ok:false, reason }` com status HTTP; exceção do banco vira `REJECTED`.

import { dispatchSignatureNotifications } from './signatureDispatch.ts';
import type { GeoResolver } from './signatureGeo.ts';
import { clientIp } from './signatureGeo.ts';
import { codeMessage, maskPhone, toWhatsappNumber } from './signatureMessages.ts';
import { buildChatRequest, providerIdFrom, uazError, type UazCaller } from './uazChat.ts';
import { isPlainObject, MAX_BODY, response, text, UUID, type AdminDeps, type AdminEnvironment } from './adminRequest.ts';

export interface SignatureEnvironment extends AdminEnvironment {
  uaz: UazCaller | null;
  /** Endereço do app, base do link enviado por WhatsApp (ex.: https://stcplay.com.br). */
  appUrl: string;
  geo: GeoResolver;
  /** 6 dígitos. Injetável para o teste; em produção, `secureCode`. */
  randomCode(): string;
  sleep?(ms: number): Promise<void>;
}

/** 6 dígitos uniformes de uma fonte criptográfica (rejeita o resto da divisão para não enviesar). */
export function secureCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  let n: number;
  do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= limit);
  return String(n % 1_000_000).padStart(6, '0');
}

/** Motivo (devolvido pelo banco) → status HTTP. Motivo desconhecido não é traduzido: vira 400 genérico. */
const REASON_STATUS: Record<string, number> = {
  not_found: 404, not_recipient: 403, not_member: 403,
  already_signed: 409, not_published: 409, cpf_required: 409, read_required: 409, consent_required: 409,
  superseded: 409, failed: 409,
  no_phone: 422, wrong_code: 422, invalid_phone: 422,
  expired: 410, locked: 423, too_soon: 429, rate_limited: 429,
};

const CODE = /^[0-9]{6}$/;

/** GPS opcional: números finitos e dentro da faixa, com a precisão que o banco aceita (6 casas ≈ 10 cm). */
function sanitizeGeo(value: unknown): { lat: number; lng: number; accuracy_m?: number } | null {
  if (!isPlainObject(value)) return null;
  const { lat, lng, accuracy_m: acc } = value as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const out: { lat: number; lng: number; accuracy_m?: number } = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
  if (typeof acc === 'number' && Number.isFinite(acc) && acc >= 0 && acc < 10_000_000) out.accuracy_m = Number(acc.toFixed(1));
  return out;
}

const sanitizeDevice = (value: unknown): Record<string, unknown> => (isPlainObject(value) ? value : {});

export async function handleSignatureRequest(request: Request, deps: AdminDeps, env: SignatureEnvironment): Promise<Response> {
  const allowed = env.origin.split(',').map((o) => o.trim()).filter(Boolean);
  const requested = request.headers.get('origin');
  const origin = requested && allowed.includes(requested) ? requested : null;
  if (!origin) return response(403, { error: 'ORIGIN_FORBIDDEN' }, allowed[0] || 'null');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
      'vary': 'Origin',
    } });
  }
  if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' }, origin);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return response(413, { error: 'PAYLOAD_TOO_LARGE' }, origin);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) throw new Error('not an object');
    body = parsed;
  } catch {
    return response(400, { error: 'INVALID_JSON' }, origin);
  }

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return response(401, { error: 'AUTH_REQUIRED' }, origin);
  const session = await deps.verifyToken(token);
  if (!session) return response(401, { error: 'INVALID_SESSION' }, origin);

  // "Sócio" no STC inclui o admin (também assina). Aluno, professor e lanchonete não passam daqui.
  const actor = await deps.loadActor(session.userId);
  if (!actor || !actor.active || !['socio', 'admin'].includes(actor.role)) return response(403, { error: 'FORBIDDEN' }, origin);

  const action = text(body.action);
  const ip = clientIp(request.headers);
  const ua = (request.headers.get('user-agent') ?? '').slice(0, 400) || null;

  const fail = (reason: string, extra: Record<string, unknown> = {}) =>
    response(REASON_STATUS[reason] ?? 400, { ok: false, reason, ...extra }, origin);
  // Exceção do banco (formato inválido etc.): nunca a mensagem crua do Postgres.
  const rejected = () => response(400, { error: 'REJECTED' }, origin);

  if (action === 'request_code') {
    const documentId = text(body.document_id);
    if (!UUID.test(documentId)) return response(400, { error: 'INVALID_PAYLOAD' }, origin);
    // Sem WhatsApp não há como entregar o código: avisa ANTES de gastar uma das 5 tentativas por hora.
    if (!env.uaz) return response(503, { ok: false, reason: 'whatsapp_unavailable' }, origin);

    const geo = sanitizeGeo(body.geo);
    const code = env.randomCode();
    const issued = await deps.rpc('sig_svc_issue_challenge', {
      p_profile: actor.id, p_document: documentId, p_code: code,
      p_evidence: { ...(geo ? { geo } : {}), device: sanitizeDevice(body.device) }, p_ip: ip, p_ua: ua,
    });
    if (issued.error || !isPlainObject(issued.data)) return rejected();
    const c = issued.data as Record<string, unknown>;
    if (c.ok !== true) {
      return fail(String(c.reason ?? ''), typeof c.retry_in_seconds === 'number' ? { retry_in_seconds: c.retry_in_seconds } : {});
    }

    const number = toWhatsappNumber(String(c.phone ?? ''));
    const pedido = number
      ? buildChatRequest({ action: 'send', number, kind: 'text', text: codeMessage({ name: String(c.name ?? ''), title: String(c.title ?? ''), code }) })
      : null;
    const sent = pedido ? await env.uaz(pedido) : { ok: false as const, error: 'INVALID_PHONE' };
    await deps.rpc('sig_svc_mark_code_sent', {
      p_challenge: c.challenge_id,
      p_provider_id: sent.ok ? providerIdFrom((sent as { body: Record<string, unknown> }).body) : null,
      p_error: uazError(sent),
    });
    if (!sent.ok) return uazError(sent) === 'INVALID_PHONE' ? fail('invalid_phone') : response(502, { ok: false, reason: 'send_failed' }, origin);
    return response(200, { ok: true, challenge_id: c.challenge_id, phone_masked: maskPhone(String(c.phone ?? '')), expires_at: c.expires_at }, origin);
  }

  if (action === 'confirm_code') {
    const challengeId = text(body.challenge_id);
    const code = text(body.code);
    if (!UUID.test(challengeId) || !CODE.test(code)) return response(400, { error: 'INVALID_PAYLOAD' }, origin);

    const verified = await deps.rpc('sig_svc_verify_code', {
      p_challenge: challengeId, p_profile: actor.id, p_code: code, p_ip: ip, p_ua: ua,
      p_geo: (await env.geo(ip)) ?? {}, p_device: sanitizeDevice(body.device),
    });
    if (verified.error || !isPlainObject(verified.data)) return rejected();
    const v = verified.data as Record<string, unknown>;
    if (v.ok !== true) return fail(String(v.reason ?? ''), typeof v.attempts_left === 'number' ? { attempts_left: v.attempts_left } : {});
    return response(200, { ok: true, signature_id: v.signature_id, signed_at: v.signed_at, seq: v.seq, replayed: v.replayed === true }, origin);
  }

  if (action === 'dispatch') {
    if (actor.role !== 'admin') return response(403, { error: 'FORBIDDEN' }, origin);
    const limit = Math.max(1, Math.min(Math.floor(Number(body.limit)) || 10, 25));
    const summary = await dispatchSignatureNotifications((name, args) => deps.rpc(name, args), env.uaz, {
      appUrl: env.appUrl, limit, maxMs: 100_000, sleep: env.sleep,
    });
    return response(200, { summary }, origin);
  }

  return response(400, { error: 'UNKNOWN_ACTION' }, origin);
}
