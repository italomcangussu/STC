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

export async function handleAdminRequest(request: Request, deps: AdminDeps, env: AdminEnvironment, route: AdminRoute): Promise<Response> {
  // `STC_PUBLIC_ORIGIN` pode listar várias origens separadas por vírgula (produção, rede local, localhost).
  // A resposta devolve só a origem que bateu: o navegador recusa `Access-Control-Allow-Origin` com lista.
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
