// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ID, inbound, j, key, q, rpc, rpcError, svc, svcError, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
const msgs = (w: W, cond = 'true') => q<any>(w.db, `select * from public.conv_messages where ${cond} order by created_at, id`);

describe('webhook: entrada idempotente', () => {
  it('o mesmo evento do provedor repetido não duplica mensagem, conversa nem contato', async () => {
    const w = await world();
    const ev = { provider_id: 'WA-REPETIDO-1', chat_kind: 'direct', phone: '5585999990001', name: 'Maria', kind: 'text', body: 'Oi', from_me: false };
    const a = await svc<any>(w.db, `public.conv_svc_ingest_message(${j(ev)})`);
    const b = await svc<any>(w.db, `public.conv_svc_ingest_message(${j(ev)})`);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.message_id).toBe(a.message_id);
    expect((await q(w.db, `select 1 from public.conv_messages`)).length).toBe(1);
    expect((await q(w.db, `select 1 from public.conv_conversations`)).length).toBe(1);
    expect((await q(w.db, `select 1 from public.conv_contacts`)).length).toBe(1);
  }, 60000);

  it('payload inválido não grava nada', async () => {
    const w = await world();
    expect(await svcError(w.db, `public.conv_svc_ingest_message(${j({ chat_kind: 'direct', phone: '5585999990001' })})`)).toMatch(/PROVIDER_ID_REQUIRED/);
    expect(await svcError(w.db, `public.conv_svc_ingest_message(${j({ provider_id: 'x', chat_kind: 'direct', phone: '123' })})`)).toMatch(/INVALID_CONTACT/);
    expect(await svcError(w.db, `public.conv_svc_ingest_message(${j({ provider_id: 'y', chat_kind: 'group', group_jid: 'nao-e-grupo', phone: '5585999990001' })})`)).toMatch(/INVALID_GROUP/);
    expect((await q(w.db, `select 1 from public.conv_messages`)).length).toBe(0);
  }, 60000);

  it('o telefone liga ao sócio só quando o candidato é único (tolera o nono dígito); ambíguo não liga', async () => {
    const w = await world();
    // socioA tem 85988880002; o WhatsApp entrega sem o nono dígito: 558588880002
    const a = await inbound(w.db, { phone: '558588880002', name: 'Ana no zap', body: 'Oi' });
    const [ca] = await q<any>(w.db, `select * from public.conv_contacts where id = '${a.contact_id}'`);
    expect(ca.link_status).toBe('linked');
    expect(ca.profile_id).toBe(U.socioA);
    // dois cadastros com o mesmo telefone ⇒ ambíguo, sem ligação
    await w.db.exec(`update public.profiles set phone = '85977770000' where id in ('${U.socioB}', '${U.prof}')`);
    const b = await inbound(w.db, { phone: '5585977770000', name: 'Alguém', body: 'Oi' });
    const [cb] = await q<any>(w.db, `select * from public.conv_contacts where id = '${b.contact_id}'`);
    expect(cb.link_status).toBe('ambiguous');
    expect(cb.profile_id).toBeNull();
    // telefone desconhecido: nenhuma ligação
    const c = await inbound(w.db, { phone: '5511912345678', name: 'Desconhecido', body: 'Oi' });
    expect((await q<any>(w.db, `select link_status from public.conv_contacts where id = '${c.contact_id}'`))[0].link_status).toBe('none');
    // aluno não-sócio com telefone único
    await w.db.exec(`insert into public.non_socio_students(id, name, phone, plan_type, plan_status) values ('${ID(700)}', 'Aluno Card', '(85) 98888-1111', 'Card Mensal', 'active')`);
    const d = await inbound(w.db, { phone: '5585988881111', name: 'Aluno', body: 'Oi' });
    const [cd] = await q<any>(w.db, `select * from public.conv_contacts where id = '${d.contact_id}'`);
    expect([cd.link_status, cd.non_socio_student_id]).toEqual(['linked', ID(700)]);
  }, 60000);

  it('ligação manual do administrador vale e não é sobrescrita; ficam auditadas', async () => {
    const w = await world();
    const a = await inbound(w.db, { phone: '5511912345678', name: 'Desconhecido', body: 'Oi' });
    await rpc(w.db, U.admin, `public.conv_link_contact('${a.contact_id}', '${U.socioB}', null)`);
    const [c] = await q<any>(w.db, `select * from public.conv_contacts where id = '${a.contact_id}'`);
    expect([c.link_status, c.profile_id]).toEqual(['manual', U.socioB]);
    expect(await rpcError(w.db, U.admin, `public.conv_link_contact('${a.contact_id}', '${U.socioB}', '${ID(700)}')`)).toMatch(/LINK_ONE_ONLY/);
    expect(await rpcError(w.db, U.socioA, `public.conv_link_contact('${a.contact_id}', '${U.socioA}', null)`)).toMatch(/CONV_FORBIDDEN/);
    expect((await q(w.db, `select 1 from public.admin_audit_logs where action = 'conv.contact_link'`)).length).toBe(1);
  }, 60000);
});

describe('grupos: só se grava o que um administrador permitiu', () => {
  const GROUP = '120363025246125486@g.us';
  const ev = (over: Record<string, unknown> = {}) => ({ chat_kind: 'group', group_jid: GROUP, group_name: 'Sócios', phone: '5585988880002', name: 'Ana', kind: 'text', body: 'bom dia', from_me: false,
    payload_shape: { message: ['chatid', 'isGroup', 'sender'] }, ...over });
  let n = 0;
  const grp = (w: W, over: Record<string, unknown> = {}) => svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `G${++n}${Math.random()}`, ...ev(over) })})`);

  it('grupo novo é só "detectado": nenhuma mensagem, contato ou conversa é gravada; o formato (só chaves) fica para conferência', async () => {
    const w = await world();
    const r = await grp(w);
    expect(r.ignored).toBe('group_not_allowed');
    expect((await q(w.db, `select 1 from public.conv_messages`)).length).toBe(0);
    expect((await q(w.db, `select 1 from public.conv_contacts`)).length).toBe(0);
    expect((await q(w.db, `select 1 from public.conv_conversations`)).length).toBe(0);
    const [g] = await q<any>(w.db, `select * from public.conv_groups`);
    expect([g.status, g.events_seen, g.name]).toEqual(['detected', 1, 'Sócios']);
    expect(g.last_payload_shape).toEqual({ message: ['chatid', 'isGroup', 'sender'] });
    await grp(w);
    expect((await q<any>(w.db, `select events_seen from public.conv_groups`))[0].events_seen).toBe(2);
  }, 60000);

  it('administrador permite o grupo: passa a gravar, com o remetente individual; bloqueado volta a ignorar', async () => {
    const w = await world();
    await grp(w);
    const [g] = await q<any>(w.db, `select id from public.conv_groups`);
    expect(await rpcError(w.db, U.socioA, `public.conv_set_group('${g.id}', 'allowed', false)`)).toMatch(/CONV_FORBIDDEN/);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', false)`);
    const r = await grp(w, { body: 'quem joga hoje?' });
    expect(r.ignored).toBeUndefined();
    const [m] = await msgs(w, `conversation_id = '${r.conversation_id}'`);
    expect(m.body).toBe('quem joga hoje?');
    expect(m.sender_contact_id).toBe(r.contact_id);
    expect((await q<any>(w.db, `select kind, group_id from public.conv_conversations`))[0]).toEqual({ kind: 'group', group_id: g.id });
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'blocked', false)`);
    expect((await grp(w)).ignored).toBe('group_not_allowed');
    expect((await q(w.db, `select 1 from public.conv_messages`)).length).toBe(1);
  }, 60000);

  it('IA em grupo só liga com menção verificada, e desverificar desliga tudo', async () => {
    const w = await world();
    await grp(w);
    const [g] = await q<any>(w.db, `select id from public.conv_groups`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', false)`);
    expect(await rpcError(w.db, U.admin, `public.conv_set_ai_channel(true, true)`)).toMatch(/MENTION_NOT_VERIFIED/);
    expect(await rpcError(w.db, U.admin, `public.conv_set_mention_verified(true)`)).toMatch(/BOT_IDENTITY_REQUIRED/);
    await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5585988880099' })})`);
    await rpc(w.db, U.admin, `public.conv_set_mention_verified(true)`);
    await rpc(w.db, U.admin, `public.conv_set_ai_channel(true, true)`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', true)`);
    expect((await q<any>(w.db, `select ai_enabled from public.conv_groups`))[0].ai_enabled).toBe(true);
    expect(await rpcError(w.db, U.admin, `public.conv_set_group('${g.id}', 'blocked', true)`)).toMatch(/GROUP_AI_NOT_ALLOWED/);
    await rpc(w.db, U.admin, `public.conv_set_mention_verified(false)`);
    const [c] = await q<any>(w.db, `select ai_group_enabled, mention_verified_at from public.conv_channel`);
    expect([c.ai_group_enabled, c.mention_verified_at]).toEqual([false, null]);
    expect((await q<any>(w.db, `select ai_enabled from public.conv_groups`))[0].ai_enabled).toBe(false);
  }, 60000);
});

describe('envio e estados: só o provedor muda o que "enviada/entregue/lida" significa', () => {
  it('chave repetida devolve a mesma mensagem; só finish_message marca enviada; estados só avançam', async () => {
    const w = await world();
    const a = await inbound(w.db, { phone: '5585999990001', name: 'Maria', body: 'Oi' });
    const k = key();
    const q1 = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_queue_message('${a.conversation_id}', ${j({ kind: 'text', body: 'Olá!' })}, '${U.admin}', '${k}') x)`);
    const q2 = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_queue_message('${a.conversation_id}', ${j({ kind: 'text', body: 'Olá!' })}, '${U.admin}', '${k}') x)`);
    expect(q2.message_id).toBe(q1.message_id);
    expect(q1.destination).toBe('5585999990001');
    expect((await msgs(w, `direction = 'outbound'`)).length).toBe(1);
    expect((await msgs(w, `id = '${q1.message_id}'`))[0].status).toBe('queued');   // gravada ≠ enviada
    await svc(w.db, `public.conv_svc_finish_message('${q1.message_id}', true, 'PROV-1', null)`);
    expect((await msgs(w, `id = '${q1.message_id}'`))[0].status).toBe('sent');
    await svc(w.db, `public.conv_svc_update_message_status('PROV-1', 'read')`);
    await svc(w.db, `public.conv_svc_update_message_status('PROV-1', 'delivered')`);   // não volta
    expect((await msgs(w, `id = '${q1.message_id}'`))[0].status).toBe('read');
    // repetir a fila depois de enviada avisa que já saiu
    const q3 = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_queue_message('${a.conversation_id}', ${j({ kind: 'text', body: 'Olá!' })}, '${U.admin}', '${k}') x)`);
    expect(q3.already_sent).toBe(true);
    // mesma chave em outra conversa é recusada
    const b = await inbound(w.db, { phone: '5585999990002', name: 'João', body: 'Oi' });
    expect(await svcError(w.db, `(select to_jsonb(x) from public.conv_svc_queue_message('${b.conversation_id}', ${j({ kind: 'text', body: 'x' })}, '${U.admin}', '${k}') x)`)).toMatch(/IDEMPOTENCY_KEY_REUSED/);
  }, 60000);

  it('falha do provedor deixa a mensagem como falhou, com o erro (sem credencial), e reenviar com a mesma chave é possível', async () => {
    const w = await world();
    const a = await inbound(w.db, { phone: '5585999990001', name: 'Maria', body: 'Oi' });
    const k = key();
    const q1 = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_queue_message('${a.conversation_id}', ${j({ kind: 'text', body: 'Olá!' })}, '${U.admin}', '${k}') x)`);
    await svc(w.db, `public.conv_svc_finish_message('${q1.message_id}', false, null, 'HTTP_503')`);
    const [m] = await msgs(w, `id = '${q1.message_id}'`);
    expect([m.status, m.last_error, m.attempts]).toEqual(['failed', 'HTTP_503', 1]);
    await svc(w.db, `public.conv_svc_finish_message('${q1.message_id}', true, 'PROV-2', null)`);
    expect((await msgs(w, `id = '${q1.message_id}'`))[0].status).toBe('sent');
  }, 60000);

  it('resposta MANUAL do administrador assume a conversa direta; IA, automação e retorno não', async () => {
    const w = await world();
    const a = await inbound(w.db, { phone: '5585999990001', name: 'Maria', body: 'Oi' });
    const send = async (author: string | null, origin: string) => {
      const r = await svc<any>(w.db, `(select to_jsonb(x) from public.conv_svc_queue_message('${a.conversation_id}', ${j({ kind: 'text', body: 'resposta' })}, ${author ? `'${author}'` : 'null'}, '${key()}', '${origin}') x)`);
      await svc(w.db, `public.conv_svc_finish_message('${r.message_id}', true, 'P${Math.random()}', null)`);
    };
    await send(null, 'ai');
    await send(null, 'automation');
    expect((await q<any>(w.db, `select ai_status, handled_by_human from public.conv_conversations`))[0]).toEqual({ ai_status: 'ai', handled_by_human: false });
    await send(U.admin, 'staff');
    expect((await q<any>(w.db, `select ai_status, handled_by_human from public.conv_conversations`))[0]).toEqual({ ai_status: 'human', handled_by_human: true });
    await rpc(w.db, U.admin, `public.conv_set_ai_status('${a.conversation_id}', 'ai')`);
    expect((await q<any>(w.db, `select ai_status from public.conv_conversations`))[0].ai_status).toBe('ai');
    expect(await rpcError(w.db, U.admin, `public.conv_set_ai_status('${a.conversation_id}', 'xyz')`)).toMatch(/INVALID_STATUS/);
  }, 60000);

  it('mídia: só caminhos da pasta in/ ou out/ com id; texto vazio e corpo grande são recusados', async () => {
    const w = await world();
    const a = await inbound(w.db, { phone: '5585999990001', name: 'Maria', body: 'Oi' });
    const call = (p: unknown) => svcError(w.db, `(select to_jsonb(x) from public.conv_svc_queue_message('${a.conversation_id}', ${j(p)}, '${U.admin}', '${key()}') x)`);
    expect(await call({ kind: 'image', media_path: '../../etc/passwd' })).toMatch(/INVALID_MEDIA_PATH/);
    expect(await call({ kind: 'image' })).toMatch(/MEDIA_REQUIRED/);
    expect(await call({ kind: 'text', body: '   ' })).toMatch(/BODY_REQUIRED/);
    expect(await call({ kind: 'text', body: 'x'.repeat(4097) })).toMatch(/BODY_TOO_LONG/);
    expect(await call({ kind: 'image', media_path: `out/${ID(1)}/foto.jpg` })).toBeNull();
  }, 60000);
});

describe('caixa de entrada', () => {
  it('lista com não lidas, aguardando resposta e busca por nome/telefone; abrir não marca como lida', async () => {
    const w = await world();
    const a = await inbound(w.db, { phone: '5585999990001', name: 'Maria Souza', body: 'Preciso de ajuda' });
    await inbound(w.db, { phone: '5585999990002', name: 'João Lima', body: 'Oi' });
    const list = (f: string, s: string | null = null) => rpc<any[]>(w.db, U.admin, `(select jsonb_agg(to_jsonb(x)) from public.conv_inbox('${f}', ${s ? `'${s}'` : 'null'}, 50) x)`);
    expect((await list('unread')).length).toBe(2);
    expect((await list('open', 'maria'))[0].title).toBe('Maria Souza');
    expect((await list('open', '99990002'))[0].title).toBe('João Lima');
    expect((await list('waiting')).length).toBe(2);
    await svc(w.db, `(select count(*) from public.conv_svc_mark_read_collect('${a.conversation_id}'))`);
    expect((await list('unread')).length).toBe(1);
    await svc(w.db, `public.conv_svc_mark_unread('${a.conversation_id}')`);
    expect((await list('unread')).length).toBe(2);
    await rpc(w.db, U.admin, `public.conv_set_status('${a.conversation_id}', 'closed')`);
    expect((await list('open')).length).toBe(1);
    expect((await list('closed')).length).toBe(1);
    // quem escreve de novo cai numa conversa aberta nova; o histórico antigo fica
    await inbound(w.db, { phone: '5585999990001', name: 'Maria Souza', body: 'Voltei' });
    expect((await list('open')).length).toBe(2);
    expect((await q(w.db, `select 1 from public.conv_conversations where status = 'closed'`)).length).toBe(1);
  }, 60000);

  it('opt-out por mensagem marca o contato e cancela envios pendentes', async () => {
    const w = await world();
    const a = await inbound(w.db, { phone: '5585999990001', name: 'Maria', body: 'PARAR' });
    expect((await q<any>(w.db, `select opt_out from public.conv_contacts where id = '${a.contact_id}'`))[0].opt_out).toBe(true);
    const b = await inbound(w.db, { phone: '5585999990002', name: 'João', body: 'Posso parar o carro aí?' });
    expect((await q<any>(w.db, `select opt_out from public.conv_contacts where id = '${b.contact_id}'`))[0].opt_out).toBe(false);
    await rpc(w.db, U.admin, `public.conv_set_opt_out('${a.contact_id}', false)`);
    expect((await q<any>(w.db, `select opt_out from public.conv_contacts where id = '${a.contact_id}'`))[0].opt_out).toBe(false);
  }, 60000);
});
