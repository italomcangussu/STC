import { supabase } from '../supabase';
import { collectDevice } from './device';
import { requestSigningLocation, type LocationResult, type LocationStatus } from './location';

/**
 * Única porta do navegador para a assinatura do código (função `signature-operations`).
 *
 * `requestSignatureCode` é o que o botão "Assinar digitalmente" chama. Ele PRIMEIRO abre o pedido de
 * localização do sistema e só depois pede o código — o GPS vai junto, no mesmo pedido, e fica no dossiê.
 * A localização é opcional: negar, falhar ou demorar não impede a assinatura.
 *
 * O servidor devolve `{ ok:false, reason, … }` com status não-2xx; `supabase.functions.invoke` esconde esse
 * corpo em `error.context`. Aqui ele é aberto uma vez e o resto do app lida com `SignatureError`.
 */
export class SignatureError extends Error {
  constructor(readonly reason: string, readonly extra: { retryInSeconds?: number; attemptsLeft?: number } = {}) {
    super(reason);
    this.name = 'SignatureError';
  }
}

type ServerBody = { ok?: boolean; reason?: string; error?: string; retry_in_seconds?: number; attempts_left?: number } & Record<string, unknown>;

async function invokeSignatureOperation(body: Record<string, unknown>): Promise<ServerBody> {
  const { data, error } = await supabase.functions.invoke('signature-operations', { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (typeof Response !== 'undefined' && context instanceof Response) {
      const corpo = await context.json().catch(() => null) as ServerBody | null;
      throw new SignatureError(corpo?.reason ?? corpo?.error ?? 'UNKNOWN',
        { retryInSeconds: corpo?.retry_in_seconds, attemptsLeft: corpo?.attempts_left });
    }
    throw new SignatureError('NETWORK');
  }
  return (data ?? {}) as ServerBody;
}

async function callSignatureOperation(body: Record<string, unknown>): Promise<ServerBody> {
  const ok = await invokeSignatureOperation(body);
  if (ok.ok !== true) throw new SignatureError(ok.reason ?? ok.error ?? 'UNKNOWN');
  return ok;
}

export type DispatchSummary = { configured: boolean; claimed: number; sent: number; failed: number; reminders: number; done: boolean };

/**
 * Só administrador: despacha agora a fila de avisos de WhatsApp (uma volta; chame até `done`).
 * A resposta é `{ summary }` (sem `ok`), por isso não passa por `callSignatureOperation`.
 */
export async function dispatchNotifications(limit = 10): Promise<DispatchSummary> {
  const r = await invokeSignatureOperation({ action: 'dispatch', limit });
  const s = (r as { summary?: Partial<DispatchSummary> }).summary;
  if (!s) throw new SignatureError(r.error ?? r.reason ?? 'UNKNOWN');
  return {
    configured: s.configured === true, claimed: Number(s.claimed) || 0, sent: Number(s.sent) || 0,
    failed: Number(s.failed) || 0, reminders: Number(s.reminders) || 0, done: s.done === true,
  };
}

export type CodeRequested = {
  challengeId: string;
  /** `(88) •••••-1234`: para onde o código foi, sem expor o número. */
  phoneMasked: string;
  expiresAt: string;
  /** Como terminou o pedido de localização (a tela pode explicar o que fazer se foi negada). */
  location: LocationStatus;
};

export type FlowDeps = {
  /** Injeção para teste. */
  locate?: () => Promise<LocationResult>;
};

/** Ao clicar em "Assinar digitalmente": localização (tela do sistema) → pedido do código. Reenviar chama de novo. */
export async function requestSignatureCode(documentId: string, deps: FlowDeps = {}): Promise<CodeRequested> {
  // Primeira coisa do clique: se o sócio ainda não decidiu, é aqui que a tela do sistema aparece.
  const located = await (deps.locate ?? requestSigningLocation)();
  const r = await callSignatureOperation({
    action: 'request_code',
    document_id: documentId,
    ...(located.status === 'granted' ? { geo: located.position } : {}),
    device: collectDevice(located.status),
  });
  return { challengeId: String(r.challenge_id), phoneMasked: String(r.phone_masked ?? ''), expiresAt: String(r.expires_at ?? ''), location: located.status };
}

export type Signed = { signatureId: string; signedAt: string; seq: number; replayed: boolean };

export async function confirmSignatureCode(challengeId: string, code: string, location: LocationStatus = 'unsupported'): Promise<Signed> {
  const r = await callSignatureOperation({
    action: 'confirm_code', challenge_id: challengeId, code: code.replace(/\D/g, ''), device: collectDevice(location),
  });
  return { signatureId: String(r.signature_id), signedAt: String(r.signed_at), seq: Number(r.seq), replayed: r.replayed === true };
}

const MESSAGES: Record<string, string> = {
  cpf_required: 'Antes de assinar, informe o seu CPF.',
  read_required: 'Leia o documento até o fim para poder assinar.',
  consent_required: 'Marque "Li e concordo" para continuar.',
  already_signed: 'Você já assinou este documento.',
  not_found: 'Este documento não está disponível para você.',
  not_published: 'Este documento não está mais aberto para assinatura.',
  not_recipient: 'Este documento não foi enviado para você.',
  not_member: 'Só sócios ativos podem assinar.',
  no_phone: 'Seu cadastro está sem telefone. Peça a um administrador para cadastrar o seu WhatsApp.',
  invalid_phone: 'O telefone do seu cadastro não parece um WhatsApp válido. Peça a um administrador para corrigir.',
  rate_limited: 'Você pediu códigos demais. Tente de novo daqui a 1 hora.',
  whatsapp_unavailable: 'O envio por WhatsApp está indisponível agora. Tente de novo em instantes.',
  send_failed: 'Não conseguimos enviar o código pelo WhatsApp agora. Tente de novo em instantes.',
  locked: 'Código bloqueado por excesso de erros. Peça um código novo.',
  expired: 'O código venceu (vale 10 minutos). Peça um código novo.',
  superseded: 'Esse código foi substituído por um mais novo. Use o último que chegou.',
  failed: 'O código não chegou a ser enviado. Peça um código novo.',
  AUTH_REQUIRED: 'Sua sessão expirou. Entre novamente para continuar.',
  INVALID_SESSION: 'Sua sessão expirou. Entre novamente para continuar.',
  FORBIDDEN: 'Só sócios ativos podem assinar documentos.',
  ORIGIN_FORBIDDEN: 'Este endereço do aplicativo não está autorizado a assinar documentos.',
  INVALID_PAYLOAD: 'Faltou algum dado ou ele veio fora do formato. Confira o código de 6 dígitos e tente de novo.',
  NETWORK: 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.',
};

const FALLBACK = 'Não foi possível concluir a assinatura. Tente de novo; se continuar, avise quem administra o sistema.';

/** Frase para a pessoa, com a causa e o que fazer (nunca o código cru). */
export function signatureMessage(error: unknown): string {
  if (!(error instanceof SignatureError)) return FALLBACK;
  const { reason, extra } = error;
  if (reason === 'too_soon') return `Aguarde ${extra.retryInSeconds ?? 60} segundos para pedir um novo código.`;
  if (reason === 'wrong_code') {
    const n = extra.attemptsLeft;
    return n === undefined ? 'Código incorreto.' : `Código incorreto. ${n === 1 ? 'Resta 1 tentativa' : `Restam ${n} tentativas`}.`;
  }
  return MESSAGES[reason] ?? FALLBACK;
}
