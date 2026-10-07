// Fronteira HTTP das escritas do administrador que falam com o provedor de WhatsApp.
//
// Portado de `_shared/staffRequest.ts` do North Jato, simplificado: o STC não tem permissões finas,
// só o papel `profiles.role = 'admin'` (o mesmo `is_admin()` do banco). O papel NUNCA vem do corpo da
// requisição — o corpo é a parte que o atacante controla: o token é validado, e o papel lido do banco.
//
// Isto vive em um arquivo só de propósito. É a checagem de autorização de todo o painel; em duas
// cópias, a segunda envelhece calada.

export type RpcResult = { data: unknown; error: { message: string } | null };

export interface AdminActor { id: string; role: string; active: boolean }

/** Quem está chamando: o token (para ações que o banco confere como o próprio administrador) e o id. */
export interface CallContext { token: string; actorId: string }

export interface AdminDeps {
  /** Valida o JWT do chamador. Devolve `null` para qualquer token que não sirva. */
  verifyToken(token: string): Promise<{ userId: string } | null>;
  /** Lê o papel no banco. `null` quando o usuário não existe. */
  loadActor(userId: string): Promise<AdminActor | null>;
  /** Chamada ao banco com a chave de serviço. `ctx` permite reexecutar como o administrador. */
  rpc(name: string, args: Record<string, unknown>, ctx?: CallContext): Promise<RpcResult>;
}

export interface AdminEnvironment { origin: string }

export type Plan = { rpc: string; args: Record<string, unknown>; status: number; key: string };

export interface AdminRoute {
  /** Ações conhecidas. Ação fora da lista é ação desconhecida. */
  actions: string[];
  /** Traduz o corpo em chamada, ou `null` se o corpo não descreve uma. */
  plan(action: string, body: Record<string, unknown>, actor: AdminActor): Plan | null;
  /** Erro do banco/serviço → status HTTP. O que não está aqui não é traduzido. */
  dbErrors: Record<string, number>;
  /** Código devolvido para erro desconhecido (mensagem crua do Postgres expõe estrutura interna). */
  rejection: string;
}

export const MAX_BODY = 64 * 1024;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function response(status: number, body: unknown, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': origin, 'vary': 'Origin' },
  });
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normaliza e resolve se uma origem é permitida para o painel de Conversas.
 * Permite:
 * 1. Origens declaradas em `STC_PUBLIC_ORIGIN` (separadas por vírgula).
 * 2. Qualquer subdomínio ou domínio próprio do STC (*.stcplay.com.br, stcplay.com.br).
 * 3. Ambientes de desenvolvimento locais e IPs de rede local (localhost, 127.0.0.1, 192.168.*.*, etc.)
 *    para permitir testes simultâneos no celular e desktop na mesma rede Wi-Fi.
 */
export function resolveAllowedOrigin(requestedOrReferer: string | null, envOrigin: string): string | null {
  if (!requestedOrReferer) return null;
  const raw = requestedOrReferer.trim();
  let candidate: string;
  try {
    const url = new URL(raw);
    candidate = url.origin.toLowerCase();
  } catch {
    candidate = raw.replace(/\/+$/, "").toLowerCase();
  }

  const allowedList = envOrigin
    .split(",")
    .map((o) => {
      const trimmed = o.trim();
      try {
        return new URL(trimmed).origin.toLowerCase();
      } catch {
        return trimmed.replace(/\/+$/, "").toLowerCase();
      }
    })
    .filter(Boolean);

  if (allowedList.includes(candidate)) {
    return candidate;
  }

  // Domínios oficiais do STC (com ou sem www/subdomínio, https ou http)
  if (/^https?:\/\/(?:[a-z0-9-]+\.)*stcplay\.com\.br(?::\d+)?$/i.test(candidate)) {
    return candidate;
  }

  // Hosts locais e IPs de rede para depuração em dispositivos móveis
  if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[0-1])\.\d+\.\d+)(?::\d+)?$/i.test(candidate)) {
    return candidate;
  }

  return null;
}

export async function handleAdminRequest(request: Request, deps: AdminDeps, env: AdminEnvironment, route: AdminRoute): Promise<Response> {
  const requested = request.headers.get("origin") || request.headers.get("referer");
  const origin = resolveAllowedOrigin(requested, env.origin);
  const fallbackOrigin = env.origin.split(",")[0]?.trim() || "https://stcplay.com.br";

  if (request.method === "OPTIONS") {
    if (!origin) {
      return response(403, { error: "ORIGIN_FORBIDDEN" }, fallbackOrigin);
    }
    return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
      "vary": "Origin",
    } });
  }
  if (!origin) return response(403, { error: "ORIGIN_FORBIDDEN" }, fallbackOrigin);
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

  // Só administrador ativo. Sócio, aluno, professor e lanchonete nunca passam daqui.
  const actor = await deps.loadActor(session.userId);
  if (!actor || !actor.active || actor.role !== 'admin') return response(403, { error: 'FORBIDDEN' }, origin);

  const action = text(body.action);
  if (!route.actions.includes(action)) return response(400, { error: 'UNKNOWN_ACTION' }, origin);
  const plan = route.plan(action, body, actor);
  if (!plan) return response(400, { error: 'INVALID_PAYLOAD' }, origin);

  const result = await deps.rpc(plan.rpc, plan.args, { token, actorId: actor.id });
  if (result.error) {
    // O código mais longo entre os que casam, não o primeiro: `INVALID_X` é prefixo de `INVALID_X_Y`.
    const code = Object.keys(route.dbErrors)
      .filter((name) => result.error!.message.includes(name))
      .sort((a, b) => b.length - a.length)[0];
    if (code) return response(route.dbErrors[code], { error: code }, origin);
    return response(400, { error: route.rejection }, origin);
  }
  return response(plan.status, { [plan.key]: result.data }, origin);
}
