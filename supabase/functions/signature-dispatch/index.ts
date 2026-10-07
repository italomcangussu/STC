// @ts-nocheck — função Deno (imports `npm:`); a lógica testável está em _shared/signatureDispatch.ts.
//
// Chamada por um agendador a cada poucos minutos (pg_cron + pg_net, Supabase Cron ou externo) com o cabeçalho
// `x-dispatch-secret` (o mesmo segredo de `conversations-dispatch`). Coloca na fila os lembretes que venceram
// (3 dias antes e no dia do prazo) e despacha os avisos pendentes. Ver docs/assinaturas/OPERACAO_E_MIGRATIONS.md.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { handleSignatureCron, dispatchSignatureNotifications } from '../_shared/signatureDispatch.ts';
import { DEFAULT_APP_URL } from '../_shared/signatureMessages.ts';
import { uazCaller } from '../_shared/uazChat.ts';

const url = Deno.env.get('SUPABASE_URL');
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
if (!url || !secret) throw new Error('Missing STC server configuration');
const service = createClient(url, secret, { auth: { persistSession: false } });
const serverUrl = Deno.env.get('UAZAPI_SERVER_URL');
const instanceToken = Deno.env.get('STC_UAZAPI_INSTANCE_TOKEN');
const uaz = serverUrl && instanceToken ? uazCaller({ serverUrl, instanceToken }) : null;
const appUrl = Deno.env.get('STC_APP_URL') || DEFAULT_APP_URL;

Deno.serve((request) => handleSignatureCron(request, {
  secret: Deno.env.get('STC_DISPATCH_SECRET'),
  run: () => dispatchSignatureNotifications((name, args) => service.rpc(name, args), uaz, {
    appUrl, limit: 20, maxMs: 110_000, reminders: true,
  }),
}));
