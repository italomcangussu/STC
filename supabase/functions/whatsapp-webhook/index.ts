// @ts-nocheck — função Deno (imports `npm:`); a lógica testável está em handler.ts/record.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.89.0';
import { handleWhatsappWebhook, type ChannelDelivery } from './handler.ts';
import { uazCaller } from '../_shared/uazChat.ts';
import { recordInbound, type RecordDeps } from './record.ts';
import { buildAdminPush } from './pushNotify.ts';
import { chatClient } from '../_shared/aiAgent/llm.ts';
import { runTurn } from '../_shared/aiAgent/turn.ts';

const url = Deno.env.get('SUPABASE_URL');
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
if (!url || !secret) throw new Error('Missing STC server configuration');
const service = createClient(url, secret, { auth: { persistSession: false } });

const serverUrl = Deno.env.get('UAZAPI_SERVER_URL');
const instanceToken = Deno.env.get('STC_UAZAPI_INSTANCE_TOKEN');
const MEDIA_BUCKET = 'conv-media';
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

// IA: provedor compatível com OpenAI (OpenRouter por padrão). Sem chave, a IA transfere para a equipe.
const aiKey = Deno.env.get('STC_AI_API_KEY');
const aiChat = aiKey ? chatClient({ apiKey: aiKey, baseUrl: Deno.env.get('STC_AI_BASE_URL') }) : null;
const uaz = serverUrl && instanceToken ? uazCaller({ serverUrl, instanceToken }) : null;
const waitUntil = (task) => { if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task); };

// Push notifications para administradores (mensagens diretas de entrada, exceto grupos)
async function notifyAdminsPush(messageId: string) {
  try {
    const { data: msg, error } = await service
      .from('conv_messages')
      .select('id, body, kind, direction, conversation_id, conv_conversations!inner(kind, conv_contacts(name, phone))')
      .eq('id', messageId)
      .maybeSingle();
    if (error) { console.error('push-notify-query', error.message); return; }

    const push = buildAdminPush(msg);
    if (!push) return;

    const res = await fetch(`${url}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(push),
    });
    if (!res.ok) console.error('push-notify-send', res.status, (await res.text()).slice(0, 200));
  } catch (err) {
    console.error('push-notify-error', err);
  }
}

const recordDeps: RecordDeps = {
  rpc: (name, args) => service.rpc(name, args),
  uaz,
  // O turno espera o buffer e a chamada ao modelo: roda em segundo plano, a UazAPI já recebeu o 200.
  onInbound: (messageId) => {
    waitUntil(Promise.all([
      runTurn(messageId, {
        db: (name, args) => service.rpc(name, args),
        chat: aiChat,
        uaz,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      }).catch((e) => console.error('ai-turn', e instanceof Error ? e.message : 'erro')),
      notifyAdminsPush(messageId),
    ]));
  },
  store: async (path, fileUrl, mime) => {
    try {
      const r = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) return false;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_MEDIA_BYTES) return false;
      const up = await service.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
      return !up.error;
    } catch {
      return false;
    }
  },
  // O canal de difusão é acessível a quem tem a chave anônima: vai só o id opaco da conversa e o estado
  // ("digitando"), nunca o número nem conteúdo.
  broadcast: async (event, payload) => {
    const phone = String(payload.phone ?? '');
    const contact = await service.from('conv_contacts').select('id').eq('phone', phone).maybeSingle();
    if (!contact.data) return;
    const conv = await service.from('conv_conversations').select('id').eq('contact_id', contact.data.id).eq('status', 'open').maybeSingle();
    if (!conv.data) return;
    await service.channel('conv-inbox-presence').send({ type: 'broadcast', event,
      payload: { conversationId: conv.data.id, state: payload.state, at: payload.at } });
  },
  background: waitUntil,
};

Deno.serve((request) => handleWhatsappWebhook(request, {
  loadChannel: async () => {
    const r = await service.rpc('conv_svc_channel_delivery');
    return !r.error && Array.isArray(r.data) && r.data[0] ? r.data[0] as ChannelDelivery : null;
  },
  background: waitUntil,
  record: (payload, channel) => recordInbound(payload, channel, recordDeps),
}));
