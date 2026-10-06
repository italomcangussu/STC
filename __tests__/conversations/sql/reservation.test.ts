// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ID, j, key, q, rpc, svc, U, world } from './harness';

type W = Awaited<ReturnType<typeof world>>;
let n = 0;

const dateAt = async (db: PGlite, plusDays: number) =>
  (await q<{ d: string }>(db, `select (conv_private.today() + ${plusDays})::text d`))[0].d;
const validate = (db: PGlite, p: Record<string, unknown>) =>
  q<{ r: any }>(db, `select conv_private.validate_reservation(${j(p)}) r`).then((x) => x[0].r);

async function enable(w: W) {
  await rpc(w.db, U.admin, `public.conv_save_ai_settings('${key()}', ${j({ active: true, model: 'modelo-de-teste' })})`);
  await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ ai_direct_enabled: true })})`);
}

/** Uma conversa direta de um sócio (telefone ligado ao cadastro) com a sessão da IA aberta. */
async function session(w: W, phone: string, name = 'Sócio') {
  const m = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `S${++n}${Math.random()}`, chat_kind: 'direct', phone, name, kind: 'text', body: 'quero marcar uma quadra' })})`);
  const t = await svc<any>(w.db, `public.conv_svc_ai_trigger('${m.message_id}')`);
  return { conversation: m.conversation_id as string, session: t.session_id as string, contact: m.contact_id as string, message: m.message_id as string };
}
const say = (w: W, conversation: string, phone: string, body: string) =>
  svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `C${++n}${Math.random()}`, chat_kind: 'direct', phone, kind: 'text', body })})`);
const propose = (w: W, s: { session: string }, p: Record<string, unknown>) => svc<any>(w.db, `public.conv_svc_ai_propose('${s.session}', ${j(p)})`);
const confirm = (w: W, proposal: string, message: string) => svc<any>(w.db, `public.conv_svc_ai_confirm('${proposal}', '${message}')`);
const reservations = (w: W) => q<any>(w.db, `select * from public.reservations order by created_at`);
const pause = () => new Promise((r) => setTimeout(r, 15));   // garante created_at posterior ao da proposta

describe('regras de reserva espelhadas do app (validate_reservation)', () => {
  it('Play válido é normalizado; o solicitante entra na lista de participantes', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    const r = await validate(w.db, { type: 'Play', date, start: '16:00', duration: 60, court_id: w.court1, requester_profile_id: U.socioA, participant_ids: [U.socioB] });
    expect(r.ok).toBe(true);
    expect(r.normalized).toMatchObject({ start: '16:00', end: '17:00', court_name: 'Quadra 1' });
    expect(r.normalized.participant_ids.sort()).toEqual([U.socioA, U.socioB].sort());
  }, 60000);

  it.each([
    ['horário fora da grade de 30 min', { start: '16:15', duration: 60 }, 'INVALID_START'],
    ['antes da abertura', { start: '04:30', duration: 60 }, 'INVALID_START'],
    ['Play de 30 minutos', { start: '16:00', duration: 30 }, 'INVALID_DURATION'],
    ['duração livre', { start: '16:00', duration: 75 }, 'INVALID_DURATION'],
    ['termina depois das 23:00', { start: '22:30', duration: 60 }, 'AFTER_CLOSING'],
    ['data inválida', { date: '2026-13-45', start: '16:00', duration: 60 }, 'INVALID_DATE'],
    ['data passada', { date: '2020-01-01', start: '16:00', duration: 60 }, 'IN_PAST'],
  ])('Play recusado: %s', async (_nome, over, code) => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    const r = await validate(w.db, { type: 'Play', date, court_id: w.court1, requester_profile_id: U.socioA, ...over });
    expect([r.ok, r.code]).toEqual([false, code]);
  }, 60000);

  it('horário que já passou hoje é recusado', async () => {
    const w = await world();
    const [t] = await q<{ d: string; m: number }>(w.db, `select conv_private.today()::text d, (extract(hour from now() at time zone 'America/Fortaleza')::int * 60 + extract(minute from now() at time zone 'America/Fortaleza')::int) m`);
    if (t.m < 360 || t.m > 1260) return;   // fora do horário de funcionamento a grade não cobre "agora"; o caso já é coberto por INVALID_START
    const past = Math.floor(t.m / 30) * 30 - 30;
    const hhmm = `${String(Math.floor(past / 60)).padStart(2, '0')}:${String(past % 60).padStart(2, '0')}`;
    const r = await validate(w.db, { type: 'Play', date: t.d, start: hhmm, duration: 60, court_id: w.court1, requester_profile_id: U.socioA });
    expect([r.ok, r.code]).toEqual([false, 'IN_PAST']);
  }, 60000);

  it('quadra inexistente/inativa, participante inativo, mais de 8 e não-sócio são recusados', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    const base = { type: 'Play', date, start: '16:00', duration: 60, court_id: w.court1, requester_profile_id: U.socioA };
    expect((await validate(w.db, { ...base, court_id: ID(999) })).code).toBe('COURT_NOT_FOUND');
    await w.db.exec(`update public.courts set is_active = false where id = '${w.court2}'`);
    expect((await validate(w.db, { ...base, court_id: w.court2 })).code).toBe('COURT_NOT_FOUND');
    await w.db.exec(`update public.profiles set is_active = false where id = '${U.socioB}'`);
    expect((await validate(w.db, { ...base, participant_ids: [U.socioB] })).code).toBe('PARTICIPANT_NOT_MEMBER');
    expect((await validate(w.db, { ...base, participant_ids: [U.lanch] })).code).toBe('PARTICIPANT_NOT_MEMBER');   // lanchonete não é sócio
    expect((await validate(w.db, { ...base, requester_profile_id: U.lanch })).code).toBe('REQUESTER_NOT_MEMBER');
    const many = Array.from({ length: 8 }, (_, i) => ID(5000 + i));
    expect((await validate(w.db, { ...base, participant_ids: many, guest_name: 'Convidado' })).code).toMatch(/TOO_MANY_PARTICIPANTS|PARTICIPANT_NOT_MEMBER/);
    expect((await validate(w.db, { ...base, guest_name: 'X' })).code).toBe('INVALID_GUEST');
    expect((await validate(w.db, { ...base, guest_name: 'Carlos Convidado' })).ok).toBe(true);
  }, 60000);

  it('quadra ocupada é bloqueio duro (no app é só um aviso); outra quadra ou horário vizinho estão livres', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    await w.db.exec(`insert into public.reservations(court_id, creator_id, date, start_time, end_time, type, participant_ids)
      values ('${w.court1}', '${U.socioB}', '${date}', '16:00', '17:00', 'Play', '{}')`);
    const base = { type: 'Play', date, duration: 60, requester_profile_id: U.socioA };
    expect((await validate(w.db, { ...base, start: '16:30', court_id: w.court1 })).code).toBe('SLOT_TAKEN');
    expect((await validate(w.db, { ...base, start: '15:30', court_id: w.court1 })).code).toBe('SLOT_TAKEN');
    expect((await validate(w.db, { ...base, start: '17:00', court_id: w.court1 })).ok).toBe(true);
    expect((await validate(w.db, { ...base, start: '16:00', court_id: w.court2 })).ok).toBe(true);
    // reserva cancelada libera o horário
    await w.db.exec(`update public.reservations set status = 'cancelled'`);
    expect((await validate(w.db, { ...base, start: '16:00', court_id: w.court1 })).ok).toBe(true);
    const slots = await svc<string[]>(w.db, `public.conv_svc_available_slots('${date}', '${w.court1}', 60)`);
    expect(slots[0]).toBe('05:00');
    expect(slots).toContain('22:00');
    expect(slots).not.toContain('22:30');   // 22:30 + 60 passaria das 23:00
  }, 60000);

  it('Aula: só admin/professor, só na Quadra Rápida, 30 min, professor e aluno obrigatórios', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    const aula = { type: 'Aula', date, start: '10:00', duration: 30, court_id: w.fast };
    await w.db.exec(`insert into public.student_profiles(profile_id, student_status) values ('${U.socioB}', 'active')`);
    // sócio comum não marca aula
    expect((await validate(w.db, { ...aula, requester_profile_id: U.socioA, participant_ids: [U.socioB] })).code).toBe('NOT_ALLOWED_AULA');
    // professor marca; o professor é o dele
    const ok = await validate(w.db, { ...aula, requester_profile_id: U.prof, participant_ids: [U.socioB] });
    expect(ok.ok).toBe(true);
    expect(ok.normalized.professor_id).toBe(w.professor);
    expect(ok.normalized.participant_ids).toEqual([U.socioB]);   // o professor não vira aluno
    // admin precisa dizer qual professor
    expect((await validate(w.db, { ...aula, requester_profile_id: U.admin, participant_ids: [U.socioB] })).code).toBe('PROFESSOR_REQUIRED');
    expect((await validate(w.db, { ...aula, requester_profile_id: U.admin, professor_id: w.professor, participant_ids: [U.socioB] })).ok).toBe(true);
    expect((await validate(w.db, { ...aula, requester_profile_id: U.prof, court_id: w.court1, participant_ids: [U.socioB] })).code).toBe('AULA_ONLY_FAST_COURT');
    expect((await validate(w.db, { ...aula, requester_profile_id: U.prof, duration: 60, participant_ids: [U.socioB] })).code).toBe('INVALID_DURATION');
    expect((await validate(w.db, { ...aula, requester_profile_id: U.prof })).code).toBe('STUDENT_REQUIRED');
    await w.db.exec(`update public.student_profiles set student_status = 'paused' where profile_id = '${U.socioB}'`);
    expect((await validate(w.db, { ...aula, requester_profile_id: U.prof, participant_ids: [U.socioB] })).code).toBe('STUDENT_PAUSED');
  }, 60000);

  it('Aula com aluno não-sócio: Card Mensal vencido bloqueia; dependente não precisa de card; horário restrito; Day Card Experimental vai para a equipe', async () => {
    const w = await world();
    const date = await dateAt(w.db, 3);
    const past = await dateAt(w.db, -5), future = await dateAt(w.db, 30);
    await w.db.exec(`insert into public.non_socio_students(id, name, phone, plan_type, plan_status, master_expiration_date, student_type) values
      ('${ID(710)}', 'Card Válido', null, 'Card Mensal', 'active', '${future}', 'regular'),
      ('${ID(711)}', 'Card Vencido', null, 'Card Mensal', 'active', '${past}', 'regular'),
      ('${ID(712)}', 'Dependente', null, 'Dependente', 'inactive', null, 'dependent'),
      ('${ID(713)}', 'Experimental', null, 'Day Card Experimental', 'active', null, 'regular'),
      ('${ID(714)}', 'Day Card', null, 'Day Card', 'active', null, 'regular')`);
    const aula = { type: 'Aula', date, duration: 30, court_id: w.fast, requester_profile_id: U.prof };
    // dia útil qualquer: se for domingo a restrição de horário não vale; escolhemos horário de manhã para não depender
    expect((await validate(w.db, { ...aula, start: '09:00', non_socio_student_ids: [ID(710)] })).ok).toBe(true);
    expect((await validate(w.db, { ...aula, start: '09:00', non_socio_student_ids: [ID(711)] })).code).toBe('CARD_INVALID');
    expect((await validate(w.db, { ...aula, start: '09:00', non_socio_student_ids: [ID(712)] })).ok).toBe(true);
    expect((await validate(w.db, { ...aula, start: '09:00', non_socio_student_ids: [ID(713)] })).code).toBe('NEEDS_HUMAN');
    expect((await validate(w.db, { ...aula, start: '09:00', non_socio_student_ids: [ID(714)] })).ok).toBe(true);
    const [dow] = await q<{ d: number }>(w.db, `select extract(dow from '${date}'::date)::int d`);
    if (dow.d !== 0) expect((await validate(w.db, { ...aula, start: '15:00', non_socio_student_ids: [ID(710)] })).code).toBe('NON_MEMBER_HOURS');
    expect((await validate(w.db, { ...aula, start: '20:00', non_socio_student_ids: [ID(710)] })).ok).toBe(true);
    await w.db.exec(`update public.non_socio_students set is_active = false where id = '${ID(710)}'`);
    expect((await validate(w.db, { ...aula, start: '09:00', non_socio_student_ids: [ID(710)] })).code).toBe('STUDENT_PAUSED');
  }, 60000);
});

describe('"sim" inequívoco (is_confirmation)', () => {
  it.each([
    ['sim', true], ['Sim!', true], ['sim, pode confirmar', true], ['pode marcar', true], ['Pode ser 👍', true], ['confirmo', true],
    ['fechado', true], ['isso mesmo', true], ['ok', true], ['👍', true],
    ['não', false], ['sim, mas troca para as 17h', false], ['talvez', false], ['pode ser outro horário?', false], ['sim, quando?', false],
    ['espera', false], ['sim pode confirmar a reserva da Maria na quadra 2 amanhã', false], ['', false],
  ])('%s → %s', async (texto, esperado) => {
    const w = await world();
    const [r] = await q<{ r: boolean }>(w.db, `select conv_private.is_confirmation('${texto.replace(/'/g, "''")}') r`);
    expect(r.r).toBe(esperado);
  }, 60000);
});

describe('proposta → confirmação → reserva (a IA nunca grava sozinha)', () => {
  const play = async (w: W, plusDays = 3, start = '16:00', over: Record<string, unknown> = {}) =>
    ({ type: 'Play', date: await dateAt(w.db, plusDays), start, duration: 60, court_id: w.court1, participant_ids: [U.socioB], ...over });

  it('fluxo completo: proposta não cria reserva; "sim" do solicitante cria pelo mesmo registro do app, com origem rastreável', async () => {
    const w = await world();
    await enable(w);
    const s = await session(w, '85988880002', 'Ana');
    const p = await propose(w, s, await play(w));
    expect(p.ok).toBe(true);
    expect((await reservations(w)).length).toBe(0);                       // proposta ≠ reserva
    await pause();
    const yes = await say(w, s.conversation, '85988880002', 'Sim, pode confirmar');
    const c = await confirm(w, p.proposal_id, yes.message_id);
    expect(c.ok).toBe(true);
    const [r] = await reservations(w);
    expect(r).toMatchObject({ type: 'Play', status: 'active', creator_id: U.socioA, court_id: w.court1 });
    expect(r.participant_ids.sort()).toEqual([U.socioA, U.socioB].sort());
    expect(String(r.start_time)).toMatch(/^16:00/);
    expect(r.observation).toBe('Reserva via WhatsApp (IA)');
    const [bp] = await q<any>(w.db, `select * from public.conv_booking_proposals`);
    expect([bp.status, bp.reservation_id, bp.confirmed_message_id, bp.requester_profile_id]).toEqual(['confirmed', r.id, yes.message_id, U.socioA]);
    // auditoria: ator "ai", origem WhatsApp, solicitante e conversa — sem corpo de mensagem
    const [a] = await q<any>(w.db, `select * from public.admin_audit_logs where action = 'conv.ai_reservation_created'`);
    expect(a.metadata).toMatchObject({ actor: 'ai', source: 'whatsapp', requester_profile_id: U.socioA, conversation_id: s.conversation });
    expect(a.target_user_id).toBe(U.socioA);
    expect(JSON.stringify(a)).not.toContain('Sim, pode confirmar');
  }, 60000);

  it('confirmação repetida (webhook/retry/"sim" duplicado) não cria segunda reserva', async () => {
    const w = await world();
    await enable(w);
    const s = await session(w, '85988880002', 'Ana');
    const p = await propose(w, s, await play(w));
    await pause();
    const yes = await say(w, s.conversation, '85988880002', 'sim');
    const a = await confirm(w, p.proposal_id, yes.message_id);
    const yes2 = await say(w, s.conversation, '85988880002', 'sim');
    const b = await confirm(w, p.proposal_id, yes2.message_id);
    const c = await confirm(w, p.proposal_id, yes.message_id);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(b.replayed).toBe(true);
    expect(b.reservation_id).toBe(a.reservation_id);
    expect((await reservations(w)).length).toBe(1);
  }, 60000);

  it('só confirmação clara vale: "talvez", "sim, mas…", pergunta e mensagem ANTERIOR à proposta não criam nada', async () => {
    const w = await world();
    await enable(w);
    const s = await session(w, '85988880002', 'Ana');
    const early = await say(w, s.conversation, '85988880002', 'sim');   // antes da proposta
    await pause();
    const p = await propose(w, s, await play(w));
    expect((await confirm(w, p.proposal_id, early.message_id)).code).toBe('CONFIRMATION_NOT_AFTER_PROPOSAL');
    await pause();
    for (const t of ['talvez', 'sim, mas troca para 17h', 'pode ser outro dia?', 'não']) {
      const m = await say(w, s.conversation, '85988880002', t);
      expect((await confirm(w, p.proposal_id, m.message_id)).code).toBe('NOT_EXPLICIT');
    }
    expect((await reservations(w)).length).toBe(0);
    expect((await q<any>(w.db, `select status from public.conv_booking_proposals`))[0].status).toBe('open');
  }, 60000);

  it('confirmação de outra pessoa não vale; de administrador vale e fica registrada', async () => {
    const w = await world();
    await enable(w);
    const s = await session(w, '85988880002', 'Ana');
    const p = await propose(w, s, await play(w));
    await pause();
    // em conversa direta a mensagem é do próprio contato; simulamos outra pessoa na mesma conversa de grupo
    const g = '120363025246125486@g.us';
    await svc(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `GSEED${++n}`, chat_kind: 'group', group_jid: g, phone: '5585988880003', name: 'Beto', body: 'oi' })})`);
    const [grp] = await q<any>(w.db, `select id from public.conv_groups`);
    await rpc(w.db, U.admin, `public.conv_set_group('${grp.id}', 'allowed', false)`);
    // proposta em sessão de grupo
    await rpc(w.db, U.admin, `public.conv_save_channel('${key()}', ${j({ bot_phone: '5585988880099' })})`);
    await rpc(w.db, U.admin, `public.conv_set_mention_verified(true)`);
    await rpc(w.db, U.admin, `public.conv_set_ai_channel(true, true)`);
    await rpc(w.db, U.admin, `public.conv_set_group('${grp.id}', 'allowed', true)`);
    const gm = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `GM${++n}`, chat_kind: 'group', group_jid: g, phone: '5585988880002', name: 'Ana', body: 'quero quadra', mention: { direct: true, evidence: 'x' } })})`);
    const gt = await svc<any>(w.db, `public.conv_svc_ai_trigger('${gm.message_id}')`);
    const gp = await propose(w, { session: gt.session_id }, await play(w, 4));
    expect(gp.ok).toBe(true);
    await pause();
    const beto = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `GB${++n}`, chat_kind: 'group', group_jid: g, phone: '5585988880003', name: 'Beto', body: 'sim' })})`);
    const denied = await confirm(w, gp.proposal_id, beto.message_id);
    expect([denied.ok, denied.code]).toEqual([false, 'NOT_AUTHORIZED_TO_CONFIRM']);
    expect((await reservations(w)).length).toBe(0);
    const adm = await svc<any>(w.db, `public.conv_svc_ingest_message(${j({ provider_id: `GA${++n}`, chat_kind: 'group', group_jid: g, phone: '5585988880001', name: 'Admin', body: 'sim, pode confirmar' })})`);
    const ok = await confirm(w, gp.proposal_id, adm.message_id);
    expect(ok.ok).toBe(true);
    expect((await reservations(w)).length).toBe(1);
    expect((await reservations(w))[0].creator_id).toBe(U.socioA);   // continua sendo a reserva de quem pediu
    const [a] = await q<any>(w.db, `select metadata from public.admin_audit_logs where action = 'conv.ai_reservation_created'`);
    expect(a.metadata.confirmed_by_admin).toBe(true);
    expect(a.metadata.group_id).toBe(grp.id);
    void p;
  }, 90000);

  it('disponibilidade é revalidada na gravação: se o horário foi ocupado depois da proposta, nada é criado e ninguém ouve "reservado"', async () => {
    const w = await world();
    await enable(w);
    const s = await session(w, '85988880002', 'Ana');
    const cfg = await play(w);
    const p = await propose(w, s, cfg);
    await w.db.exec(`insert into public.reservations(court_id, creator_id, date, start_time, end_time, type, participant_ids)
      values ('${w.court1}', '${U.socioB}', '${cfg.date}', '16:00', '17:00', 'Play', '{}')`);
    await pause();
    const yes = await say(w, s.conversation, '85988880002', 'sim');
    const c = await confirm(w, p.proposal_id, yes.message_id);
    expect([c.ok, c.code]).toEqual([false, 'SLOT_TAKEN']);
    expect((await reservations(w)).length).toBe(1);   // só a que já existia
    expect((await q<any>(w.db, `select status, failure_code, reservation_id from public.conv_booking_proposals`))[0]).toEqual({ status: 'failed', failure_code: 'SLOT_TAKEN', reservation_id: null });
    // e a proposta falha não vira reserva numa nova tentativa
    expect((await confirm(w, p.proposal_id, yes.message_id)).code).toBe('PROPOSAL_CLOSED');
  }, 60000);

  it('dois pedidos para o mesmo horário: o primeiro "sim" ocupa, o segundo é recusado', async () => {
    const w = await world();
    await enable(w);
    const a = await session(w, '85988880002', 'Ana');
    const b = await session(w, '85988880003', 'Beto');
    const cfg = await play(w, 3, '18:00', { participant_ids: [] });
    const pa = await propose(w, a, cfg), pb = await propose(w, b, cfg);
    expect([pa.ok, pb.ok]).toEqual([true, true]);        // na hora de propor, estava livre para os dois
    await pause();
    const ya = await say(w, a.conversation, '85988880002', 'sim'), yb = await say(w, b.conversation, '85988880003', 'sim');
    expect((await confirm(w, pa.proposal_id, ya.message_id)).ok).toBe(true);
    expect((await confirm(w, pb.proposal_id, yb.message_id)).code).toBe('SLOT_TAKEN');
    expect((await reservations(w)).length).toBe(1);
  }, 60000);

  it('proposta vencida, telefone sem cadastro e sócio inativo não geram reserva', async () => {
    const w = await world();
    await enable(w);
    const s = await session(w, '85988880002', 'Ana');
    const p = await propose(w, s, await play(w));
    await w.db.exec(`update public.conv_booking_proposals set expires_at = now() - interval '1 minute'`);
    await pause();
    const yes = await say(w, s.conversation, '85988880002', 'sim');
    expect((await confirm(w, p.proposal_id, yes.message_id)).code).toBe('PROPOSAL_EXPIRED');
    // telefone que não é de nenhum sócio
    const stranger = await session(w, '5511912345678', 'Estranho');
    const sp = await propose(w, stranger, await play(w));
    expect([sp.ok, sp.code]).toEqual([false, 'REQUESTER_NOT_IDENTIFIED']);
    // sócio desativado
    await w.db.exec(`update public.profiles set is_active = false where id = '${U.socioA}'`);
    const inactive = await propose(w, s, await play(w));
    expect([inactive.ok, inactive.code]).toEqual([false, 'REQUESTER_NOT_MEMBER']);
    expect((await reservations(w)).length).toBe(0);
  }, 60000);

  it('cancelar: só a própria reserva (ou admin), futura, e só depois de confirmação', async () => {
    const w = await world();
    await enable(w);
    const s = await session(w, '85988880002', 'Ana');
    const cfg = await play(w);
    const p = await propose(w, s, cfg);
    await pause();
    await confirm(w, p.proposal_id, (await say(w, s.conversation, '85988880002', 'sim')).message_id);
    const [res] = await reservations(w);
    const cp = await propose(w, s, { action: 'cancel', reservation_id: res.id });
    expect(cp.ok).toBe(true);
    expect((await reservations(w))[0].status).toBe('active');              // proposta ≠ cancelamento
    await pause();
    const c = await confirm(w, cp.proposal_id, (await say(w, s.conversation, '85988880002', 'confirmo')).message_id);
    expect(c.ok).toBe(true);
    expect((await reservations(w))[0].status).toBe('cancelled');
    // reserva de outra pessoa
    await w.db.exec(`insert into public.reservations(id, court_id, creator_id, date, start_time, end_time, type, participant_ids)
      values ('${ID(950)}', '${w.court2}', '${U.socioB}', '${cfg.date}', '10:00', '11:00', 'Play', '{}')`);
    const other = await propose(w, s, { action: 'cancel', reservation_id: ID(950) });
    expect([other.ok, other.code]).toEqual([false, 'NOT_YOUR_RESERVATION']);
    // reserva de campeonato só a equipe altera
    await w.db.exec(`insert into public.reservations(id, court_id, creator_id, date, start_time, end_time, type, participant_ids)
      values ('${ID(951)}', '${w.court2}', '${U.socioA}', '${cfg.date}', '12:00', '13:00', 'Campeonato', '{}')`);
    expect((await propose(w, s, { action: 'cancel', reservation_id: ID(951) })).code).toBe('NEEDS_HUMAN');
  }, 60000);

  it('remarcar: troca atômica (nova reserva + antiga cancelada), sem conflito com a própria reserva', async () => {
    const w = await world();
    await enable(w);
    const s = await session(w, '85988880002', 'Ana');
    const cfg = await play(w, 3, '16:00');
    const p = await propose(w, s, cfg);
    await pause();
    await confirm(w, p.proposal_id, (await say(w, s.conversation, '85988880002', 'sim')).message_id);
    const [old] = await reservations(w);
    // 16:30 sobrepõe a própria reserva (16:00–17:00): deve poder, porque ela sai
    const rp = await propose(w, s, { action: 'reschedule', reservation_id: old.id, date: cfg.date, start: '16:30' });
    expect(rp.ok).toBe(true);
    expect(rp.summary).toMatchObject({ start: '16:30', end: '17:30', court_id: w.court1 });
    await pause();
    const c = await confirm(w, rp.proposal_id, (await say(w, s.conversation, '85988880002', 'pode marcar')).message_id);
    expect(c.ok).toBe(true);
    const all = await reservations(w);
    expect(all.length).toBe(2);
    expect(all.filter((r: any) => r.status === 'active').length).toBe(1);
    expect(all.find((r: any) => r.id === old.id).status).toBe('cancelled');
    expect(all.find((r: any) => r.status === 'active').participant_ids.sort()).toEqual([U.socioA, U.socioB].sort());   // mantém os participantes
  }, 90000);

  it('resolução de pessoas: único, ambíguo e inexistente; quadras por tipo', async () => {
    const w = await world();
    await w.db.exec(`insert into auth.users(id) values ('${ID(60)}'), ('${ID(61)}');
      insert into public.profiles(id, name, role, is_active) values ('${ID(60)}', 'João Silva', 'socio', true), ('${ID(61)}', 'João Pereira', 'socio', true)`);
    const r = await svc<any[]>(w.db, `public.conv_svc_ai_resolve_people(array['João', 'João Silva', 'Ana Sócia', 'Zé Ninguém', 'Beto'], 'member')`);
    expect(r.map((x) => x.status)).toEqual(['ambiguous', 'unique', 'unique', 'none', 'unique']);
    expect(r[0].matches.length).toBe(2);
    expect(JSON.stringify(r)).not.toContain('phone');
    // alunos: sócio com perfil de aluno ativo e não-sócio; professores pelo cadastro de professores
    await w.db.exec(`insert into public.student_profiles(profile_id, student_status) values ('${U.socioB}', 'active');
      insert into public.non_socio_students(id, name, plan_type, plan_status) values ('${ID(770)}', 'Carla Aluna', 'Day Card', 'active')`);
    const st = await svc<any[]>(w.db, `public.conv_svc_ai_resolve_people(array['Beto', 'Carla', 'Ana Sócia'], 'student')`);
    expect(st.map((x) => [x.status, x.matches[0]?.kind])).toEqual([['unique', 'socio'], ['unique', 'non_socio'], ['none', undefined]]);   // Ana não é aluna
    const pf = await svc<any[]>(w.db, `public.conv_svc_ai_resolve_people(array['Paulo'], 'professor')`);
    expect([pf[0].status, pf[0].matches[0].id]).toEqual(['unique', w.professor]);
    await svc(w.db, `public.conv_svc_ai_cancel_proposal('${ID(1)}')`);   // sem proposta aberta: não faz nada
    const courts = await svc<any[]>(w.db, `public.conv_svc_ai_find_courts('saibro')`);
    expect(courts.map((c) => c.name)).toEqual(['Quadra 1', 'Quadra 2']);
    expect((await svc<any[]>(w.db, `public.conv_svc_ai_find_courts('rápida')`)).map((c) => c.name)).toEqual(['Quadra Rápida']);
  }, 60000);
});
