// @ts-nocheck — função Deno (imports `npm:`); a lógica testável está em handler.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { serveAdminEndpoint } from '../_shared/serveAdmin.ts';
import { uazCaller } from '../_shared/uazChat.ts';
import { whatsappInstance } from '../_shared/whatsappInstance.ts';
import { conversationRpc, handleConversationRequest } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '';
const storage = createClient(url, secret, { auth: { persistSession: false } }).storage.from('conv-media');

const serverUrl = Deno.env.get('UAZAPI_SERVER_URL');
const instanceToken = Deno.env.get('STC_UAZAPI_INSTANCE_TOKEN');
const config = serverUrl && instanceToken ? { serverUrl, instanceToken } : null;

const env = {
  uaz: config ? uazCaller(config) : null,
  instance: whatsappInstance(config),
  aiConfigured: Boolean(Deno.env.get('STC_AI_API_KEY')),
  // 10 minutos: o bastante para a UazAPI baixar; depois o link morre.
  signedMediaUrl: async (path: string) => {
    const r = await storage.createSignedUrl(path, 600);
    return r.error ? null : r.data.signedUrl;
  },
  webhookUrl: (token: string) => `${url}/functions/v1/whatsapp-webhook?token=${encodeURIComponent(token)}`,
  newToken: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(36));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
};

// Sessão e papel de administrador são conferidos por `handleAdminRequest`; o `rpc` do banco ganha o roteador das ações de conversa.
serveAdminEndpoint((request, deps, envAdmin) =>
  handleConversationRequest(request, { ...deps, rpc: conversationRpc(deps.rpc, env) }, envAdmin));
