// @ts-nocheck — função Deno (imports `npm:`); a lógica testável está em _shared/adminBriefing.ts.
//
// Chamada pelo agendador (pg_cron + pg_net) às 08h00 de Fortaleza (11:00 UTC) com o cabeçalho `x-dispatch-secret`
// (o mesmo de `conversations-dispatch`). Corpo opcional: {"dry_run": true} devolve os textos sem enviar nada.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { authorizedBySecret } from '../_shared/dispatch.ts';
import { runAdminBriefing } from '../_shared/adminBriefing.ts';
import { uazCaller } from '../_shared/uazChat.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
if (!url || !key) throw new Error('Missing STC server configuration');
const service = createClient(url, key, { auth: { persistSession: false } });
const serverUrl = Deno.env.get('UAZAPI_SERVER_URL');
const instanceToken = Deno.env.get('STC_UAZAPI_INSTANCE_TOKEN');
const uaz = serverUrl && instanceToken ? uazCaller({ serverUrl, instanceToken }) : null;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!(await authorizedBySecret(request, Deno.env.get('STC_DISPATCH_SECRET')))) return json(401, { error: 'UNAUTHORIZED' });
  const body = await request.json().catch(() => ({}));
  const summary = await runAdminBriefing((name, args) => service.rpc(name, args), uaz, { dryRun: body?.dry_run === true });
  return json(200, summary);
});
