import { supabase } from '../supabase';

/**
 * Transporte das ações que precisam do provedor de WhatsApp (função `conversation-operations`).
 *
 * `supabase.functions.invoke` entrega "Edge Function returned a non-2xx status code" e esconde o
 * corpo em `error.context`. Aqui o corpo é aberto uma vez e o resto da tela passa a lidar com
 * códigos; o texto para a pessoa vem de `messageFor`.
 */
export class OperationError extends Error {
  constructor(readonly code: string, readonly detail = '') {
    super(code);
    this.name = 'OperationError';
  }
}

export type OperationBody = Record<string, unknown> & { action: string };

export async function callEdgeOperation<T>(functionName: string, body: OperationBody, key: keyof T & string): Promise<T[typeof key]> {
  // Garante envio explícito do token da sessão se existir (evita descompasso em PWAs móveis recém-abertos)
  let session: { access_token?: string } | null | undefined = null;
  try { session = (await supabase.auth.getSession())?.data?.session; } catch { /* sem sessão legível: o invoke manda o que tiver */ }
  const headers: Record<string, string> = {};
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const { data, error } = await supabase.functions.invoke(functionName, { body, headers });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (typeof Response !== 'undefined' && context instanceof Response) {
      const corpo = await context.json().catch(() => null) as { error?: string } | null;
      throw new OperationError(corpo?.error ?? 'UNKNOWN', error.message);
    }
    if (context && typeof (context as { json?: () => Promise<unknown> }).json === 'function') {
      const corpo = await (context as { json: () => Promise<unknown> }).json().catch(() => null) as { error?: string } | null;
      throw new OperationError(corpo?.error ?? 'UNKNOWN', error.message);
    }
    throw new OperationError('NETWORK', error.message);
  }
  return (data as T)[key];
}

export const COMMON_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Só administradores acessam Conversas. Se você deveria ter acesso, peça a outro administrador.',
  AUTH_REQUIRED: 'Sua sessão expirou. Entre novamente para continuar.',
  INVALID_SESSION: 'Sua sessão expirou. Entre novamente para continuar.',
  ORIGIN_FORBIDDEN: 'Este endereço do aplicativo não está autorizado a usar Conversas.',
  INVALID_PAYLOAD: 'Faltou algum dado obrigatório ou ele veio fora do formato esperado. Revise e tente de novo.',
  NETWORK: 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.',
  PAYLOAD_TOO_LARGE: 'O envio ficou grande demais. Divida em partes menores.',
};

const FALLBACK = 'A operação não foi concluída. Tente de novo; se continuar, avise quem administra o sistema.';

/** Traduz o código de erro numa frase com causa e correção (nunca o código cru). */
export function messageFor(messages: Record<string, string>) {
  return (error: unknown): string => {
    if (error instanceof OperationError) return messages[error.code] ?? FALLBACK;
    if (error && typeof error === 'object') {
      const e = error as { message?: unknown; code?: unknown };
      const texto = `${typeof e.message === 'string' ? e.message : ''}`;
      // Erros de RPC: o banco devolve o código `CONV_*`/`NOT_*` na mensagem.
      const achado = Object.keys(messages).find((c) => c !== 'FORBIDDEN' && texto.includes(c));
      if (achado) return messages[achado];
      if (texto.includes('CONV_FORBIDDEN') || e.code === '42501') return messages.FORBIDDEN ?? FALLBACK;
    }
    return FALLBACK;
  };
}
