// Cliente de chat compatível com a API da OpenAI (OpenRouter, OpenAI e afins).
//
// Portado de `_shared/aiAgent/llm.ts` do North Jato: o endereço é configurável (STC_AI_BASE_URL),
// para o clube não ficar preso a um provedor. Nada aqui interpreta a resposta: quem entende do
// formato é o parse do turno, com soft-fail. A chave só existe no servidor.

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatConfig = { model: string; temperature?: number; maxTokens?: number; json?: boolean };
export type ChatResult = { output: string; model: string; usage: Record<string, unknown> | null };
export type Chat = (messages: ChatMessage[], config: ChatConfig) => Promise<ChatResult>;

export class LlmError extends Error {
  constructor(readonly status: number, body: string) {
    // O corpo do erro do provedor pode ecoar a requisição: só o status e um trecho curto.
    super(`Provedor de IA respondeu ${status}: ${body.slice(0, 120)}`);
    this.name = 'LlmError';
  }
}

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export function buildChatBody(messages: ChatMessage[], config: ChatConfig): Record<string, unknown> {
  const body: Record<string, unknown> = { model: config.model, messages };
  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;
  if (config.json) body.response_format = { type: 'json_object' };
  return body;
}

export function chatClient(deps: { apiKey: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }): Chat {
  const url = `${(deps.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
  const doFetch = deps.fetch ?? fetch;
  return async (messages, config) => {
    const r = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.apiKey}`, 'x-title': 'STC Conversas' },
      body: JSON.stringify(buildChatBody(messages, config)),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 45000),
    });
    const raw = await r.text();
    if (!r.ok) throw new LlmError(r.status, raw);
    type Resposta = { choices?: { message?: { content?: unknown } }[]; model?: unknown; usage?: unknown };
    let parsed: Resposta;
    try { parsed = JSON.parse(raw) as Resposta; } catch { throw new LlmError(r.status, 'resposta não é JSON'); }
    const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
    return {
      // Conteúdo vazio chega ao parse como string vazia — é o que dispara o soft-fail.
      output: String(choice?.message?.content ?? ''),
      model: String(parsed.model ?? config.model),
      usage: parsed.usage && typeof parsed.usage === 'object' ? parsed.usage as Record<string, unknown> : null,
    };
  };
}
