// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dispatchAutomations, dispatchFollowups, fillTemplate, handleDispatchRequest, runDispatch, type Db } from '../../supabase/functions/_shared/dispatch';
import type { UazCaller } from '../../supabase/functions/_shared/uazChat';

type Call = { name: string; args: Record<string, unknown> };
function fake(handlers: Record<string, (args: any) => unknown>) {
  const calls: Call[] = [];
  const db: Db = async (name, args) => { calls.push({ name, args }); const h = handlers[name]; return h ? { data: h(args), error: null } : { data: null, error: null }; };
  return { db, calls, names: () => calls.map((c) => c.name) };
}
const okUaz = (sent: string[] = []): UazCaller => async ({ body }) => { sent.push(String(body.text)); return { ok: true, body: { messageid: 'P1' } }; };

describe('automações: cada destinatário sai uma vez e o resultado é o do provedor', () => {
  const claim = [{ recipient_id: 'R1', conversation_id: 'C1', body: 'Olá, Ana!' }, { recipient_id: 'R2', conversation_id: 'C2', body: 'Olá, Beto!' }];

  it('enfileira, envia e informa ao banco; falha de um não marca o outro', async () => {
    const sent: string[] = [];
    const f = fake({
      conv_svc_automation_claim: () => claim,
      conv_svc_automation_queue: (a) => [{ message_id: `M-${a.p_recipient}`, destination: '5585988880002', already_sent: false }],
    });
    let n = 0;
    const uaz: UazCaller = async ({ body }) => (++n === 2 ? { ok: false, error: 'HTTP_503' } : (sent.push(String(body.text)), { ok: true, body: { messageid: 'P1' } }));
    const r = await dispatchAutomations(f.db, uaz);
    expect(r).toEqual({ claimed: 2, sent: 1, failed: 1 });
    const fin = f.calls.filter((c) => c.name === 'conv_svc_automation_finish').map((c) => c.args);
    expect(fin[0]).toMatchObject({ p_recipient: 'R1', p_ok: true, p_error: null });
    expect(fin[1]).toMatchObject({ p_recipient: 'R2', p_ok: false, p_error: 'HTTP_503' });
    expect(sent).toEqual(['Olá, Ana!']);
  });

  it('mensagem que já tinha saído (varredura repetida) não é reenviada', async () => {
    const sent: string[] = [];
    const f = fake({ conv_svc_automation_claim: () => [claim[0]], conv_svc_automation_queue: () => [{ message_id: 'M1', destination: '5585988880002', already_sent: true }] });
    expect(await dispatchAutomations(f.db, okUaz(sent))).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(sent).toEqual([]);
  });

  it('sem provedor configurado nada é enviado nem marcado como enviado', async () => {
    const f = fake({ conv_svc_automation_claim: () => claim });
    expect(await dispatchAutomations(f.db, null)).toEqual({ claimed: 2, sent: 0, failed: 2 });
    expect(f.calls.filter((c) => c.name === 'conv_svc_automation_finish').every((c) => c.args.p_ok === false && c.args.p_error === 'WHATSAPP_NOT_CONFIGURED')).toBe(true);
    expect(f.names()).not.toContain('conv_svc_automation_queue');
  });
});

describe('retornos agendados', () => {
  it('a chave da mensagem é o id do retorno (repetir não duplica) e {nome} vira o primeiro nome', async () => {
    const sent: string[] = [];
    const f = fake({
      conv_svc_claim_due_followups: () => [{ followup_id: 'F1', conversation_id: 'C1', send_body: 'Oi {nome}, tudo bem?' }],
      conv_svc_conversation_contact: () => [{ name: 'Maria Souza' }],
      conv_svc_queue_message: () => [{ message_id: 'M1', destination: '5585988880002', already_sent: false }],
    });
    expect(await dispatchFollowups(f.db, okUaz(sent))).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(sent).toEqual(['Oi Maria, tudo bem?']);
    expect(f.calls.find((c) => c.name === 'conv_svc_queue_message')!.args).toMatchObject({ p_key: 'F1', p_origin: 'system' });
    expect(fillTemplate('Oi {nome}!', '+5585988880002')).toBe('Oi !');
  });
});

describe('varredura completa e autorização do agendador', () => {
  it('uma etapa que falha não impede as outras', async () => {
    const f = fake({ conv_svc_automation_tick: () => { throw new Error('x'); }, conv_svc_ai_expire_sessions: () => 2 });
    const r = await runDispatch(f.db, okUaz());
    expect(r.expiredSessions).toBe(2);
    expect(r.tick).toBeNull();
  });

  it('só o agendador com o segredo dispara', async () => {
    const run = async () => ({ tick: null, expiredSessions: 0, automations: { claimed: 0, sent: 0, failed: 0 }, followups: { claimed: 0, sent: 0, failed: 0 } });
    const segredo = 'S'.repeat(32);
    const req = (secret?: string, method = 'POST') => new Request('https://x/', { method, headers: secret ? { 'x-dispatch-secret': secret } : {} });
    expect((await handleDispatchRequest(req(segredo), { secret: segredo, run })).status).toBe(200);
    expect((await handleDispatchRequest(req('errado'), { secret: segredo, run })).status).toBe(401);
    expect((await handleDispatchRequest(req(), { secret: segredo, run })).status).toBe(401);
    expect((await handleDispatchRequest(req(segredo), { secret: undefined, run })).status).toBe(401);   // sem segredo configurado ninguém dispara
    expect((await handleDispatchRequest(req('curto'), { secret: 'curto', run })).status).toBe(401);       // segredo fraco não vale
    expect((await handleDispatchRequest(req(segredo, 'GET'), { secret: segredo, run })).status).toBe(405);
  });
});
