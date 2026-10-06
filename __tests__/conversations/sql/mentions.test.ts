// @vitest-environment node
// Quem foi marcado numa mensagem: do número ("@61809058967781") para o sócio do cadastro, pelo telefone.
import { describe, expect, it } from 'vitest';
import { ID, j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;
const resolve = (w: W, items: { id: string; phone?: string | null }[]) =>
  svc<any[]>(w.db, `public.conv_svc_ai_resolve_mentions(${j(items.map((i) => ({ id: i.id, phone: i.phone ?? null })))})`);

describe('conciliar marcações com o cadastro', () => {
  it('pelo telefone: com DDI, sem DDI e com ou sem o nono dígito dão o mesmo sócio', async () => {
    const w = await world();
    // Beto: 85988880003 (cadastro, com o 9)
    for (const id of ['5585988880003', '85988880003', '558588880003', '8588880003']) {
      const [r] = await resolve(w, [{ id }]);
      expect([r.name, r.via, r.is_bot]).toEqual(['Beto Sócio', 'phone', false]);
      expect(r.profile_id).toBe(U.socioB);
    }
  }, 60000);

  it('LID + o telefone que a UazAPI informou para ele no grupo', async () => {
    const w = await world();
    const [r] = await resolve(w, [{ id: '61809058967781@lid', phone: '5585988880004' }]);
    expect(r).toMatchObject({ id: '61809058967781', name: 'Paulo Professor', via: 'phone', profile_id: U.prof });
  }, 60000);

  it('LID de quem já escreveu no grupo: o contato do WhatsApp liga o LID ao sócio, sem precisar de telefone extra', async () => {
    const w = await world();
    const jid = '120363000000000001@g.us';
    await svc(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `ML${++n}`, chat_kind: 'group', group_jid: jid, group_name: 'Sócios', phone: '5585988880002', name: 'Ana', kind: 'text', body: 'oi' })})`);
    const [g] = await q<{ id: string }>(w.db, `select id from public.conv_groups`);
    await rpc(w.db, U.admin, `public.conv_set_group('${g.id}', 'allowed', false)`);            // grupo permitido: o remetente passa a ser gravado
    await svc(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `ML${++n}`, chat_kind: 'group', group_jid: jid, phone: '5585988880003', lid: '90000000000001@lid', name: 'Beto', kind: 'text', body: 'oi' })})`);
    const [r] = await resolve(w, [{ id: '90000000000001' }]);
    expect(r).toMatchObject({ name: 'Beto Sócio', via: 'lid', profile_id: U.socioB });
  }, 60000);

  it('sem como conciliar, volta sem nome (o agente pergunta); ambíguo, inativo e não-sócio também não viram nome', async () => {
    const w = await world();
    expect((await resolve(w, [{ id: '61809058967781' }]))[0]).toMatchObject({ name: null, profile_id: null, is_bot: false });
    // dois cadastros com o mesmo telefone: ambíguo
    await w.db.exec(`update public.profiles set phone = '85988880003' where id = '${U.prof}'`);
    expect((await resolve(w, [{ id: '5585988880003' }]))[0].name).toBeNull();
    // inativo e lanchonete (não é sócio)
    await w.db.exec(`update public.profiles set phone = '85988880004' where id = '${U.prof}'; update public.profiles set is_active = false where id = '${U.prof}'`);
    expect((await resolve(w, [{ id: '5585988880004' }]))[0].name).toBeNull();
    await w.db.exec(`update public.profiles set phone = '85988889999' where id = '${U.lanch}'`);
    expect((await resolve(w, [{ id: '5585988889999' }]))[0].name).toBeNull();
  }, 60000);

  it('reconhece a própria conta institucional (telefone ou LID cadastrados) e vários itens de uma vez', async () => {
    const w = await world();
    await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5585988880099', bot_lids: ['144539339767982@lid'] })})`);
    const r = await resolve(w, [{ id: '144539339767982' }, { id: '5585988880099' }, { id: '5585988880002' }, { id: '61809058967781' }]);
    expect(r.map((x) => [x.is_bot, x.name])).toEqual([[true, null], [true, null], [false, 'Ana Sócia'], [false, null]]);
  }, 60000);

  it('é só da IA (service_role): nem o público nem o painel chamam', async () => {
    const w = await world();
    const [r] = await q<any>(w.db, `select has_function_privilege('authenticated', 'public.conv_svc_ai_resolve_mentions(jsonb)', 'execute') a,
      has_function_privilege('anon', 'public.conv_svc_ai_resolve_mentions(jsonb)', 'execute') b,
      has_function_privilege('authenticated', 'conv_private.ai_resolve_mentions(jsonb)', 'execute') c`);
    expect([r.a, r.b, r.c]).toEqual([false, false, false]);
  }, 60000);
});
