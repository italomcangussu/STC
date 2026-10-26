// @ts-nocheck — função Deno (imports `npm:`); a lógica testável está em _shared/dispatch.ts.
//
// Chamada por um agendador a cada poucos minutos (pg_cron + pg_net, Supabase Cron ou externo) com o cabeçalho
// `x-dispatch-secret`. Ver docs/conversas/OPERACAO_E_MIGRATIONS.md.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { handleDispatchRequest, runDispatch } from '../_shared/dispatch.ts';
import { uazCaller } from '../_shared/uazChat.ts';

const url = Deno.env.get('SUPABASE_URL');
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
if (!url || !secret) throw new Error('Missing STC server configuration');
const service = createClient(url, secret, { auth: { persistSession: false } });
const serverUrl = Deno.env.get('UAZAPI_SERVER_URL');
const instanceToken = Deno.env.get('STC_UAZAPI_INSTANCE_TOKEN');
const uaz = serverUrl && instanceToken ? uazCaller({ serverUrl, instanceToken }) : null;

// Arquivo de retorno agendado (bucket conv-media): link assinado curto, só para a UazAPI buscar o arquivo.
const signedUrl = async (path) => {
  const r = await service.storage.from('conv-media').createSignedUrl(path, 600);
  return r.error ? null : r.data.signedUrl;
};

Deno.serve((request) => handleDispatchRequest(request, {
  secret: Deno.env.get('STC_DISPATCH_SECRET'),
  run: () => runDispatch((name, args) => service.rpc(name, args), uaz, signedUrl),
}));
