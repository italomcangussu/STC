// @vitest-environment node
// A IA faz com os atletas de uma reserva o que a Agenda faz: sair, retirar, adicionar, convidado — e vê a agenda no contexto.
import { describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ID, j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;

const dateAt = async (db: PGlite, plusDays: number) => (await q<{ d: string }>(db, `select (conv_private.today() + ${plusDays})::text d`))[0].d;
async function enable(w: W) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
}
async function session(w: W, phone: string, name = 'Sócio') {
  const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `P${++n}${Math.random()}`, chat_kind: 'direct', phone, name, kind: 'text', body: 'oi' })})`);
  const t = await svc<any>(w.db, `public.conv_svc_ai_trigger('${m.message_id}')`);
  return { conversation: m.conversation_id as string, session: t.session_id as string };
}
const say = (w: W, phone: string, body: string) =>
  svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `PC${++n}${Math.random()}`, chat_kind: 'direct', phone, kind: 'text', body })})`);
const propose = (w: W, s: { session: string }, p: Record<string, unknown>) => svc<any>(w.db, `public.conv_svc_ai_propose('${s.session}', ${j(p)})`);
const confirm = (w: W, proposal: string, message: string) => svc<any>(w.db, `public.conv_svc_ai_confirm('${proposal}', '${message}')`);
const pause = () => new Promise((r) => setTimeout(r, 15));
const row = async (w: W, id: string) => (await q<any>(w.db, `select participant_ids, status, guest_name, guest_responsible_id from public.reservations where id = '${id}'`))[0];

const ANA = '85988880002';
const BETO = '85988880003';
const ADMIN = '85988880001';

/** Play criado pelo Beto, `plus` dias à frente, 18:00–19:00 na Quadra 1. */
async function game(w: W, date: string, participants: string[], over: { guest?: string; type?: string; start?: string; end?: string; creator?: string } = {}) {
  const id = ID(7600 + ++n);
  await w.db.exec(`insert into public.reservations(id, court_id, creator_id, date, start_time, end_time, type, participant_ids, guest_name, guest_responsible_id)
    values ('${id}', '${w.court1}', '${over.creator ?? U.socioB}', '${date}', '${over.start ?? '18:00'}', '${over.end ?? '19:00'}', '${over.type ?? 'Play'}',
      '{${participants.join(',')}}', ${over.guest ? `'${over.guest}'` : 'null'}, ${over.guest ? `'${over.creator ?? U.socioB}'` : 'null'})`);
  return id;
}
const change = (id: string, over: Record<string, unknown>) => ({ action: 'participants', reservation_id: id, add_ids: [], remove_ids: [], add_guest: null, remove_guest: false, ...over });
async function apply(w: W, who: string, phone: string, p: Record<string, unknown>, frase = 'sim') {
  const s = await session(w, phone, who);
  const pr = await propose(w, s, p);
  if (!pr.ok) return { pr, c: null };
  await pause();
  const yes = await say(w, phone, frase);
  return { pr, c: await confirm(w, pr.proposal_id, yes.message_id) };
}

describe('a agenda que o agente enxerga', () => {
  it('traz os próximos dias com quem está em cada Play (nomes), as vagas e o que a pessoa pode fazer; aula não expõe alunos', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 1);
    const minha = await game(w, date, [U.socioB, U.socioA]);
    const dosOutros = await game(w, date, [U.socioB, U.prof], { start: '19:00', end: '20:00' });
    await game(w, date, [U.socioB], { start: '20:00', end: '20:30', type: 'Aula' });
    const s = await session(w, ANA, 'Ana');
    const ctx = await svc<any>(w.db, `public.conv_svc_ai_context('${s.session}')`);
    const ag = ctx.agenda as any[];
    expect(ag.map((x) => x.ref)).toEqual(['a1', 'a2', 'a3']);
    expect(ag[0]).toMatchObject({ id: minha, type: 'Play', start: '18:00', court: 'Quadra 1', mine: true, spots_left: 6,
      can: { leave: true, people: true, edit: false, cancel: false } });                       // Ana não é a criadora
    expect(ag[0].people.map((p: any) => p.name)).toEqual(['Beto Sócio', 'Ana Sócia']);
    expect(ag[1]).toMatchObject({ id: dosOutros, mine: false, can: { leave: false, people: true, edit: false, cancel: false } });
    expect(ag[2]).toMatchObject({ type: 'Aula', people: [], spots_left: null });               // aula: sem nomes
    const adm = await session(w, ADMIN, 'Admin');
    const ctxAdm = await svc<any>(w.db, `public.conv_svc_ai_context('${adm.session}')`);
    expect(ctxAdm.agenda[0].can).toMatchObject({ edit: true, cancel: true });                  // administrador edita e cancela qualquer uma
  }, 60000);

  it('só entra o que ainda não terminou; reserva de outro dia distante de quem não está nela fica de fora', async () => {
    const w = await world();
    await enable(w);
    await game(w, '2020-01-01', [U.socioB]);
    await game(w, await dateAt(w.db, 20), [U.socioB]);
    const longe = await game(w, await dateAt(w.db, 20), [U.socioB, U.socioA], { start: '10:00', end: '11:00' });
    const s = await session(w, ANA, 'Ana');
    const ag = (await svc<any>(w.db, `public.conv_svc_ai_context('${s.session}')`)).agenda as any[];
    expect(ag.map((x) => x.id)).toEqual([longe]);                                                  // a minha, mesmo longe; as outras não
  }, 60000);
});

describe('sair, retirar e adicionar atletas (mesmas regras da Agenda)', () => {
  it('SAIR: a pessoa sai e o resto fica; o "sim" por sentido ("beleza, pode tirar") vale', async () => {
    const w = await world();
    await enable(w);
    const id = await game(w, await dateAt(w.db, 2), [U.socioB, U.socioA, U.prof]);
    const { pr, c } = await apply(w, 'Ana', ANA, change(id, { remove_ids: [U.socioA] }), 'beleza, pode tirar');
    expect(pr.summary).toMatchObject({ remove_names: ['Ana Sócia'], self_leaving: true, cancel_all: false, after_names: ['Beto Sócio', 'Paulo Professor'] });
    expect(c).toMatchObject({ ok: true, action: 'participants' });
    expect((await row(w, id)).participant_ids.sort()).toEqual([U.socioB, U.prof].sort());
    const [a] = await q<any>(w.db, `select * from public.admin_audit_logs where action = 'conv.ai_reservation_participants_changed'`);
    expect(a.metadata).toMatchObject({ actor: 'ai', source: 'whatsapp', requester_profile_id: U.socioA });
  }, 60000);

  it('o pedido do exemplo: tirar "eu e o Emerson" da reserva numa mensagem só', async () => {
    const w = await world();
    await enable(w);
    const emerson = ID(8801);
    await w.db.exec(`insert into auth.users(id) values ('${emerson}'); insert into public.profiles(id, name, role, is_professor, is_active) values ('${emerson}', 'Emerson Souza', 'socio', false, true)`);
    const id = await game(w, await dateAt(w.db, 2), [U.socioB, U.socioA, emerson]);
    const { pr, c } = await apply(w, 'Ana', ANA, change(id, { remove_ids: [U.socioA, emerson] }), 'isso, pode tirar nós dois');
    expect(pr.summary.remove_names).toEqual(['Ana Sócia', 'Emerson Souza']);
    expect(c.ok).toBe(true);
    expect((await row(w, id)).participant_ids).toEqual([U.socioB]);
  }, 60000);

  it('o último atleta saindo (sem convidado) cancela a reserva inteira — e a proposta avisa isso', async () => {
    const w = await world();
    await enable(w);
    const id = await game(w, await dateAt(w.db, 2), [U.socioB]);
    const { pr, c } = await apply(w, 'Beto', BETO, change(id, { remove_ids: [U.socioB] }));
    expect(pr.summary).toMatchObject({ cancel_all: true, after_names: [] });
    expect(c.ok).toBe(true);
    expect((await row(w, id)).status).toBe('cancelled');
    expect((await q<any>(w.db, `select count(*)::int c from public.admin_audit_logs where action = 'conv.ai_reservation_canceled'`))[0].c).toBe(1);
    // com convidado, a reserva continua
    const id2 = await game(w, await dateAt(w.db, 3), [U.socioB], { guest: 'Zeca' });
    const r2 = await apply(w, 'Beto', BETO, change(id2, { remove_ids: [U.socioB] }));
    expect(r2.pr.summary).toMatchObject({ cancel_all: false, after_names: ['Zeca (convidado)'] });
  }, 60000);

  it('ADICIONAR outras pessoas e RETIRAR no mesmo pedido; o convidado entra e sai', async () => {
    const w = await world();
    await enable(w);
    const id = await game(w, await dateAt(w.db, 2), [U.socioB, U.socioA]);
    const { pr, c } = await apply(w, 'Ana', ANA, change(id, { add_ids: [U.prof, U.profOther], remove_ids: [U.socioA], add_guest: 'Zeca' }));
    expect(pr.summary).toMatchObject({ add_names: ['Paulo Professor', 'Olga Professora'], remove_names: ['Ana Sócia'], guest_after: 'Zeca' });
    expect(c.ok).toBe(true);
    const r = await row(w, id);
    expect(r.participant_ids.sort()).toEqual([U.socioB, U.prof, U.profOther].sort());
    expect([r.guest_name, r.guest_responsible_id]).toEqual(['Zeca', U.socioA]);
    const r2 = await apply(w, 'Beto', BETO, change(id, { remove_guest: true }));
    expect(r2.c.ok).toBe(true);
    expect((await row(w, id)).guest_name).toBeNull();
  }, 60000);

  it('regras: só Play; sócio ativo; quem não está não sai; criador só sai por ele ou admin; nada a fazer; cabe em 8', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 2);
    const id = await game(w, date, [U.socioB, U.socioA]);
    const ana = await session(w, ANA, 'Ana');
    expect((await propose(w, ana, change(id, { remove_ids: [U.prof] }))).code).toBe('NOT_IN_RESERVATION');
    expect((await propose(w, ana, change(id, { add_ids: [U.lanch] }))).code).toBe('PARTICIPANT_NOT_MEMBER');
    expect((await propose(w, ana, change(id, {}))).code).toBe('NOTHING_TO_DO');
    expect((await propose(w, ana, change(id, { remove_ids: [U.socioB] }))).code).toBe('CREATOR_PROTECTED');   // Ana não é a criadora
    const adm = await session(w, ADMIN, 'Admin');
    expect((await propose(w, adm, change(id, { remove_ids: [U.socioB] }))).ok).toBe(true);                    // administrador pode
    const aula = await game(w, date, [U.socioB], { type: 'Aula', start: '10:00', end: '10:30' });
    expect((await propose(w, ana, change(aula, { remove_ids: [U.socioB] }))).code).toBe('NOT_PLAY');
    expect((await propose(w, ana, change(ID(9999), { remove_ids: [U.socioA] }))).code).toBe('RESERVATION_NOT_FOUND');
    const cheio = await game(w, date, [U.socioB, U.socioA, U.prof, U.profOther], { guest: 'Zeca', start: '12:00', end: '13:00' });
    const extras = Array.from({ length: 5 }, (_, i) => ID(8900 + i));
    await w.db.exec(`insert into auth.users(id) values ${extras.map((x) => `('${x}')`).join(',')};
      insert into public.profiles(id, name, role, is_professor, is_active) values ${extras.map((x, k) => `('${x}', 'Extra ${k + 1}', 'socio', false, true)`).join(',')}`);
    const r = await propose(w, ana, change(cheio, { add_ids: extras }));                                      // 5 + 5 > 8
    expect(r).toMatchObject({ ok: false, code: 'NOT_ENOUGH_SPOTS' });
    expect((await propose(w, ana, change(cheio, { add_ids: extras.slice(0, 3) }))).ok).toBe(true);           // 5 + 3 = 8
    await w.db.exec(`update public.profiles set is_active = false where id = '${U.socioA}'`);
    expect((await propose(w, ana, change(id, { remove_ids: [U.socioA] }))).code).toBe('REQUESTER_NOT_MEMBER');
  }, 90000);

  it('jogo que já começou: só dá para SAIR; terminado, nada', async () => {
    const w = await world();
    await enable(w);
    const [t] = await q<{ d: string; ini: string; fim: string }>(w.db, `select conv_private.today()::text d,
      to_char(((now() at time zone 'America/Fortaleza') - interval '10 minutes')::time, 'HH24:MI') ini,
      to_char(((now() at time zone 'America/Fortaleza') + interval '40 minutes')::time, 'HH24:MI') fim`);
    if (t.ini > t.fim) return;                                              // virada de meia-noite: o cenário não existe agora
    const id = await game(w, t.d, [U.socioB, U.socioA, U.prof], { start: t.ini, end: t.fim });
    const ana = await session(w, ANA, 'Ana');
    expect((await propose(w, ana, change(id, { add_ids: [U.profOther] }))).code).toBe('RESERVATION_STARTED');
    expect((await propose(w, ana, change(id, { remove_ids: [U.prof] }))).code).toBe('RESERVATION_STARTED');
    expect((await propose(w, ana, change(id, { remove_ids: [U.socioA] }))).ok).toBe(true);                    // sair pode
    await w.db.exec(`update public.reservations set date = '2020-01-01' where id = '${id}'`);
    expect((await propose(w, ana, change(id, { remove_ids: [U.socioA] }))).code).toBe('IN_PAST');
  }, 60000);

  it('revalida na gravação: se a reserva mudou entre a proposta e o "sim", o servidor recusa e nada é alterado', async () => {
    const w = await world();
    await enable(w);
    const id = await game(w, await dateAt(w.db, 2), [U.socioB, U.socioA]);
    const ana = await session(w, ANA, 'Ana');
    const p = await propose(w, ana, change(id, { remove_ids: [U.socioA] }));
    expect(p.ok).toBe(true);
    await w.db.exec(`update public.reservations set status = 'cancelled' where id = '${id}'`);
    await pause();
    const yes = await say(w, ANA, 'sim');
    const c = await confirm(w, p.proposal_id, yes.message_id);
    expect([c.ok, c.code]).toEqual([false, 'RESERVATION_NOT_FOUND']);
    expect((await q<any>(w.db, `select status, failure_code from public.conv_booking_proposals`))[0]).toMatchObject({ status: 'failed', failure_code: 'RESERVATION_NOT_FOUND' });
  }, 60000);
});

describe('aceite por sentido em TODAS as ações (o servidor barra pergunta, negação, dúvida e mudança)', () => {
  const aceita = async (w: W, texto: string) => (await q<any>(w.db, `select conv_private.is_semantic_acceptance('${texto.replace(/'/g, "''")}') ok`))[0].ok as boolean;

  it.each([
    ['Show, coloca eu e o Hermeson', true], ['beleza, pode tirar nós dois', true], ['bora, me adiciona', true], ['isso aí, fechou', true], ['sim', true],
    ['não', false], ['talvez depois', false], ['e se for mais tarde?', false], ['sim mas às 19h', false], ['vou ver', false],
    ['cancela', false], ['ok mas troca o horário', false], ['quero outro horário', false], ['acho que sim', false], ['', false],
  ])('"%s" → %s', async (texto, esperado) => {
    const w = await world();
    expect(await aceita(w, texto)).toBe(esperado);
  }, 60000);

  it('"cancela" só barra quando a proposta não é de cancelamento ("sim, pode cancelar" aceita um cancelamento)', async () => {
    const w = await world();
    const f = async (t: string, allow: boolean) => (await q<any>(w.db, `select conv_private.is_semantic_acceptance('${t}', ${allow}) ok`))[0].ok as boolean;
    expect(await f('sim, pode cancelar', false)).toBe(false);
    expect(await f('sim, pode cancelar', true)).toBe(true);
    expect(await f('não, não cancela', true)).toBe(false);          // a negação continua barrando
    expect(await f('cancela mas só amanhã', true)).toBe(false);     // mudança continua barrando
  }, 60000);

  it('vale também para reservar e cancelar; a negação continua barrada pelo servidor mesmo que o modelo erre', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const s = await session(w, ANA, 'Ana');
    const c = await propose(w, s, { action: 'create', type: 'Play', date, start: '16:00', duration: 60, court_id: w.court1, participant_ids: [] });
    await pause();
    const no = await say(w, ANA, 'não, deixa pra lá');
    expect((await confirm(w, c.proposal_id, no.message_id)).code).toBe('NOT_EXPLICIT');
    await pause();
    const yes = await say(w, ANA, 'Show, pode fechar essa pra mim');
    expect((await confirm(w, c.proposal_id, yes.message_id)).ok).toBe(true);
    expect((await q<any>(w.db, `select count(*)::int c from public.reservations where status = 'active'`))[0].c).toBe(1);
  }, 60000);
});
