// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asUser, asUserError, j, key, q, rpc, U, world } from './harness';
import { EXPECTED, FX, fixtureSql } from '../fixtures/studentsAndGuests';

type W = Awaited<ReturnType<typeof world>>;
const withFixture = async () => {
  const w = await world();
  await w.db.exec(fixtureSql({ p1: U.prof, p2: U.profOther }));
  return w;
};
const rows = (w: W, uid = U.admin) => asUser<any>(w.db, uid, `select reservation_id, occurred_on::text d, guest_name, booked_by, exempt, charged_cents::text c from public.fin_day_card_rows('2026-08-01', '2026-08-31') order by occurred_on`);

describe('Day Card = taxa do convidado de um sócio (derivada da reserva com convidado)', () => {
  it('só reserva com convidado gera Day Card; isenta vale R$ 0; cancelada, amistoso comum e AULA ficam de fora', async () => {
    const w = await withFixture();
    const r = await rows(w);
    expect(r.map((x) => [x.d, x.guest_name, x.exempt, x.c])).toEqual([
      ['2026-08-07', 'Convidado Fulano', false, '5000'],
      ['2026-08-08', 'Convidado Isento', true, '0'],
    ]);
    expect(r.reduce((s, x) => s + Number(x.c), 0)).toBe(EXPECTED.dayCardTotal);
    // aulas de aluno (inclusive com Card Mensal ou Aula avulsa paga) nunca viram Day Card
    expect(r.some((x) => [FX.reservations.aulaDoisAlunos, FX.reservations.aulaLegado, FX.reservations.aulaParticipantsLegado].includes(x.reservation_id))).toBe(false);
  }, 60000);

  it('o valor do Day Card vem da configuração e é editável; não mexe nos pagamentos dos alunos', async () => {
    const w = await withFixture();
    expect((await q<any>(w.db, `select day_card_price_cents::text p from public.fin_settings`))[0].p).toBe('5000'); // o valor que o app já usava
    await rpc(w.db, U.admin, `public.fin_save_settings('${key()}', 1, ${j({ day_card_price_cents: 6000 })})`);
    const r = await rows(w);
    expect(r.find((x) => !x.exempt)!.c).toBe('6000');
    const lines = await asUser<any>(w.db, U.admin, `select name, amount_cents::text a from public.fin_dre_lines('2026-08-01','2026-08-31') where period = 'current'`);
    const by = Object.fromEntries(lines.map((l) => [l.name, Number(l.a)]));
    expect(by['Day Card (convidados)']).toBe(6000);
    expect(by['Card Mensal (alunos)']).toBe(EXPECTED.cardMensalTotal);
    expect(by['Aula avulsa (alunos)']).toBe(EXPECTED.aulaAvulsaTotal);
  }, 60000);

  it('quem reservou aparece como "reserva de" (informação, não cobrança)', async () => {
    const w = await withFixture();
    await w.db.exec(`update public.reservations set creator_id = '${U.socioA}' where id = '${FX.reservations.amistosoConvidado}'`);
    expect((await rows(w)).find((x) => x.guest_name === 'Convidado Fulano')!.booked_by).toBe('Ana Sócia');
  }, 60000);

  it('só o administrador lê; sócio, professor, lanchonete e anônimo não', async () => {
    const w = await withFixture();
    for (const uid of [U.socioA, U.prof, U.lanch]) {
      expect(await asUserError(w.db, uid, `select * from public.fin_day_card_rows('2026-08-01','2026-08-31')`), uid).toMatch(/FINANCE_FORBIDDEN/);
    }
    expect(await asUserError(w.db, null, `select * from public.fin_day_card_rows('2026-08-01','2026-08-31')`)).toMatch(/permission denied/);
    expect(await asUserError(w.db, U.admin, `select * from public.fin_day_card_rows('2026-08-31','2026-08-01')`)).toMatch(/INVALID_PERIOD/);
  }, 60000);
});

describe('Aula avulsa e Card Mensal = pagamentos do aluno ao clube; professor fica fora do financeiro', () => {
  it('o plano "Day Card" do aluno no app (pagamento de um dia) é Aula avulsa no financeiro; validade além do dia é Card Mensal', async () => {
    const w = await withFixture();
    const d = await asUser<any>(w.db, U.admin, `select source_type, description, amount_cents::text a from public.fin_student_revenue('2026-08-01','2026-08-31') order by occurred_on, description`);
    expect(d.map((x) => [x.source_type, x.description, Number(x.a)])).toEqual([
      ['student_payment', 'Card Mensal — Aluno Card Mensal', 20000],
      ['student_payment', 'Aula avulsa — Aluno Day Card', 5000],
      ['day_card', 'Day Card — Convidado Fulano', 5000],
      ['student_payment', 'Card Mensal — Aluno Experimental', 20000],
    ]);
  }, 60000);

  it('o financeiro não tem tabela, função nem categoria de repasse a professor', async () => {
    const w = await withFixture();
    expect((await q<any>(w.db, `select count(*)::int n from pg_tables where schemaname = 'public' and tablename like 'fin\\_%' and (tablename like '%professor%' or tablename like '%lesson%')`))[0].n).toBe(0);
    expect((await q<any>(w.db, `select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','fin_private') and (p.proname like '%professor%' or p.proname like '%lesson%')`))[0].n).toBe(0);
  }, 60000);
});

describe('os fluxos existentes continuam funcionando (sem FK financeira em reserva/aluno/pagamento)', () => {
  it('reserva, pagamento e aluno ainda podem ser excluídos; professor também (o financeiro não o referencia)', async () => {
    const w = await withFixture();
    await w.db.exec(`delete from public.student_payments where id = '${FX.payments.dayCard}'`);
    await w.db.exec(`delete from public.reservations where id = '${FX.reservations.amistosoConvidado}'`);
    await w.db.exec(`delete from public.non_socio_students where id = '${FX.students.dependent}'`);
    // professor: só as reservas do STC o referenciam (a linha legada da fixture precisa do `replica` por causa do gatilho genérico de auditoria do STC)
    await w.db.exec(`set session_replication_role = replica; update public.reservations set professor_id = null where professor_id = '${FX.prof.p2}'; reset session_replication_role;`);
    await w.db.exec(`delete from public.professors where id = '${FX.prof.p2}'`);
    expect((await rows(w)).map((x) => x.guest_name)).toEqual(['Convidado Isento']);
  }, 60000);

  it('o pagamento de aluno ganha trilha de auditoria sem mudar o comportamento (e a falha da auditoria nunca o bloqueia)', async () => {
    const w = await withFixture();
    await w.db.exec(`insert into public.student_payments(student_id, amount, valid_until) values ('${FX.students.dayCard}', 50, now())`);
    await w.db.exec(`update public.student_payments set status = 'cancelled', cancelled_reason = 'x' where id = '${FX.payments.dayCard}'`);
    await w.db.exec(`delete from public.student_payments where id = '${FX.payments.cardMensal}'`);
    const audit = await q<any>(w.db, `select action, record_id, old_data is not null as has_old, new_data is not null as has_new, metadata
      from public.admin_audit_logs where table_name = 'student_payments' order by occurred_at, id`);
    expect(audit.map((a) => a.metadata.op)).toEqual(['insert', 'update', 'delete']);
    expect(audit[2]).toMatchObject({ has_old: true, has_new: false });
    // auditoria quebrada → o pagamento de aluno continua sendo gravado
    await w.db.exec(`alter table public.admin_audit_logs rename to admin_audit_logs_off`);
    await w.db.exec(`insert into public.student_payments(student_id, amount, valid_until) values ('${FX.students.dayCard}', 50, now())`);
    expect((await q<any>(w.db, `select count(*)::int n from public.student_payments where student_id = '${FX.students.dayCard}'`))[0].n).toBeGreaterThan(1);
  }, 60000);
});
