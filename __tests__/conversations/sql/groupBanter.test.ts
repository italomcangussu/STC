// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;
const pause = () => new Promise((r) => setTimeout(r, 15));

async function adminSession(w: W) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
  const phone = '99900000001';
  const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `B${++n}${Math.random()}`, chat_kind: 'direct', phone, name: 'Admin', kind: 'text', body: 'oi joão' })})`);
  const t = await svc<any>(w.db, `public.conv_svc_ai_trigger('${m.message_id}')`);
  return { session: t.session_id as string, phone };
}
const say = async (w: W, phone: string, body: string) => {
  await pause();
  return svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `S${++n}${Math.random()}`, chat_kind: 'direct', phone, kind: 'text', body })})`);
};
async function membersGroup(w: W) {
  const jid = '120363000000000009@g.us';
  await svc(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `G${++n}`, chat_kind: 'group', group_jid: jid, group_name: 'Sócios', phone: '5599900000002', name: 'Ana', kind: 'text', body: 'oi' })})`);
  const [g] = await q<{ id: string }>(w.db, `select id from public.conv_groups`);
  await q(w.db, `update public.conv_groups set status = 'allowed', ai_enabled = true where id = '${g.id}'`);
  await svc(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `G${++n}`, chat_kind: 'group', group_jid: jid, phone: '5599900000002', name: 'Ana', kind: 'text', body: 'bom dia' })})`);
  const [c] = await q<{ id: string }>(w.db, `select id from public.conv_conversations where kind = 'group'`);
  return c.id;
}
const propose = (w: W, session: string, p: Record<string, unknown>) => svc<any>(w.db, `public.conv_svc_ai_admin_group_post_propose('${session}', ${j(p)})`);
const followups = (w: W) => q<any>(w.db, `select conversation_id, send_body, created_by from public.conv_followups order by created_at`);

describe('resenha no grupo pedida pela diretoria', () => {
  it('mostra o texto com a menção do alvo e só posta no grupo depois do "sim" do administrador', async () => {
    const w = await world();
    const grupo = await membersGroup(w);
    await q(w.db, `update public.profiles set phone = '(99) 90000-0003' where id = '${U.socioB}'`);
    const s = await adminSession(w);

    const prop = await propose(w, s.session, { body: 'cadê você? Sumiu das reservas!', profile_id: U.socioB });
    expect(prop).toMatchObject({ ok: true, action: 'adm_group_post' });
    expect(prop.summary.body).toMatch(/^@\d{12,13} cadê você\?/);
    expect(await followups(w)).toHaveLength(0);

    const yes = await say(w, s.phone, 'sim');
    const res = await svc<any>(w.db, `public.conv_svc_ai_confirm('${prop.proposal_id}', '${yes.message_id}')`);
    expect(res).toMatchObject({ ok: true, action: 'adm_group_post' });
    const rows = await followups(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conversation_id: grupo, send_body: prop.summary.body, created_by: U.admin });
    expect((await svc<any>(w.db, `public.conv_svc_ai_confirm('${prop.proposal_id}', '${yes.message_id}')`)).replayed).toBe(true);
    expect(await followups(w)).toHaveLength(1);
  }, 60000);

  it('sem grupo liberado ou sem texto, não monta proposta', async () => {
    const w = await world();
    const s = await adminSession(w);
    expect(await propose(w, s.session, { body: 'bora animar' })).toMatchObject({ ok: false, code: 'NO_GROUP' });
    await membersGroup(w);
    expect(await propose(w, s.session, { body: ' ' })).toMatchObject({ ok: false, code: 'INVALID_BODY' });
  }, 60000);
});

describe('curiosidade do João para o presidente', () => {
  it('no grupo, pergunta ao presidente no privado; freia repetição do mesmo sócio e não vale fora do grupo', async () => {
    const w = await world();
    await membersGroup(w);
    await q(w.db, `update public.profiles set phone = '(99) 90000-0001' where id = '${U.admin}'`);
    const [adm] = await q<{ name: string }>(w.db, `select name from public.profiles where id = '${U.admin}'`);
    await q(w.db, `insert into public.conv_ai_memory_candidates (subject_name, kind, content, confidence, status) values ('${adm.name}', 'role_title', 'Presidente do clube', 1, 'approved')`);
    await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
    const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `C${++n}`, chat_kind: 'group', group_jid: '120363000000000009@g.us', phone: '5599900000002', name: 'Ana', kind: 'text', body: 'joão, e o Carlos?', mention_direct: true })})`);
    const [grupo] = await q<{ id: string }>(w.db, `select id from public.conv_conversations where kind = 'group'`);
    const [sess] = await q<{ id: string }>(w.db, `insert into public.conv_ai_sessions (conversation_id, status, requester_contact_id, expires_at) select '${grupo.id}', 'open', sender_contact_id, now() + interval '1 hour' from public.conv_messages where id = '${m.message_id}' returning id`);
    const sessionId = sess.id;
    const ask = (subject: string) => svc<any>(w.db, `public.conv_svc_ai_curator_ask('${sessionId}', ${j({ subject_name: subject, question: 'Me conta uma do ' + subject + ' pra resenha?' })})`);

    expect(await ask('Carlos')).toMatchObject({ ok: true, curator: adm.name });
    const rows = await q<any>(w.db, `select f.send_body, c.kind from public.conv_followups f join public.conv_conversations c on c.id = f.conversation_id`);
    expect(rows).toEqual([{ send_body: 'Me conta uma do Carlos pra resenha?', kind: 'direct' }]);
    expect(await ask('carlos')).toMatchObject({ ok: false, code: 'RATE_LIMITED' });

    const s = await adminSession(w);
    expect(await svc<any>(w.db, `public.conv_svc_ai_curator_ask('${s.session}', ${j({ subject_name: 'Beto', question: 'Me conta uma do Beto?' })})`)).toMatchObject({ ok: false, code: 'GROUP_ONLY' });
  }, 60000);
});
