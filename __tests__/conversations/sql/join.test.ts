// @vitest-environment node
// Entrar no jogo: quando o horário já está reservado, a IA mostra quem está e, com o "sim" do solicitante, o acrescenta.
import { describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ID, j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;

const dateAt = async (db: PGlite, plusDays: number) =>
  (await q<{ d: string }>(db, `select (conv_private.today() + ${plusDays})::text d`))[0].d;

async function enable(w: W) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
}
async function session(w: W, phone: string, name = 'Sócio') {
  const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `J${++n}${Math.random()}`, chat_kind: 'direct', phone, name, kind: 'text', body: 'quero marcar uma quadra' })})`);
  const t = await svc<any>(w.db, `public.conv_svc_ai_trigger('${m.message_id}')`);
  return { conversation: m.conversation_id as string, session: t.session_id as string };
}
const say = (w: W, phone: string, body: string) =>
  svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `JC${++n}${Math.random()}`, chat_kind: 'direct', phone, kind: 'text', body })})`);
const propose = (w: W, s: { session: string }, p: Record<string, unknown>) => svc<any>(w.db, `public.conv_svc_ai_propose('${s.session}', ${j(p)})`);
const confirm = (w: W, proposal: string, message: string) => svc<any>(w.db, `public.conv_svc_ai_confirm('${proposal}', '${message}')`);
const games = (w: W, date: string, requester: string, start = 1080, end = 1140, court = w.court1) =>
  svc<any[]>(w.db, `public.conv_svc_ai_slot_games('${court}', '${date}', ${start}, ${end}, '${requester}')`);
const pause = () => new Promise((r) => setTimeout(r, 15));
const participants = async (w: W, id: string) => (await q<any>(w.db, `select participant_ids from public.reservations where id = '${id}'`))[0].participant_ids as string[];

/** Sócios extras (perfis reais: a auditoria das reservas exige participantes cadastrados). */
async function extraSocios(w: W, count: number) {
  const ids = Array.from({ length: count }, (_, i) => ID(8101 + i));
  await w.db.exec(`insert into auth.users(id) values ${ids.map((i) => `('${i}')`).join(',')};
    insert into public.profiles(id, name, role, is_professor, is_active) values ${ids.map((i, k) => `('${i}', 'Sócio Extra ${k + 1}', 'socio', false, true)`).join(',')}`);
  return ids;
}

/** Jogo de Play criado pelo Beto, 18:00–19:00 na Quadra 1. */
async function betoGame(w: W, date: string, over: { participants?: string[]; guest?: string; type?: string; start?: string; end?: string } = {}) {
  const id = ID(7000 + ++n);
  const parts = over.participants ?? [U.socioB];
  await w.db.exec(`insert into public.reservations(id, court_id, creator_id, date, start_time, end_time, type, participant_ids, guest_name)
    values ('${id}', '${w.court1}', '${U.socioB}', '${date}', '${over.start ?? '18:00'}', '${over.end ?? '19:00'}', '${over.type ?? 'Play'}',
      '{${parts.join(',')}}', ${over.guest ? `'${over.guest}'` : 'null'})`);
  return id;
}

describe('quem está no horário (conv_svc_ai_slot_games)', () => {
  it('lista o jogo que ocupa o horário, com os nomes de quem está (criador primeiro), as vagas e se a pessoa pode entrar', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date, { participants: [U.socioB, U.prof], guest: 'Zeca' });
    const g = await games(w, date, U.socioA);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ reservation_id: id, type: 'Play', start: '18:00', end: '19:00', court_name: 'Quadra 1', joinable: true, participants: 3, spots_left: 5 });
    expect(g[0].names).toEqual(['Beto Sócio', 'Paulo Professor', 'Zeca (convidado)']);
  }, 60000);

  it('só enxerga o que realmente sobrepõe: horário vizinho, outra quadra e reserva cancelada ficam de fora', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    await betoGame(w, date);
    expect(await games(w, date, U.socioA, 1140, 1200)).toHaveLength(0);                       // 19:00–20:00 está livre
    expect(await games(w, date, U.socioA, 1080, 1140, w.court2)).toHaveLength(0);             // outra quadra
    expect(await games(w, date, U.socioA, 1110, 1170)).toHaveLength(1);                       // 18:30–19:30 pega o jogo
    await w.db.exec(`update public.reservations set status = 'cancelled'`);
    expect(await games(w, date, U.socioA)).toHaveLength(0);
  }, 60000);

  it('aula não expõe alunos nem dá para entrar; a pessoa que já está no jogo vê "já está"', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    await betoGame(w, date, { type: 'Aula', start: '18:00', end: '18:30' });
    const aula = await games(w, date, U.socioA);
    expect(aula[0]).toMatchObject({ type: 'Aula', names: [], joinable: false, reason: 'NOT_JOINABLE' });
    await w.db.exec(`delete from public.reservations`);
    await betoGame(w, date);
    expect((await games(w, date, U.socioB))[0]).toMatchObject({ joinable: false, reason: 'ALREADY_IN' });
  }, 60000);

  it('jogo cheio (8, contando o convidado) e jogo que já terminou não são para entrar', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    const extra = await extraSocios(w, 4);
    const seven = [U.socioB, U.prof, U.profOther, ...extra];
    await betoGame(w, date, { participants: seven, guest: 'Zeca' });
    expect((await games(w, date, U.socioA))[0]).toMatchObject({ participants: 8, spots_left: 0, joinable: false, reason: 'GAME_FULL' });
    await w.db.exec(`delete from public.reservations`);
    await betoGame(w, '2020-01-01');
    expect((await games(w, '2020-01-01', U.socioA))[0]).toMatchObject({ joinable: false, reason: 'IN_PAST' });
  }, 60000);

  it('o solicitante precisa ser sócio ativo', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    await betoGame(w, date);
    expect((await games(w, date, U.lanch))[0]).toMatchObject({ joinable: false, reason: 'REQUESTER_NOT_MEMBER' });
    await w.db.exec(`update public.profiles set is_active = false where id = '${U.socioA}'`);
    expect((await games(w, date, U.socioA))[0]).toMatchObject({ joinable: false, reason: 'REQUESTER_NOT_MEMBER' });
  }, 60000);

  it('nem a IA nem o público conseguem chamar a consulta (só service_role)', async () => {
    const w = await world();
    const [r] = await q<any>(w.db, `select has_function_privilege('authenticated', 'public.conv_svc_ai_slot_games(uuid, date, integer, integer, uuid)', 'execute') a,
      has_function_privilege('anon', 'public.conv_svc_ai_slot_games(uuid, date, integer, integer, uuid)', 'execute') b,
      has_function_privilege('authenticated', 'conv_private.join_check(uuid, uuid)', 'execute') c`);
    expect([r.a, r.b, r.c]).toEqual([false, false, false]);
  }, 60000);
});

describe('proposta e confirmação de entrada', () => {
  it('fluxo: proposta não altera a reserva; o "sim" do solicitante acrescenta SÓ ele, com auditoria e sem reservation_id na proposta', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date);
    const s = await session(w, '99900000002', 'Ana');
    const p = await propose(w, s, { action: 'join', reservation_id: id });
    expect(p).toMatchObject({ ok: true, action: 'join' });
    expect(p.summary).toMatchObject({ start: '18:00', names: ['Beto Sócio'], spots_left: 7 });
    expect(await participants(w, id)).toEqual([U.socioB]);                       // proposta ≠ entrada
    await pause();
    const yes = await say(w, '99900000002', 'Sim, quero entrar');
    const c = await confirm(w, p.proposal_id, yes.message_id);
    expect(c).toMatchObject({ ok: true, action: 'join', reservation_id: id });
    expect(c.summary.names).toEqual(['Beto Sócio', 'Ana Sócia']);
    expect((await participants(w, id)).sort()).toEqual([U.socioA, U.socioB].sort());
    const [bp] = await q<any>(w.db, `select status, reservation_id, requester_profile_id, action from public.conv_booking_proposals`);
    expect(bp).toMatchObject({ status: 'confirmed', reservation_id: null, requester_profile_id: U.socioA, action: 'join' });
    const [a] = await q<any>(w.db, `select * from public.admin_audit_logs where action = 'conv.ai_reservation_joined'`);
    expect(a.metadata).toMatchObject({ actor: 'ai', source: 'whatsapp', requester_profile_id: U.socioA, conversation_id: s.conversation });
    expect(JSON.stringify(a)).not.toContain('Sim, quero entrar');
  }, 60000);

  it('"sim" repetido não duplica a pessoa; dois sócios diferentes entram no mesmo jogo', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date);
    const a = await session(w, '99900000002', 'Ana');
    const pa = await propose(w, a, { action: 'join', reservation_id: id });
    await pause();
    const yesA = await say(w, '99900000002', 'sim');
    expect((await confirm(w, pa.proposal_id, yesA.message_id)).ok).toBe(true);
    const again = await confirm(w, pa.proposal_id, yesA.message_id);
    expect(again).toMatchObject({ ok: true, replayed: true, reservation_id: id });
    expect((await participants(w, id)).filter((x) => x === U.socioA)).toHaveLength(1);

    const adm = await session(w, '99900000001', 'Admin');
    const pb = await propose(w, adm, { action: 'join', reservation_id: id });
    expect(pb.ok).toBe(true);                                                   // o índice único de propostas não atrapalha o segundo
    await pause();
    const yesB = await say(w, '99900000001', 'pode entrar');
    expect((await confirm(w, pb.proposal_id, yesB.message_id)).ok).toBe(true);
    expect(await participants(w, id)).toHaveLength(3);
  }, 60000);

  it('recusa na proposta: já participa, cheio, não é Play, passou, reserva inexistente, não é sócio', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date);
    const beto = await session(w, '99900000003', 'Beto');
    expect((await propose(w, beto, { action: 'join', reservation_id: id })).code).toBe('ALREADY_IN');
    const ana = await session(w, '99900000002', 'Ana');
    expect((await propose(w, ana, { action: 'join', reservation_id: ID(9999) })).code).toBe('RESERVATION_NOT_FOUND');
    await w.db.exec(`update public.reservations set type = 'Aula' where id = '${id}'`);
    expect((await propose(w, ana, { action: 'join', reservation_id: id })).code).toBe('NOT_JOINABLE');
    const extra = await extraSocios(w, 5);
    const eight = [U.socioB, U.prof, U.profOther, ...extra];
    await w.db.exec(`update public.reservations set type = 'Play', participant_ids = '{${eight.join(',')}}' where id = '${id}'`);
    expect((await propose(w, ana, { action: 'join', reservation_id: id })).code).toBe('GAME_FULL');
    await w.db.exec(`update public.reservations set participant_ids = '{${U.socioB}}', date = '2020-01-01' where id = '${id}'`);
    expect((await propose(w, ana, { action: 'join', reservation_id: id })).code).toBe('IN_PAST');
    expect((await q<any>(w.db, `select count(*)::int c from public.conv_booking_proposals where status = 'open'`))[0].c).toBe(0);
  }, 60000);

  it('revalida na gravação: se o jogo lotou entre a pergunta e o "sim", ninguém entra e a proposta falha', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date);
    const ana = await session(w, '99900000002', 'Ana');
    const p = await propose(w, ana, { action: 'join', reservation_id: id });
    expect(p.ok).toBe(true);
    const extra = await extraSocios(w, 5);
    await w.db.exec(`update public.reservations set participant_ids = '{${[U.socioB, U.prof, U.profOther, ...extra].join(',')}}' where id = '${id}'`);
    await pause();
    const yes = await say(w, '99900000002', 'sim');
    const c = await confirm(w, p.proposal_id, yes.message_id);
    expect([c.ok, c.code]).toEqual([false, 'GAME_FULL']);
    expect((await participants(w, id))).not.toContain(U.socioA);
    expect((await q<any>(w.db, `select status, failure_code from public.conv_booking_proposals`))[0]).toMatchObject({ status: 'failed', failure_code: 'GAME_FULL' });
  }, 60000);

  it('exige confirmação inequívoca: "talvez" não entra', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date);
    const ana = await session(w, '99900000002', 'Ana');
    const p = await propose(w, ana, { action: 'join', reservation_id: id });
    await pause();
    const maybe = await say(w, '99900000002', 'talvez, vou ver');
    expect((await confirm(w, p.proposal_id, maybe.message_id)).code).toBe('NOT_EXPLICIT');
    expect(await participants(w, id)).toEqual([U.socioB]);
  }, 60000);

  it('o que já existia continua igual: criar reserva em horário ocupado segue SLOT_TAKEN', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    await betoGame(w, date);
    const ana = await session(w, '99900000002', 'Ana');
    const r = await propose(w, ana, { action: 'create', type: 'Play', date, start: '18:00', duration: 60, court_id: w.court1, participant_ids: [] });
    expect([r.ok, r.code]).toEqual([false, 'SLOT_TAKEN']);
  }, 60000);
});

describe('entrar com quem for junto (sócios mencionados e convidado)', () => {
  const party = (id: string, extra: string[], guest: string | null = null) => ({ action: 'join', reservation_id: id, participant_ids: extra, guest_name: guest });

  it('proposta leva o solicitante + sócios mencionados + convidado; o "sim" grava todos de uma vez, com o convidado sob responsabilidade de quem pediu', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date);
    const ana = await session(w, '99900000002', 'Ana');
    const p = await propose(w, ana, party(id, [U.prof, U.profOther], 'Zeca'));
    expect(p.ok).toBe(true);
    expect(p.summary).toMatchObject({ adding: 4, spots_left: 7, add_names: ['Paulo Professor', 'Olga Professora', 'Zeca (convidado)'] });
    expect(p.summary.add_ids).toHaveLength(3);                                   // Ana + 2 sócios; o convidado não é perfil
    expect(await participants(w, id)).toEqual([U.socioB]);                       // proposta ≠ entrada
    await pause();
    const yes = await say(w, '99900000002', 'sim');
    const c = await confirm(w, p.proposal_id, yes.message_id);
    expect(c).toMatchObject({ ok: true, action: 'join', reservation_id: id });
    expect(c.summary).toMatchObject({ added: 4, participants: 5, spots_left: 3 });
    expect((await participants(w, id)).sort()).toEqual([U.socioA, U.socioB, U.prof, U.profOther].sort());
    const [r] = await q<any>(w.db, `select guest_name, guest_responsible_id from public.reservations where id = '${id}'`);
    expect([r.guest_name, r.guest_responsible_id]).toEqual(['Zeca', U.socioA]);
    const [a] = await q<any>(w.db, `select old_data, new_data from public.admin_audit_logs where action = 'conv.ai_reservation_joined'`);
    expect([a.old_data.participants, a.new_data.participants]).toEqual([1, 5]);
  }, 60000);

  it('quem já está no jogo (e o próprio solicitante) listados entre os mencionados são ignorados, sem erro e sem duplicar', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date);
    const ana = await session(w, '99900000002', 'Ana');
    const p = await propose(w, ana, party(id, [U.socioB, U.socioA, U.prof, U.prof]));
    expect(p.ok).toBe(true);
    expect(p.summary).toMatchObject({ adding: 2, add_names: ['Paulo Professor'] });
    await pause();
    const yes = await say(w, '99900000002', 'sim');
    expect((await confirm(w, p.proposal_id, yes.message_id)).ok).toBe(true);
    const ps = await participants(w, id);
    expect(ps.sort()).toEqual([U.socioA, U.socioB, U.prof].sort());
    expect(new Set(ps).size).toBe(ps.length);
  }, 60000);

  it('cabe tudo ou nada: sem vagas para todos, recusa informando as vagas e não cria proposta', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const extra = await extraSocios(w, 5);
    const id = await betoGame(w, date, { participants: [U.socioB, ...extra] });  // 6 pessoas → restam 2
    const ana = await session(w, '99900000002', 'Ana');
    const r = await propose(w, ana, party(id, [U.prof, U.profOther]));            // Ana + 2 = 3 > 2
    expect(r).toMatchObject({ ok: false, code: 'NOT_ENOUGH_SPOTS', spots_left: 2, wanted: 3 });
    expect((await q<any>(w.db, `select count(*)::int c from public.conv_booking_proposals`))[0].c).toBe(0);
    expect((await propose(w, ana, party(id, [U.prof]))).ok).toBe(true);           // Ana + 1 = 2 cabe
  }, 60000);

  it('mencionado que não é sócio ativo, convidado em jogo que já tem convidado e convidado sem nome são recusados', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date);
    const ana = await session(w, '99900000002', 'Ana');
    expect((await propose(w, ana, party(id, [U.lanch]))).code).toBe('PARTICIPANT_NOT_MEMBER');
    expect((await propose(w, ana, party(id, [], 'X'))).code).toBe('INVALID_GUEST');
    await w.db.exec(`update public.reservations set guest_name = 'Zeca' where id = '${id}'`);
    expect((await propose(w, ana, party(id, [], 'Maria'))).code).toBe('GUEST_ALREADY');
    expect((await propose(w, ana, party(id, []))).ok).toBe(true);                // sem convidado novo, entra
  }, 60000);

  it('revalida na gravação: se as vagas acabaram entre a pergunta e o "sim", ninguém do grupo entra', async () => {
    const w = await world();
    await enable(w);
    const date = await dateAt(w.db, 3);
    const id = await betoGame(w, date);
    const ana = await session(w, '99900000002', 'Ana');
    const p = await propose(w, ana, party(id, [U.prof, U.profOther]));
    expect(p.ok).toBe(true);
    const extra = await extraSocios(w, 5);
    await w.db.exec(`update public.reservations set participant_ids = '{${[U.socioB, ...extra].join(',')}}' where id = '${id}'`);   // 6 → restam 2 < 3
    await pause();
    const yes = await say(w, '99900000002', 'sim');
    const c = await confirm(w, p.proposal_id, yes.message_id);
    expect([c.ok, c.code]).toEqual([false, 'NOT_ENOUGH_SPOTS']);
    const ps = await participants(w, id);
    expect([U.socioA, U.prof, U.profOther].some((x) => ps.includes(x))).toBe(false);
    expect((await q<any>(w.db, `select status, failure_code from public.conv_booking_proposals`))[0]).toMatchObject({ status: 'failed', failure_code: 'NOT_ENOUGH_SPOTS' });
  }, 60000);
});

describe('respostas ao "quer entrar nesse jogo?"', () => {
  it.each([
    ['sim', true], ['Sim, quero entrar', true], ['sim quero entrar nesse jogo', true], ['entro', true], ['topo', true], ['bora', true], ['pode entrar', true],
    ['sim, mas no sábado', false], ['quero outro horário', false], ['quero entrar', false], ['não quero', false], ['talvez', false],
    ['sim, entra o Carlos também?', false], ['quero cancelar', false], ['vou ver', false],
  ])('"%s" → %s', async (texto, esperado) => {
    const w = await world();
    const [r] = await q<any>(w.db, `select conv_private.is_confirmation(${JSON.stringify(texto).replace(/"/g, "'")}) ok`);
    expect(r.ok).toBe(esperado);
  }, 60000);
});
