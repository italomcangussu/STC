// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asUser, asUserError, inbound, j, key, q, rpc, rpcError, svc, U, world } from './harness';

describe('quem acessa Conversas (RLS e funções)', () => {
  it('administrador lê conversas e mensagens; sócio, professor, lanchonete e anônimo não veem nada', async () => {
    const { db } = await world();
    await inbound(db, { phone: '5585999990001', name: 'Maria Contato', body: 'Oi, tudo bem?' });
    const sel = (t: string) => `select count(*)::int n from public.${t}`;
    for (const table of ['conv_conversations', 'conv_messages', 'conv_contacts', 'conv_groups', 'conv_followups', 'conv_notes',
      'conv_ai_sessions', 'conv_booking_proposals', 'conv_automations', 'conv_automation_recipients', 'conv_channel']) {
      expect(await asUserError(db, U.admin, sel(table)), `admin lê ${table}`).toBeNull();
    }
    expect((await asUser<{ n: number }>(db, U.admin, sel('conv_messages')))[0].n).toBe(1);
    for (const who of [U.socioA, U.prof, U.lanch, null]) {
      // sócio, professor e lanchonete não têm linha visível; anônimo nem concessão tem
      const err = await asUserError(db, who, sel('conv_messages'));
      if (who === null) expect(err).toMatch(/permission denied/i);
      else expect((await asUser<{ n: number }>(db, who, sel('conv_messages')))[0].n).toBe(0);
      expect((await asUser<{ n: number }>(db, who, sel('conv_conversations')).catch(() => [{ n: 0 }]))[0].n).toBe(0);
    }
  }, 60000);

  it('ninguém escreve direto nas tabelas, nem o administrador: só as funções escrevem', async () => {
    const { db } = await world();
    for (const who of [U.admin, U.socioA]) {
      expect(await asUserError(db, who, `insert into public.conv_contacts(phone) values ('5585999990009')`)).toMatch(/permission denied/i);
      expect(await asUserError(db, who, `update public.conv_channel set ai_direct_enabled = true`)).toMatch(/permission denied/i);
      expect(await asUserError(db, who, `delete from public.conv_messages`)).toMatch(/permission denied/i);
    }
  }, 60000);

  it('funções administrativas recusam quem não é administrador; as de serviço não são alcançáveis pelo navegador', async () => {
    const { db } = await world();
    for (const who of [U.socioA, U.prof, U.lanch]) {
      expect(await rpcError(db, who, `public.conv_inbox('open', null, 10)`)).toMatch(/CONV_FORBIDDEN/);
      expect(await rpcError(db, who, `public.conv_save_channel('${key()}', ${j({ institutional_name: 'X Y' })})`)).toMatch(/CONV_FORBIDDEN/);
      expect(await rpcError(db, who, `public.conv_automation_list()`)).toMatch(/CONV_FORBIDDEN/);
      expect(await rpcError(db, who, `public.conv_save_automation('${key()}', null, ${j({ name: 'Teste de acesso', source: 'audience', trigger_type: 'manual' })})`)).toMatch(/CONV_FORBIDDEN/);
      expect(await rpcError(db, who, `public.conv_get_ai_settings()`)).toMatch(/CONV_FORBIDDEN/);
      // funções do webhook/IA/dispatch são só do service_role
      expect(await rpcError(db, who, `public.conv_svc_ingest_message(${j({ provider_id: 'x', chat_kind: 'direct', phone: '5585999990001' })})`)).toMatch(/permission denied/i);
      expect(await rpcError(db, who, `public.conv_svc_automation_claim(5)`)).toMatch(/permission denied/i);
    }
    expect(await rpcError(db, null, `public.conv_inbox('open', null, 10)`)).toMatch(/permission denied|CONV_FORBIDDEN/i);
    expect(await rpcError(db, U.admin, `public.conv_inbox('open', null, 10)`)).toBeNull();
  }, 60000);

  it('o hash do token do webhook nunca é lido pelo navegador, nem pelo administrador', async () => {
    const { db } = await world();
    expect(await asUserError(db, U.admin, `select inbound_token_hash from public.conv_channel`)).toMatch(/permission denied/i);
    expect(await asUserError(db, U.admin, `select institutional_name, ai_group_enabled from public.conv_channel`)).toBeNull();
    const token = 'A'.repeat(48);
    await rpc(db, U.admin, `public.conv_rotate_inbound_token('${key()}', '${token}')`);
    const [row] = await q<{ inbound_token_hash: string }>(db, `select inbound_token_hash from public.conv_channel`);
    expect(row.inbound_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.inbound_token_hash).not.toContain(token);
    // o token em claro não fica nem no registro de idempotência nem na auditoria
    const dump = JSON.stringify(await q(db, `select * from public.conv_requests`)) + JSON.stringify(await q(db, `select * from public.admin_audit_logs where source = 'conversations'`));
    expect(dump).not.toContain(token);
    const delivery = await svc<any[]>(db, `(select jsonb_agg(to_jsonb(d)) from public.conv_svc_channel_delivery() d)`);
    expect(delivery[0].inbound_token_hash).toBe(row.inbound_token_hash);
    expect(await rpcError(db, U.admin, `public.conv_rotate_inbound_token('${key()}', 'curto')`)).toMatch(/INVALID_TOKEN/);
  }, 60000);

  it('histórico não se apaga: nem o dono apaga mensagem, conversa ou contato', async () => {
    const { db } = await world();
    await inbound(db, { phone: '5585999990001', name: 'Maria', body: 'Oi' });
    for (const t of ['conv_messages', 'conv_conversations', 'conv_contacts']) {
      await expect(db.exec(`delete from public.${t}`)).rejects.toThrow(/CONV_NO_DELETE/);
    }
  }, 60000);

  it('ações do administrador deixam rastro na auditoria, sem token', async () => {
    const { db } = await world();
    await rpc(db, U.admin, `public.conv_save_channel('${key()}', ${j({ institutional_name: 'STC Institucional', bot_phone: '5585988880099' })})`);
    const logs = await q<{ action: string; actor_user_id: string; source: string }>(db,
      `select action, actor_user_id, source from public.admin_audit_logs where source = 'conversations'`);
    expect(logs.some((l) => l.action === 'conv.channel_save' && l.actor_user_id === U.admin)).toBe(true);
  }, 60000);
});
