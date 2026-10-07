// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asUser, ID, inbound, q, rpc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;

const live = (w: W) => q<any>(w.db, `select * from public.conv_contacts where merged_into is null order by created_at`);
const openConvs = (w: W) => q<any>(w.db, `select * from public.conv_conversations where status = 'open' and kind = 'direct' and merged_into is null`);

/** Contato + conversa aberta + mensagens, direto no banco (como se já existissem antes desta migration). */
async function seedContact(w: W, n: number, phone: string, profile: string | null, bodies: string[]) {
  const contact = ID(1000 + n);
  const conv = ID(2000 + n);
  await w.db.exec(`
    insert into public.conv_contacts(id, phone, name, profile_id, link_status, created_at)
    values ('${contact}', '${phone}', null, ${profile ? `'${profile}'` : 'null'}, '${profile ? 'linked' : 'none'}', now() - interval '${100 - n} minutes');
    insert into public.conv_conversations(id, kind, contact_id, last_message_at, created_at)
    values ('${conv}', 'direct', '${contact}', now() - interval '${50 - n} minutes', now() - interval '${100 - n} minutes');
  `);
  for (const [i, body] of bodies.entries()) {
    await w.db.exec(`
      insert into public.conv_messages(conversation_id, direction, origin, sender_contact_id, kind, body, status, provider_message_id, created_at)
      values ('${conv}', 'inbound', 'customer', '${contact}', 'text', '${body}', 'received', 'SEED${n}-${i}', now() - interval '${60 - n * 10 - i} minutes')`);
  }
  return { contact, conv };
}

describe('contato único: reconhecer a pessoa antes de criar', () => {
  it('conversa aberta pela equipe e depois resposta do sócio com/sem nono dígito: um contato, uma conversa', async () => {
    const w = await world();
    const id = await rpc<string>(w.db, U.admin, `public.conv_open_conversation('(11) 91234-5678', 'Fulano')`);
    const a = await inbound(w.db, { phone: '551112345678', name: 'Fulano no zap', body: 'Oi' });
    expect(a.conversation_id).toBe(id);
    expect((await live(w)).length).toBe(1);
    expect((await openConvs(w)).length).toBe(1);
    // o número que o provedor entrega vale
    expect((await live(w))[0].phone).toBe('551112345678');
    // e volta a ser reconhecido pela outra grafia
    const b = await inbound(w.db, { phone: '5511912345678', body: 'De novo' });
    expect(b.conversation_id).toBe(id);
    expect((await live(w)).length).toBe(1);
  }, 60000);

  it('sócio que escreve de um número e depois de outra grafia do mesmo telefone do cadastro não duplica', async () => {
    const w = await world();
    // socioA: 99900000002 no cadastro
    const a = await inbound(w.db, { phone: '5599900000002', name: 'Ana', body: 'Oi' });
    const b = await inbound(w.db, { phone: '559900000002', name: 'Ana', body: 'Oi 2' });
    expect(b.conversation_id).toBe(a.conversation_id);
    expect((await live(w)).length).toBe(1);
    expect((await live(w))[0].profile_id).toBe(U.socioA);
  }, 60000);

  it('números diferentes (chaves diferentes) continuam contatos diferentes', async () => {
    const w = await world();
    const a = await inbound(w.db, { phone: '5511912345678', body: 'Oi' });
    const b = await inbound(w.db, { phone: '5511987654321', body: 'Oi' });
    expect(a.conversation_id).not.toBe(b.conversation_id);
    expect((await live(w)).length).toBe(2);
  }, 60000);

  it('cadastros diferentes nunca são unidos, mesmo com telefone parecido', async () => {
    const w = await world();
    const a = await seedContact(w, 1, '5599900000002', U.socioA, ['a']);
    const b = await seedContact(w, 2, '5599900000003', U.socioB, ['b']);
    await w.db.exec(`select conv_private.dedupe_contact('${b.contact}')`);
    expect((await live(w)).length).toBe(2);
    expect((await openConvs(w)).length).toBe(2);
    expect(a.conv).not.toBe(b.conv);
  }, 60000);
});

describe('contato único: fusão de duplicados existentes', () => {
  it('dois contatos do mesmo sócio viram um; mensagens, notas, retornos e sessões vão para a conversa mantida; nada é apagado', async () => {
    const w = await world();
    const a = await seedContact(w, 1, '5599900000002', U.socioA, ['primeira']);
    const b = await seedContact(w, 2, '559900000002', U.socioA, ['segunda', 'terceira']);
    await w.db.exec(`
      insert into public.conv_notes(conversation_id, body) values ('${b.conv}', 'nota da duplicada');
      insert into public.conv_followups(conversation_id, due_at, note) values ('${b.conv}', now() + interval '1 day', 'ligar');
      insert into public.conv_ai_sessions(id, conversation_id, requester_contact_id, expires_at)
        values ('${ID(3001)}', '${b.conv}', '${b.contact}', now() + interval '10 minutes');
    `);

    const kept = (await q<any>(w.db, `select conv_private.dedupe_contact('${b.contact}') as id`))[0].id;
    expect(kept).toBe(a.contact); // o mais antigo fica

    expect((await live(w)).length).toBe(1);
    const open = await openConvs(w);
    expect(open.length).toBe(1);
    expect(open[0].id).toBe(a.conv);

    const msgs = await q<any>(w.db, `select body, conversation_id, sender_contact_id from public.conv_messages order by created_at`);
    expect(msgs.map((m: any) => m.body).sort()).toEqual(['primeira', 'segunda', 'terceira']);
    expect(msgs.every((m: any) => m.conversation_id === a.conv && m.sender_contact_id === a.contact)).toBe(true);
    expect((await q<any>(w.db, `select conversation_id from public.conv_notes`))[0].conversation_id).toBe(a.conv);
    expect((await q<any>(w.db, `select conversation_id from public.conv_followups`))[0].conversation_id).toBe(a.conv);
    const [s] = await q<any>(w.db, `select * from public.conv_ai_sessions`);
    expect([s.conversation_id, s.requester_contact_id, s.status]).toEqual([a.conv, a.contact, 'expired']);

    // a conversa absorvida fica encerrada e marcada; o contato absorvido aponta para o mantido; nada some
    const [dropped] = await q<any>(w.db, `select * from public.conv_conversations where id = '${b.conv}'`);
    expect([dropped.status, dropped.merged_into]).toEqual(['closed', a.conv]);
    const [dc] = await q<any>(w.db, `select * from public.conv_contacts where id = '${b.contact}'`);
    expect([dc.merged_into, dc.phone]).toEqual([a.contact, null]);
    expect((await q(w.db, `select 1 from public.conv_contacts`)).length).toBe(2);
    expect((await q(w.db, `select 1 from public.admin_audit_logs where action = 'conv.contact_merge'`)).length).toBe(1);

    // a caixa mostra uma só conversa, com o nome do cadastro
    const inbox = await asUser<any>(w.db, U.admin, `select * from public.conv_inbox('all', null, 50)`);
    expect(inbox.length).toBe(1);
    expect(inbox[0].title).toBe((await q<any>(w.db, `select name from public.profiles where id = '${U.socioA}'`))[0].name);

    // idempotente
    await w.db.exec(`select conv_private.dedupe_contact('${a.contact}')`);
    expect((await q(w.db, `select 1 from public.admin_audit_logs where action = 'conv.contact_merge'`)).length).toBe(1);
  }, 60000);

  it('ligação manual do administrador a um sócio que já tem contato consolida', async () => {
    const w = await world();
    const a = await seedContact(w, 1, '5599900000002', U.socioA, ['antiga']);
    const b = await seedContact(w, 2, '559900000002', null, ['nova']);
    await rpc(w.db, U.admin, `public.conv_link_contact('${b.contact}', '${U.socioA}', null)`);
    expect((await live(w)).length).toBe(1);
    expect((await openConvs(w))[0].id).toBe(a.conv);
    expect((await q<any>(w.db, `select count(*)::int as n from public.conv_messages where conversation_id = '${a.conv}'`))[0].n).toBe(2);
  }, 60000);

  it('o outro número do mesmo sócio (chave diferente) não é fundido: o histórico de cada número é preservado', async () => {
    const w = await world();
    await seedContact(w, 1, '5599900000002', U.socioA, ['a']);
    const b = await seedContact(w, 2, '5511912345678', U.socioA, ['b']);
    await w.db.exec(`select conv_private.dedupe_contact('${b.contact}')`);
    expect((await live(w)).length).toBe(2);
  }, 60000);
});
