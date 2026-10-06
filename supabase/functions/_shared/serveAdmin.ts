// @ts-nocheck — função Deno (imports `npm:`).
// Ligação com o Supabase, comum aos endpoints do administrador.
//
// Dois clientes de propósito: o anônimo só valida o token de quem chamou, e o de serviço executa. Nunca
// usamos a chave de serviço para interpretar o token do visitante — fazê-lo transformaria qualquer token
// em uma sessão válida. Para as ações que o BANCO confere como o próprio administrador (`auth.uid()`), a
// chamada é refeita com o token dele (cliente "como usuário").
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import type { AdminActor, AdminDeps, AdminEnvironment } from './adminRequest.ts';

export type AdminHandler = (request: Request, deps: AdminDeps, env: AdminEnvironment) => Promise<Response>;

export function serveAdminEndpoint(handle: AdminHandler): void {
  const url = Deno.env.get('SUPABASE_URL');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const origin = Deno.env.get('STC_PUBLIC_ORIGIN');
  if (!url || !secret || !anon || !origin) throw new Error('Missing STC server configuration');

  const service = createClient(url, secret, { auth: { persistSession: false } });
  const verifier = createClient(url, anon, { auth: { persistSession: false } });

  async function verifyToken(token: string) {
    const { data, error } = await verifier.auth.getUser(token);
    return error || !data.user ? null : { userId: data.user.id };
  }

  async function loadActor(userId: string): Promise<AdminActor | null> {
    const r = await service.from('profiles').select('id, role, is_active').eq('id', userId).maybeSingle();
    if (r.error || !r.data) return null;
    return { id: r.data.id, role: String(r.data.role), active: r.data.is_active !== false };
  }

  Deno.serve((request) => handle(
    request,
    {
      verifyToken, loadActor,
      rpc: (name, args, ctx) => {
        if (ctx && name.startsWith('as_user:')) {
          const client = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${ctx.token}` } } });
          return client.rpc(name.slice('as_user:'.length), args);
        }
        return service.rpc(name, args);
      },
    },
    { origin },
  ));
}
