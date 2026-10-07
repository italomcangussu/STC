// @vitest-environment node
// Pacote do João: memória social aprovada pela diretoria, resultados recentes, anti-repetição e pulso do clube.
import { describe, expect, it } from 'vitest';
import { ID, j, key, q, rpc, rpcError, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;
const PHONE = '99900000002';

const candidate = (w: W, over: Record<string, unknown> = {}) =>
  svc<string>(w.db, `public.conv_svc_ai_memory_candidate(${j({ subject_name: 'Beto Sócio', kind: 'recurring_preference', content: 'Prefere jogar de manhã cedo.', confidence: 0.8, ...over })})`);
const pack = (w: W, session: string) => svc<any>(w.db, `public.conv_svc_ai_joao_pack('${session}')`);

async function session(w: W) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
  const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `P${++n}${Math.random()}`, chat_kind: 'direct', phone: PHONE, name: 'Ana', kind: 'text', body: 'oi' })})`);
  const t = await svc<any>(w.db, `public.conv_svc_ai_trigger('${m.message_id}')`);
  return { conversation: m.conversation_id as string, session: t.session_id as string };
}

describe('memória social supervisionada (ciclo fechado)', () => {
  it('sugerida fica pendente e NÃO chega ao João; aprovada (com texto corrigido) chega; recusada sai', async () => {
    const w = await world();
    const s = await session(w);
    const id = await candidate(w);
    expect((await pack(w, s.session)).memories).toEqual([]);

    const pending = await rpc<any[]>(w.db, U.admin, `public.conv_list_ai_memory_candidates('pending')`);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id, subject_name: 'Beto Sócio', kind: 'recurring_preference', status: 'pending' });

    await rpc(w.db, U.admin, `public.conv_review_ai_memory_candidate('${id}', 'approved', 'Gosta de jogar cedo, antes do calor.')`);
    expect((await rpc<any[]>(w.db, U.admin, `public.conv_list_ai_memory_candidates('pending')`))).toEqual([]);
    expect((await pack(w, s.session)).memories).toEqual([
      { subject_name: 'Beto Sócio', kind: 'recurring_preference', content: 'Gosta de jogar cedo, antes do calor.' }]);

    await rpc(w.db, U.admin, `public.conv_review_ai_memory_candidate('${id}', 'rejected')`);   // a diretoria volta atrás
    expect((await pack(w, s.session)).memories).toEqual([]);
    const [row] = await q<any>(w.db, `select status, reviewed_by, content from public.conv_ai_memory_candidates where id = '${id}'`);
    expect(row).toMatchObject({ status: 'rejected', reviewed_by: U.admin, content: 'Gosta de jogar cedo, antes do calor.' });
  }, 60000);

  it('só administrador revisa; decisão inválida e candidata inexistente falham; a revisão deixa rastro na auditoria', async () => {
    const w = await world();
    const id = await candidate(w);
    expect(await rpcError(w.db, U.socioA, `public.conv_list_ai_memory_candidates('pending')`)).toMatch(/CONV_FORBIDDEN/);
    expect(await rpcError(w.db, U.socioA, `public.conv_review_ai_memory_candidate('${id}', 'approved')`)).toMatch(/CONV_FORBIDDEN/);
    expect(await rpcError(w.db, U.admin, `public.conv_review_ai_memory_candidate('${id}', 'talvez')`)).toMatch(/INVALID_DECISION/);
    expect(await rpcError(w.db, U.admin, `public.conv_review_ai_memory_candidate('${ID(999)}', 'approved')`)).toMatch(/CANDIDATE_NOT_FOUND/);
    expect(await rpcError(w.db, U.admin, `public.conv_list_ai_memory_candidates('qualquer')`)).toMatch(/INVALID_STATUS/);
    expect(await rpcError(w.db, U.admin, `public.conv_review_ai_memory_candidate('${id}', 'approved', 'ok')`)).toMatch(/CONTENT_TOO_SHORT/);
    await rpc(w.db, U.admin, `public.conv_review_ai_memory_candidate('${id}', 'approved')`);
    const logs = await q<any>(w.db, `select action, actor_user_id from public.admin_audit_logs where source = 'conversations' and action = 'conv.ai_memory_review'`);
    expect(logs).toEqual([{ action: 'conv.ai_memory_review', actor_user_id: U.admin }]);
  }, 60000);

  it('o João (service_role) é o único que lê o pacote; o app autenticado não', async () => {
    const w = await world();
    const s = await session(w);
    expect(await rpcError(w.db, U.admin, `public.conv_svc_ai_joao_pack('${s.session}')`)).toBeTruthy();
    expect(await rpcError(w.db, U.admin, `public.conv_svc_ai_club_pulse()`)).toBeTruthy();
  }, 60000);
});

describe('resultados recentes do clube', () => {
  const finished = (w: W, o: { id: number; a: string | null; b: string | null; winner: string | null; sa: string; sb: string; days: number; walkover?: boolean; status?: string }) =>
    w.db.exec(`insert into public.championships(id, name) values ('${ID(700)}', 'Open da Galera') on conflict do nothing;
      insert into public.matches(id, championship_id, phase, player_a_id, player_b_id, winner_id, score_a, score_b, status, date, is_walkover)
      values ('${ID(o.id)}', '${ID(700)}', 'Semifinal', ${o.a ? `'${o.a}'` : 'null'}, ${o.b ? `'${o.b}'` : 'null'}, ${o.winner ? `'${o.winner}'` : 'null'},
        '${o.sa}', '${o.sb}', '${o.status ?? 'finished'}', conv_private.today() - ${o.days}, ${o.walkover ?? false})`);

  it('traz só partida encerrada, com vencedor, recente; placar do ponto de vista de quem ganhou; W.O. sem placar', async () => {
    const w = await world();
    const s = await session(w);
    await finished(w, { id: 1, a: U.socioA, b: U.socioB, winner: U.socioA, sa: '{6,7}', sb: '{3,5}', days: 2 });         // A ganhou
    await finished(w, { id: 2, a: U.socioA, b: U.socioB, winner: U.socioB, sa: '{4,6,3}', sb: '{6,2,6}', days: 1 });     // B ganhou (B no placar primeiro)
    await finished(w, { id: 3, a: U.socioA, b: U.socioB, winner: U.socioB, sa: '{}', sb: '{}', days: 3, walkover: true });
    await finished(w, { id: 4, a: U.socioA, b: U.socioB, winner: U.socioA, sa: '{6,6}', sb: '{0,0}', days: 40 });         // antiga
    await finished(w, { id: 5, a: U.socioA, b: U.socioB, winner: U.socioA, sa: '{6}', sb: '{2}', days: 1, status: 'pending' }); // não encerrada
    await finished(w, { id: 6, a: U.socioA, b: null, winner: U.socioA, sa: '{6,6}', sb: '{0,0}', days: 1 });             // sem adversário (bye)
    await finished(w, { id: 7, a: U.socioA, b: U.socioB, winner: null, sa: '{6}', sb: '{4}', days: 1 });                 // sem vencedor
    const r = (await pack(w, s.session)).results as any[];
    expect(r.map((x) => [x.winner, x.loser, x.score, x.walkover])).toEqual([
      ['Beto Sócio', 'Ana Sócia', '6x4 2x6 6x3', false],   // ontem
      ['Ana Sócia', 'Beto Sócio', '6x3 7x5', false],       // anteontem
      ['Beto Sócio', 'Ana Sócia', null, true],             // há 3 dias, W.O.
    ]);
    expect(r[0]).toMatchObject({ championship: 'Open da Galera', phase: 'Semifinal' });
  }, 60000);

  it('sem partidas recentes, a lista vem vazia (o João não inventa resultado)', async () => {
    const w = await world();
    const s = await session(w);
    expect((await pack(w, s.session)).results).toEqual([]);
  }, 60000);
});

describe('anti-repetição e pulso do clube', () => {
  it('as últimas falas do João (IA e bom-dia) voltam em ordem; fala da equipe e de mais de 3 dias não', async () => {
    const w = await world();
    const s = await session(w);
    const say = (origin: string, body: string, ago: string) => w.db.exec(`insert into public.conv_messages(conversation_id, direction, kind, body, status, origin, ai_session_id, created_at)
      values ('${s.conversation}', 'outbound', 'text', '${body}', 'sent', '${origin}', ${origin === 'ai' ? `'${s.session}'` : 'null'}, now() - interval '${ago}')`);
    await say('ai', 'velha demais', '4 days');
    await say('ai', 'primeira piada', '3 hours');
    await say('staff', 'fala da equipe', '2 hours');
    await say('system', 'Bom dia, turma!', '1 hour');
    await say('ai', 'segunda piada', '10 minutes');
    expect((await pack(w, s.session)).own_lines).toEqual(['primeira piada', 'Bom dia, turma!', 'segunda piada']);
  }, 60000);

  it('o pulso conta os plays de hoje (e só os ativos) e traz o horário do primeiro', async () => {
    const w = await world();
    const ins = (court: string, start: string, end: string, status: string, type = 'Play') => w.db.exec(
      `insert into public.reservations(court_id, creator_id, date, start_time, end_time, type, status, participant_ids)
       values ('${court}', '${U.socioA}', conv_private.today(), '${start}', '${end}', '${type}', '${status}', '{}')`);
    expect(await svc<any>(w.db, `public.conv_svc_ai_club_pulse()`)).toMatchObject({ plays_today: 0, first_play_today: null, results: [] });
    await ins(w.court1, '19:00', '20:00', 'active');
    await ins(w.court2, '06:30', '07:30', 'active');
    await ins(w.fast, '08:00', '08:30', 'active', 'Aula');
    await ins(w.court1, '10:00', '11:00', 'cancelled');
    expect(await svc<any>(w.db, `public.conv_svc_ai_club_pulse()`)).toMatchObject({ plays_today: 2, first_play_today: '06:30' });
  }, 60000);
});
