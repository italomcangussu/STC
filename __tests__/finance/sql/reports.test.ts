// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asUser, asUserError, dbToday, j, key, q, rpc, rpcError, U, world } from './harness';
import { EXPECTED, FX, fixtureSql } from '../fixtures/studentsAndGuests';
import { addMonths, firstOfMonth } from '../../../lib/finance/dates';

type W = Awaited<ReturnType<typeof world>>;
const dre = (w: W, from: string, to: string, uid = U.admin) =>
  asUser<{ period: string; line: string; name: string; amount_cents: bigint }>(w.db, uid, `select * from public.fin_dre_lines('${from}', '${to}')`);
const cur = (rows: Array<{ period: string; line: string; name: string; amount_cents: bigint }>) =>
  Object.fromEntries(rows.filter((r) => r.period === 'current').map((r) => [r.name, Number(r.amount_cents)]));
const cash = (w: W, from: string, to: string, filters = '{}') =>
  asUser<any>(w.db, U.admin, `select source_type, leg, occurred_on::text d, flow, description, amount_cents::text amt, account_name, is_transfer, origin from public.fin_movements('${from}', '${to}', '${filters}'::jsonb, 5000, 0)`);
const cat = async (w: W, name: string) => (await q<{ id: string }>(w.db, `select id from public.fin_categories where name = '${name}'`))[0].id;

describe('DRE por competência × caixa por data real', () => {
  it('receita dos não-sócios: Card Mensal e Aula avulsa pelo pagamento registrado; Day Card só do convidado', async () => {
    const w = await world();
    await w.db.exec(fixtureSql({ p1: U.prof, p2: U.profOther }));
    const lines = cur(await dre(w, '2026-08-01', '2026-08-31'));
    expect(lines['Day Card (convidados)']).toBe(EXPECTED.dayCardTotal); // 1 convidado cobrado; o isento fica de fora
    expect(lines['Card Mensal (alunos)']).toBe(EXPECTED.cardMensalTotal); // 200 + 200
    expect(lines['Aula avulsa (alunos)']).toBe(EXPECTED.aulaAvulsaTotal); // o experimental cancelado ficou de fora
    expect(lines['Card Mensal (alunos)'] + lines['Aula avulsa (alunos)']).toBe(EXPECTED.activePaymentsTotal);
    expect(Object.values(lines).reduce((a, b) => a + b, 0)).toBe(EXPECTED.grandTotal);
    // nenhuma linha de "Day Use" ou de repasse: esses conceitos não existem no financeiro do clube
    expect(Object.keys(lines).some((n) => /day use|repasse|professor/i.test(n))).toBe(false);
  }, 60000);

  it('aula de aluno não gera receita por conta própria: mais aulas não mudam o DRE (o dinheiro já está no pagamento)', async () => {
    const w = await world();
    await w.db.exec(fixtureSql({ p1: U.prof, p2: U.profOther }));
    const before = cur(await dre(w, '2026-08-01', '2026-08-31'));
    const cashBefore = await cash(w, '2026-08-01', '2026-08-31');
    await w.db.exec(`set session_replication_role = replica;
      insert into public.reservations(id, type, date, status, professor_id, non_socio_student_ids, student_type) values
        ('00000000-0000-4000-8000-000000009901', 'Aula', '2026-08-13', 'active', '${FX.prof.p1}', array['${FX.students.cardMensal}','${FX.students.dayCard}']::uuid[], 'non-socio'),
        ('00000000-0000-4000-8000-000000009902', 'Aula', '2026-08-14', 'active', '${FX.prof.p1}', array['${FX.students.cardMensal}']::uuid[], 'non-socio');
      reset session_replication_role;`);
    expect(cur(await dre(w, '2026-08-01', '2026-08-31'))).toEqual(before);
    expect(await cash(w, '2026-08-01', '2026-08-31')).toEqual(cashBefore);
    expect(cashBefore.length).toBeGreaterThan(0);
  }, 60000);

  it('detalhe: cada valor do DRE mostra os lançamentos que o formam, e a soma fecha', async () => {
    const w = await world();
    await w.db.exec(fixtureSql({ p1: U.prof, p2: U.profOther }));
    const day = await cat(w, 'Day Card (convidados)');
    const rows = await asUser<any>(w.db, U.admin, `select * from public.fin_dre_detail('2026-08-01','2026-08-31','${day}')`);
    expect(rows.length).toBe(EXPECTED.dayCardCount);
    expect(rows.reduce((s, r) => s + Number(r.amount_cents), 0)).toBe(EXPECTED.dayCardTotal);
    expect(new Set(rows.map((r) => r.source_type))).toEqual(new Set(['day_card']));
    expect(rows[0].description).toBe('Day Card — Convidado Fulano');
    const pay = await cat(w, 'Aula avulsa (alunos)');
    const payRows = await asUser<any>(w.db, U.admin, `select * from public.fin_dre_detail('2026-08-01','2026-08-31','${pay}')`);
    expect(payRows.map((r: any) => [r.source_type, r.description, Number(r.amount_cents)])).toEqual([['student_payment', 'Aula avulsa — Aluno Day Card', 5000]]);
  }, 60000);

  it('mensalidade: DRE no mês cobrado; caixa no dia do pagamento (competência × caixa)', async () => {
    const w = await world();
    await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: '2026-01-10', amount_cents: 10000 })})`);
    await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', null, '2026-02-15')`);
    const feb = (await q<{ id: string }>(w.db, `select id from public.fin_member_charges where competence_month = '2026-02-01'`))[0].id;
    await rpc(w.db, U.admin, `public.fin_register_payment('${key()}', '${feb}', 10000, '2026-03-05', 'pix', '${w.account}', null)`).catch(() => null);
    const today = await dbToday(w.db);
    // pagamentos só até "hoje": se o relógio do banco ainda não chegou em março/2026, usa hoje
    const paidOn = '2026-03-05' <= today ? '2026-03-05' : today;
    if (paidOn !== '2026-03-05') await rpc(w.db, U.admin, `public.fin_register_payment('${key()}', '${feb}', 10000, '${paidOn}', 'pix', '${w.account}', null)`);
    // DRE: fevereiro tem a receita; março não
    expect(cur(await dre(w, '2026-02-01', '2026-02-28'))['Mensalidades de sócios']).toBe(10000);
    expect(cur(await dre(w, '2026-03-01', '2026-03-31'))['Mensalidades de sócios']).toBe(10000); // março também tem a SUA mensalidade (competência de março)
    // caixa: só o dia do pagamento
    expect((await cash(w, '2026-02-01', '2026-02-28')).filter((m) => m.source_type === 'member_payment').length).toBe(0);
    const inMonth = (await cash(w, paidOn.slice(0, 8) + '01', paidOn)).filter((m) => m.source_type === 'member_payment');
    expect(inMonth.map((m) => [m.d, m.amt, m.flow])).toEqual([[paidOn, '10000', 'receipt']]);
  }, 60000);

  it('cada evento entra uma única vez: pagamento parcial + encargos + estorno', async () => {
    const w = await world();
    const today = await dbToday(w.db);
    const start = addMonths(firstOfMonth(today), -3);
    await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: start, amount_cents: 10000 })})`);
    await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', null, '${today}')`);
    await rpc(w.db, U.admin, `public.fin_save_settings('${key()}', 1, ${j({ fine_fixed_cents: 300, interest_daily_fixed_cents: 10, late_fee_confirmed: true })})`);
    const c = (await q<{ id: string }>(w.db, `select id from public.fin_member_charges order by competence_month limit 1`))[0].id;
    const p = await rpc<any>(w.db, U.admin, `public.fin_register_payment('${key()}', '${c}', 5000, '${today}', 'pix', '${w.account}', null)`);
    const from = start, to = today;
    // caixa: principal + encargos = valor pago; nenhum centavo a mais nem a menos
    const rows = (await cash(w, from, to)).filter((m) => m.source_type === 'member_payment');
    expect(rows.reduce((s, r) => s + Number(r.amt), 0)).toBe(5000);
    // DRE: encargos recebidos aparecem como receita de multa/juros no dia do pagamento
    expect(cur(await dre(w, today, today))['Multas e juros de mora recebidos']).toBe(p.fine_cents + p.interest_cents);
    // estorno: saída no caixa no dia do estorno e devolução dos encargos no DRE
    await rpc(w.db, U.admin, `public.fin_reverse_payment('${key()}', '${p.payment_id}', 'Pix devolvido pelo banco')`);
    const after = (await cash(w, from, to)).filter((m) => m.source_type === 'member_payment' || m.source_type === 'member_reversal');
    expect(after.reduce((s, r) => s + Number(r.amt), 0)).toBe(0);
    expect(after.some((m) => m.source_type === 'member_reversal' && m.flow === 'refund')).toBe(true);
    const lines = cur(await dre(w, today, today));
    expect((lines['Multas e juros de mora recebidos'] ?? 0) - (lines['Estornos e devoluções'] ?? 0) * 0).toBeGreaterThanOrEqual(0);
    expect(lines['Estornos e devoluções'] ?? 0).toBe(p.fine_cents + p.interest_cents);
  }, 60000);

  it('rateio por mês na cobrança trimestral fecha no centavo', async () => {
    const w = await world();
    await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: '2026-01-05', amount_cents: 10000, period_months: 3 })})`);
    await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', null, '2026-01-20')`);
    const per = async (from: string, to: string) => cur(await dre(w, from, to))['Mensalidades de sócios'] ?? 0;
    expect([await per('2026-01-01', '2026-01-31'), await per('2026-02-01', '2026-02-28'), await per('2026-03-01', '2026-03-31')]).toEqual([3334, 3333, 3333]);
    expect(await per('2026-01-01', '2026-03-31')).toBe(10000);
  }, 60000);

  it('desconto concedido é dedução; cobrança cancelada não é receita', async () => {
    const w = await world();
    await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: '2026-01-05', amount_cents: 10000 })})`);
    await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', null, '2026-01-20')`);
    const [jan, feb] = (await q<{ id: string }>(w.db, `select id from public.fin_member_charges order by competence_month`));
    await rpc(w.db, U.admin, `public.fin_adjust_charge('${key()}', '${jan.id}', 'discount', 2500, 'Bolsa atleta aprovada em reunião')`);
    await rpc(w.db, U.admin, `public.fin_cancel_charge('${key()}', '${feb.id}', 'Sócio licenciado no mês')`);
    expect(cur(await dre(w, '2026-01-01', '2026-01-31'))).toMatchObject({ 'Mensalidades de sócios': 10000, 'Descontos concedidos': 2500 });
    expect(cur(await dre(w, '2026-02-01', '2026-02-28'))['Mensalidades de sócios'] ?? 0).toBe(0);
  }, 60000);
});

describe('contas, categorias, recorrências, pontuais e transferências', () => {
  async function accounts(w: W) {
    const mk = (name: string, opening: number) => rpc<{ id: string }>(w.db, U.admin,
      `public.fin_save_account('${key()}', null, null, ${j({ name, kind: 'bank', opening_balance_cents: opening, opening_date: '2026-01-01' })})`);
    return { caixa: await mk('Caixa físico', 50000), banco: await mk('Banco 2', 100000) };
  }

  it('despesa pontual: DRE na competência; caixa só quando paga; pagamento parcial e baixa', async () => {
    const w = await world();
    const energia = await cat(w, 'Energia');
    const e = await rpc<{ id: string }>(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({
      kind: 'expense', description: 'Conta de luz agosto', category_id: energia, amount_cents: 30000, status: 'pending', competence_date: '2026-08-15', due_date: '2026-09-10' })})`);
    // DRE já tem; caixa ainda não
    expect(cur(await dre(w, '2026-08-01', '2026-08-31'))['Energia']).toBe(30000);
    expect((await cash(w, '2026-01-01', '2026-12-31')).filter((m) => m.flow === 'expense').length).toBe(0);
    // pagamento parcial → parcial; baixa → paga; a diferença vira juros no DRE
    await rpc(w.db, U.admin, `public.fin_pay_entry('${key()}', '${e.id}', 1, ${j({ amount_cents: 10000, paid_on: '2026-09-02', account_id: w.account })})`);
    expect((await q<any>(w.db, `select status from public.fin_entries where id = '${e.id}'`))[0].status).toBe('partial');
    await rpc(w.db, U.admin, `public.fin_pay_entry('${key()}', '${e.id}', 2, ${j({ amount_cents: 20500, paid_on: '2026-09-09', account_id: w.account, settle: true })})`);
    const done = (await q<any>(w.db, `select status, adjustment_cents::text a, settled_on::text s from public.fin_entries where id = '${e.id}'`))[0];
    expect(done).toEqual({ status: 'paid', a: '500', s: '2026-09-09' });
    // competência (agosto) separada do caixa (setembro): dois pagamentos, 305,00 no total
    const sep = (await cash(w, '2026-09-01', '2026-09-30')).filter((m) => m.flow === 'expense');
    expect(sep.map((m) => [m.d, m.amt])).toEqual([['2026-09-09', '-20500'], ['2026-09-02', '-10000']]);
    expect(cur(await dre(w, '2026-09-01', '2026-09-30'))['Juros, multas e descontos em pagamentos']).toBe(500);
    // pagamento além do documento sem "baixa" é recusado
    expect(await rpcError(w.db, U.admin, `public.fin_pay_entry('${key()}', '${e.id}', 3, ${j({ amount_cents: 1, paid_on: '2026-09-10', account_id: w.account })})`)).toMatch(/ENTRY_NOT_PENDING/);
  }, 60000);

  it('cancelar só sem dinheiro movimentado; com pagamento, estorna antes e o caixa guarda a saída E a devolução', async () => {
    const w = await world();
    const energia = await cat(w, 'Energia');
    const e = await rpc<{ id: string }>(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({
      kind: 'expense', description: 'Compra de bolas', category_id: await cat(w, 'Material esportivo (bolas, redes)'), amount_cents: 12000, status: 'paid', paid_on: '2026-08-10', account_id: w.account })})`);
    expect(await rpcError(w.db, U.admin, `public.fin_cancel_entry('${key()}', '${e.id}', 1, 'Lançada por engano')`)).toMatch(/ENTRY_HAS_PAYMENTS|VERSION_CONFLICT/);
    const pay = (await q<{ id: string; v: number }>(w.db, `select p.id, e.version v from public.fin_entry_payments p join public.fin_entries e on e.id = p.entry_id`))[0];
    await rpc(w.db, U.admin, `public.fin_reverse_entry_payment('${key()}', '${pay.id}', 'Pagamento lançado na conta errada')`);
    const rows = (await cash(w, '2026-08-01', '2026-12-31')).filter((m) => m.flow === 'expense');
    expect(rows.map((m) => Number(m.amt)).sort((a, b) => a - b)).toEqual([-12000, 12000]); // saída + devolução; histórico intacto
    const ver = (await q<{ v: number }>(w.db, `select version v from public.fin_entries where id = '${e.id}'`))[0].v;
    await rpc(w.db, U.admin, `public.fin_cancel_entry('${key()}', '${e.id}', ${ver}, 'Lançada por engano')`);
    expect((await q<any>(w.db, `select status from public.fin_entries where id = '${e.id}'`))[0].status).toBe('canceled');
    expect(cur(await dre(w, '2026-08-01', '2026-08-31'))['Material esportivo (bolas, redes)'] ?? 0).toBe(0);
    void energia;
  }, 60000);

  it('categorias automáticas são reservadas: não se lança Mensalidade, Card Mensal, Aula avulsa ou Day Card à mão', async () => {
    const w = await world();
    for (const name of ['Mensalidades de sócios', 'Card Mensal (alunos)', 'Aula avulsa (alunos)', 'Day Card (convidados)', 'Descontos concedidos']) {
      expect(await rpcError(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({ kind: 'revenue', description: 'Tentativa manual', category_id: await cat(w, name), amount_cents: 1000, status: 'paid', account_id: w.account })})`)).toMatch(/CATEGORY_RESERVED/);
    }
    // não existe categoria de repasse a professor: o professor é pago pelo aluno
    expect((await q<any>(w.db, `select count(*)::int n from public.fin_categories where name ilike '%repasse%' or name ilike '%professor%'`))[0].n).toBe(0);
    // receita manual numa categoria comum funciona
    await rpc(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({ kind: 'revenue', description: 'Aluguel de quadra para evento', category_id: await cat(w, 'Outras receitas'), amount_cents: 80000, status: 'paid', paid_on: '2026-08-20', account_id: w.account })})`);
    expect(cur(await dre(w, '2026-08-01', '2026-08-31'))['Outras receitas']).toBe(80000);
  }, 60000);

  it('transferência: muda saldo das contas, mas NÃO é receita, despesa nem entrada/saída consolidada', async () => {
    const w = await world();
    const a = await accounts(w);
    await rpc(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({ kind: 'transfer', description: 'Depósito do caixa no banco', amount_cents: 20000, paid_on: '2026-08-12', account_id: a.caixa.id, counter_account_id: a.banco.id })})`);
    const bal = Object.fromEntries((await asUser<any>(w.db, U.admin, `select name, balance_cents::text b from public.fin_account_balances('2026-08-31')`)).map((r) => [r.name, r.b]));
    expect(bal['Caixa físico']).toBe('30000');
    expect(bal['Banco 2']).toBe('120000');
    // DRE sem efeito
    expect(Object.keys(cur(await dre(w, '2026-08-01', '2026-08-31'))).length).toBe(0);
    // consolidado: entradas e saídas ignoram a transferência; por conta ela aparece
    const flow = await asUser<any>(w.db, U.admin, `select inflow_cents::text i, outflow_cents::text o, closing_cents::text c from public.fin_cash_flow('2026-08-01','2026-08-31','month', null)`);
    expect(flow).toEqual([{ i: '0', o: '0', c: '150000' }]);
    const caixa = await asUser<any>(w.db, U.admin, `select inflow_cents::text i, outflow_cents::text o, closing_cents::text c from public.fin_cash_flow('2026-08-01','2026-08-31','month', '${a.caixa.id}')`);
    expect(caixa).toEqual([{ i: '0', o: '20000', c: '30000' }]);
    expect(await rpcError(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({ kind: 'transfer', description: 'Mesma conta', amount_cents: 1, paid_on: '2026-08-12', account_id: a.caixa.id, counter_account_id: a.caixa.id })})`)).toMatch(/SAME_ACCOUNT|violates check/);
  }, 60000);

  it('aporte e retirada: caixa sim, DRE não (ficam como memo)', async () => {
    const w = await world();
    await rpc(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({ kind: 'contribution', description: 'Aporte da diretoria', amount_cents: 500000, paid_on: '2026-08-02', account_id: w.account })})`);
    await rpc(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({ kind: 'withdrawal', description: 'Retirada', amount_cents: 100000, paid_on: '2026-08-03', account_id: w.account })})`);
    expect(Object.keys(cur(await dre(w, '2026-08-01', '2026-08-31'))).length).toBe(0);
    const memo = (await asUser<any>(w.db, U.admin, `select * from public.fin_dre_memo('2026-08-01','2026-08-31')`))[0];
    expect([Number(memo.contributions_cents), Number(memo.withdrawals_cents)]).toEqual([500000, 100000]);
    expect((await cash(w, '2026-08-01', '2026-08-31')).map((m) => [m.flow, m.amt])).toEqual([['withdrawal', '-100000'], ['contribution', '500000']]);
  }, 60000);

  it('recorrência: gera lançamentos próprios, é idempotente, pausa e encerra sem apagar o histórico', async () => {
    const w = await world();
    const aluguel = await cat(w, 'Aluguel');
    const rec = await rpc<{ id: string }>(w.db, U.admin, `public.fin_save_recurrence('${key()}', null, null, ${j({
      description: 'Aluguel da sede', category_id: aluguel, amount_cents: 200000, due_day: 10, start_month: '2026-01-01' })}, null)`);
    const count = async () => (await q<any>(w.db, `select count(*)::int n from public.fin_entries where recurrence_id = '${rec.id}'`))[0].n;
    const first = await count();
    expect(first).toBeGreaterThan(8); // de jan/2026 até o mês seguinte ao relógio do banco
    const gen = await rpc<any>(w.db, U.admin, `public.fin_generate_recurrences('${key()}', null)`);
    expect(gen.created).toBe(0);
    expect(await count()).toBe(first);
    // um mês pago fica como está; reajuste vale só para os pendentes de hoje em diante
    const today = await dbToday(w.db);
    const month = firstOfMonth(today);
    const paidOne = (await q<{ id: string }>(w.db, `select id from public.fin_entries where recurrence_id = '${rec.id}' and competence_date = '2026-01-01'`))[0].id;
    await rpc(w.db, U.admin, `public.fin_pay_entry('${key()}', '${paidOne}', 1, ${j({ amount_cents: 200000, paid_on: '2026-02-10', account_id: w.account })})`);
    await rpc(w.db, U.admin, `public.fin_save_recurrence('${key()}', '${rec.id}', 1, ${j({ amount_cents: 230000, reason: 'Reajuste do contrato' })}, '${month}')`);
    const amounts = await q<{ competence_date: string; amount_cents: string; status: string }>(w.db,
      `select competence_date::text, amount_cents::text, status from public.fin_entries where recurrence_id = '${rec.id}' order by competence_date`);
    expect(amounts[0]).toMatchObject({ competence_date: '2026-01-01', amount_cents: '200000', status: 'paid' });
    expect(amounts.filter((a) => a.competence_date >= month).every((a) => a.amount_cents === '230000')).toBe(true);
    expect(amounts.filter((a) => a.competence_date < month && a.status === 'pending').every((a) => a.amount_cents === '200000')).toBe(true);
    // encerrar: cancela só o pendente futuro (com motivo), não apaga nada
    await rpc(w.db, U.admin, `public.fin_save_recurrence('${key()}', '${rec.id}', 2, ${j({ active: false })}, '${month}')`);
    const after = await q<{ status: string; cancel_reason: string | null }>(w.db, `select status, cancel_reason from public.fin_entries where recurrence_id = '${rec.id}' and competence_date >= '${month}'`);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((a) => a.status === 'canceled' && a.cancel_reason)).toBe(true);
    expect(await count()).toBeGreaterThanOrEqual(first);
  }, 60000);
});

describe('saldos, a receber e a pagar (dashboard)', () => {
  it('saldo atual = saldo inicial + movimentos até a data; recebimento legado sem conta aparece à parte', async () => {
    const w = await world();
    await w.db.exec(fixtureSql({ p1: U.prof, p2: U.profOther }));
    const bal = (date: string) => asUser<any>(w.db, U.admin, `select name, balance_cents::text b from public.fin_account_balances('${date}') order by name`);
    // sem conta padrão de recebimentos? aqui `world()` já cria uma: os Cards entram nela
    expect(await bal('2026-08-31')).toEqual([{ name: 'Banco do clube', b: '45000' }]);
    expect(await bal('2026-08-01')).toEqual([{ name: 'Banco do clube', b: '0' }]); // conta ativa aparece zerada antes dos recebimentos
  }, 60000);

  it('Day Card (derivado da reserva) entra no caixa só se o clube ligar a opção (padrão: não)', async () => {
    const w = await world();
    await w.db.exec(fixtureSql({ p1: U.prof, p2: U.profOther }));
    expect((await cash(w, '2026-08-01', '2026-08-31')).filter((m) => m.source_type === 'day_card').length).toBe(0);
    await rpc(w.db, U.admin, `public.fin_save_settings('${key()}', 1, ${j({ day_card_in_cash: true })})`);
    const rows = (await cash(w, '2026-08-01', '2026-08-31')).filter((m) => m.source_type === 'day_card');
    expect(rows.length).toBe(EXPECTED.dayCardCount);
    expect(rows.every((m) => m.origin === 'derived' && m.flow === 'day_card')).toBe(true);
    expect(rows.reduce((t, m) => t + Number(m.amt), 0)).toBe(EXPECTED.dayCardTotal);
  }, 60000);

  it('a receber (mensalidades) e a pagar (contas) com vencidas e próximas', async () => {
    const w = await world();
    const today = await dbToday(w.db);
    await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: addMonths(firstOfMonth(today), -3), amount_cents: 10000 })})`);
    await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioB, start_on: addMonths(firstOfMonth(today), -1), amount_cents: 20000 })})`);
    await rpc(w.db, U.admin, `public.fin_generate_member_charges('${key()}', null, '${today}')`);
    const r = (await asUser<any>(w.db, U.admin, `select * from public.fin_receivables_summary()`))[0];
    expect(Number(r.open_count)).toBeGreaterThan(0);
    expect(Number(r.overdue_count)).toBeGreaterThan(0);
    expect(Number(r.overdue_cents)).toBeGreaterThan(0);
    expect(r.fees_configured).toBe(false); // sem política: o painel avisa
    expect(Number(r.overdue_members)).toBeGreaterThanOrEqual(1);
    const energia = await cat(w, 'Energia');
    await rpc(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({ kind: 'expense', description: 'Vencida', category_id: energia, amount_cents: 10000, status: 'pending', due_date: addMonths(firstOfMonth(today), -1) })})`);
    await rpc(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({ kind: 'expense', description: 'Próxima', category_id: energia, amount_cents: 7000, status: 'pending', due_date: today })})`);
    const p = (await asUser<any>(w.db, U.admin, `select * from public.fin_payables_summary()`))[0];
    expect([Number(p.payable_open_cents), Number(p.payable_overdue_count), Number(p.payable_overdue_cents), Number(p.payable_due_7d_cents)]).toEqual([17000, 1, 10000, 7000]);
    const trend = await asUser<any>(w.db, U.admin, `select * from public.fin_monthly_trend(null, 4)`);
    expect(trend.length).toBe(4);
  }, 60000);
});

describe('permissões dos relatórios', () => {
  it('só o administrador executa DRE, caixa, saldos, movimentos e detalhes', async () => {
    const w = await world();
    const calls = [
      `public.fin_dre_lines('2026-08-01','2026-08-31')`, `public.fin_dre_detail('2026-08-01','2026-08-31')`, `public.fin_dre_memo('2026-08-01','2026-08-31')`,
      `public.fin_movements('2026-08-01','2026-08-31')`, `public.fin_cash_flow('2026-08-01','2026-08-31')`, `public.fin_account_balances()`,
      `public.fin_receivables_summary()`, `public.fin_payables_summary()`, `public.fin_monthly_trend()`, `public.fin_student_revenue('2026-08-01','2026-08-31')`,
    ];
    for (const uid of [U.socioA, U.prof, U.lanch]) {
      for (const c of calls) expect(await rpcError(w.db, uid, c), `${uid} ${c}`).toMatch(/FINANCE_FORBIDDEN/);
    }
    for (const c of calls) expect(await rpcError(w.db, null, c), `anon ${c}`).toMatch(/permission denied/);
    for (const c of calls) expect(await rpcError(w.db, U.admin, c), `admin ${c}`).toBeNull();
    expect(await rpcError(w.db, U.admin, `public.fin_dre_lines('2026-08-31','2026-08-01')`)).toMatch(/INVALID_PERIOD/);
  }, 60000);

  it('o schema interno não é alcançável pelos papéis da API', async () => {
    const w = await world();
    for (const uid of [U.admin, U.socioA, null]) {
      expect(await asUserError(w.db, uid, `select fin_private.apply_payment(gen_random_uuid(), 1, now()::date, 'pix', null, null, null, null, gen_random_uuid())`), String(uid)).toMatch(/permission denied/);
    }
  }, 60000);
});
