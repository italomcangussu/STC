// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { asUser, asUserError, dbToday, ID, j, key, q, rpc, rpcError, U, world, SETTINGS_VERSION } from './harness';
import { buildCalendar, computeDueDate, nationalHolidays, optionalBankHolidays, type DueRule } from '../../../lib/finance/calendar';
import { addDays, addMonths, firstOfMonth } from '../../../lib/finance/dates';
import { computeStatement, type FeePolicy } from '../../../lib/finance/lateFees';
import { planCharges } from '../../../lib/finance/memberBilling';

type W = Awaited<ReturnType<typeof world>>;

const newPlan = (w: W, over: Record<string, unknown> = {}) =>
  rpc<{ id: string }>(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({
    profile_id: U.socioA, start_on: '2026-01-10', amount_cents: 10000, period_months: 1, ...over })})`);

const generate = (w: W, today: string, plan: string | null = null) =>
  rpc<{ created: number; existing: number; missing_price: number }>(w.db, U.admin,
    `public.fin_generate_member_charges('${key()}', ${plan ? `'${plan}'` : 'null'}, '${today}')`);

const charges = (w: W, planId?: string) =>
  q<{ id: string; competence_month: string; due_date: string; original_amount_cents: string; status: string }>(w.db,
    `select id, competence_month::text, due_date::text, original_amount_cents::text, status from public.fin_member_charges
     ${planId ? `where plan_id = '${planId}'` : ''} order by competence_month`);

const setPolicy = (w: W, data: Record<string, unknown>, version: number | string = SETTINGS_VERSION, reason?: string) =>
  rpc(w.db, U.admin, `public.fin_save_settings('${key()}', ${version}, ${j({ ...data, ...(reason ? { reason } : {}) })})`);

const pay = (w: W, charge: string, amount: number, paidOn: string, method = 'pix') =>
  rpc<any>(w.db, U.admin, `public.fin_register_payment('${key()}', '${charge}', ${amount}, '${paidOn}', '${method}', '${w.account}', null)`);

describe('calendário no banco = calendário no app', () => {
  it('feriados semeados batem com a lei, todos inativos (vencimento só pula fim de semana)', async () => {
    const w = await world();
    for (const year of [2024, 2026, 2030, 2036]) {
      const rows = await q<{ holiday_date: string; active: boolean }>(w.db,
        `select holiday_date::text, active from public.fin_holidays where extract(year from holiday_date) = ${year} and scope = 'national' order by 1`);
      const expected = [...nationalHolidays(year), ...optionalBankHolidays(year)].sort((a, b) => a.date.localeCompare(b.date));
      // as datas seguem a lei, mas NENHUM conta para o vencimento: o clube usa só fins de semana (o admin pode ativar)
      expect(rows.map((r) => [r.holiday_date, r.active])).toEqual(expected.map((h) => [h.date, false]));
    }
    // nenhum feriado estadual/municipal é presumido
    expect((await q(w.db, `select 1 from public.fin_holidays where scope <> 'national'`)).length).toBe(0);
  }, 60000);

  it('vencimento do banco é igual ao do TypeScript (meses, períodos, regras e feriados locais)', async () => {
    const w = await world();
    // feriado municipal fictício ativo, só para exercitar o caminho
    await rpc(w.db, U.admin, `public.fin_save_holiday('${key()}', null, ${j({ holiday_date: '2026-08-05', name: 'Feriado local de teste', scope: 'municipal' })})`);
    const hol = await q<{ holiday_date: string; active: boolean }>(w.db, `select holiday_date::text, active from public.fin_holidays`);
    const rules: DueRule[] = [
      { dueDay: 5, monthOffset: 1, nonBusinessRule: 'next_business_day' },
      { dueDay: 5, monthOffset: 1, nonBusinessRule: 'previous_business_day' },
      { dueDay: 31, monthOffset: 1, nonBusinessRule: 'keep' },
      { dueDay: 10, monthOffset: 0, nonBusinessRule: 'next_business_day' },
    ];
    for (const sat of [false, true]) {
      await rpc(w.db, U.admin, `public.fin_save_settings('${key()}', ${SETTINGS_VERSION}, ${j({ saturday_is_business: sat })})`);
      const cal = buildCalendar(hol.map((h) => ({ date: h.holiday_date, active: h.active })), sat);
      for (const rule of rules) {
        for (const period of [1, 3, 12]) {
          for (let m = 0; m < 24; m++) {
            const competence = addMonths('2026-01-01', m);
            const sql = (await q<{ d: string }>(w.db,
              `select fin_private.due_date('${competence}', ${period}, ${rule.dueDay}, ${rule.monthOffset}, '${rule.nonBusinessRule}')::text d`))[0].d;
            expect(sql, `${competence} p${period} ${JSON.stringify(rule)} sat=${sat}`).toBe(computeDueDate(competence, period, rule, cal).due);
          }
        }
      }
    }
  }, 120000);
});

describe('mensalidade individual e geração idempotente', () => {
  it('a chave que a tela usa para trazer o sócio do plano existe — e há outras duas para profiles (por isso precisa ser nomeada)', async () => {
    const w = await world();
    const src = await readFile(resolve(__dirname, '../../../lib/finance/financeApi.ts'), 'utf8');
    const fk = /PLAN_PROFILE_FK = '([^']+)'/.exec(src)?.[1];
    const rows = await q<{ conname: string; col: string }>(w.db,
      `select c.conname, a.attname col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       where c.conrelid = 'public.fin_member_plans'::regclass and c.contype = 'f' and c.confrelid = 'public.profiles'::regclass`);
    expect(rows.find((r) => r.conname === fk)?.col).toBe('profile_id');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('cria plano só para sócio ativo; sócio ≠ lanchonete; um plano vivo por sócio', async () => {
    const w = await world();
    await newPlan(w);
    expect(await rpcError(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioA, start_on: '2026-01-10', amount_cents: 9000 })})`)).toMatch(/PLAN_EXISTS/);
    expect(await rpcError(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.lanch, start_on: '2026-01-10', amount_cents: 9000 })})`)).toMatch(/NOT_A_MEMBER/);
    expect(await rpcError(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioB, start_on: '2026-01-10', amount_cents: 0 })})`)).toMatch(/INVALID_AMOUNT/);
    // cada sócio tem o seu valor: nenhum valor global
    await rpc(w.db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: U.socioB, start_on: '2026-01-10', amount_cents: 15000 })})`);
    const prices = await q<{ amount_cents: string }>(w.db, `select amount_cents::text from public.fin_member_plan_prices order by amount_cents`);
    expect(prices.map((p) => p.amount_cents)).toEqual(['10000', '15000']);
  }, 60000);

  it('gera as competências com vencimento dia 5 do mês cobrado (próximo dia útil) — igual ao TypeScript', async () => {
    const w = await world();
    const plan = await newPlan(w);
    const r = await generate(w, '2026-03-15'); // horizonte padrão: mês atual + 1 → jan..abr
    expect(r).toMatchObject({ created: 4, existing: 0, missing_price: 0 });
    const rows = await charges(w, plan.id);
    expect(rows.map((c) => [c.competence_month, c.due_date, c.original_amount_cents])).toEqual([
      ['2026-01-01', '2026-01-05', '10000'],
      ['2026-02-01', '2026-02-05', '10000'],
      ['2026-03-01', '2026-03-05', '10000'],
      ['2026-04-01', '2026-04-06', '10000'], // 5/4 é domingo
    ]);
    const hol = await q<{ holiday_date: string; active: boolean }>(w.db, `select holiday_date::text, active from public.fin_holidays`);
    const ts = planCharges(
      { id: plan.id, profileId: U.socioA, startOn: '2026-01-10', endedOn: null, status: 'active', periodMonths: 1 },
      [{ effectiveFrom: '2026-01-01', amountCents: 10000 }], [], '2026-04-01',
      { dueDay: 5, monthOffset: 0, nonBusinessRule: 'next_business_day' }, buildCalendar(hol.map((h) => ({ date: h.holiday_date, active: h.active }))));
    expect(ts.create.map((c) => [c.competenceMonth, c.dueDate])).toEqual(rows.map((c) => [c.competence_month, c.due_date]));
  }, 60000);

  it('repetir a geração não cria duplicata', async () => {
    const w = await world();
    await newPlan(w);
    await generate(w, '2026-03-15');
    const again = await generate(w, '2026-03-15');
    expect(again).toMatchObject({ created: 0, existing: 4 });
    expect((await charges(w)).length).toBe(4);
    // um mês depois só acrescenta o mês novo
    expect(await generate(w, '2026-04-20')).toMatchObject({ created: 1, existing: 4 });
  }, 60000);

  it('plano pausado não gera; competência sem preço não gera cobrança', async () => {
    const w = await world();
    const plan = await newPlan(w, { start_on: '2026-01-10' });
    await rpc(w.db, U.admin, `public.fin_update_member_plan('${key()}', '${plan.id}', 1, ${j({ status: 'paused' })})`);
    expect(await generate(w, '2026-03-15')).toMatchObject({ created: 0 });
    // preço só a partir de março: jan/fev ficam sem valor
    const w2 = await world();
    const p2 = await newPlan(w2);
    await q(w2.db, `delete from public.fin_member_plan_prices`).catch(() => null); // append-only: não apaga
    expect((await q(w2.db, `select 1 from public.fin_member_plan_prices where plan_id = '${p2.id}'`)).length).toBe(1);
  }, 60000);

  it('reajuste só vale daqui para a frente: competências passadas e já tocadas não mudam', async () => {
    const w = await world();
    const plan = await newPlan(w);
    await generate(w, '2026-03-15'); // jan..abr a 100,00
    const apr = (await charges(w, plan.id)).find((c) => c.competence_month === '2026-04-01')!;
    const feb = (await charges(w, plan.id)).find((c) => c.competence_month === '2026-02-01')!;
    // pagamento parcial em abril: a cobrança de abril está "tocada"
    const today = await dbToday(w.db);
    await rpc(w.db, U.admin, `public.fin_adjust_charge('${key()}', '${apr.id}', 'discount', 100, 'Cortesia de teste')`);
    const res = await rpc<{ repriced_charges: number }>(w.db, U.admin,
      `public.fin_set_plan_price('${key()}', '${plan.id}', '2026-03-01', 12000, 'Reajuste anual')`);
    const after = await charges(w, plan.id);
    expect(after.map((c) => [c.competence_month, c.original_amount_cents])).toEqual([
      ['2026-01-01', '10000'], ['2026-02-01', '10000'], ['2026-03-01', '12000'], ['2026-04-01', '10000'],
    ]);
    expect(res.repriced_charges).toBe(1); // só março estava intocada
    expect(feb.original_amount_cents).toBe('10000');
    expect(today > '2026-01-01').toBe(true);
    // gerar de novo respeita o histórico: maio nasce com o preço novo, as antigas não mudam
    await generate(w, '2026-04-20');
    const may = (await charges(w, plan.id)).find((c) => c.competence_month === '2026-05-01')!;
    expect(may.original_amount_cents).toBe('12000');
    expect((await charges(w, plan.id)).find((c) => c.competence_month === '2026-01-01')!.original_amount_cents).toBe('10000');
    // histórico de preço é append-only e versionado
    expect(await rpcError(w.db, U.admin, `public.fin_set_plan_price('${key()}', '${plan.id}', '2026-03-01', 13000, 'repetido')`)).toMatch(/PRICE_EXISTS/);
    const hist = await q<{ effective_from: string; amount_cents: string }>(w.db, `select effective_from::text, amount_cents::text from public.fin_member_plan_prices order by effective_from`);
    expect(hist.map((h) => [h.effective_from, h.amount_cents])).toEqual([['2026-01-01', '10000'], ['2026-03-01', '12000']]);
  }, 60000);
});

describe('fim do vínculo preserva o passado', () => {
  async function setup() {
    const w = await world();
    const plan = await newPlan(w);
    await generate(w, '2026-05-15'); // jan..jun
    const all = await charges(w, plan.id);
    const by = (m: string) => all.find((c) => c.competence_month === m)!;
    // jan paga integralmente, fev parcial
    await pay(w, by('2026-01-01').id, 10000, '2026-02-05');
    await pay(w, by('2026-02-01').id, 4000, '2026-03-05');
    return { w, plan, by };
  }

  it('encerramento manual cancela só o futuro sem pagamento', async () => {
    const { w, plan } = await setup();
    const res = await rpc<{ canceled_charges: number; ended_on: string }>(w.db, U.admin,
      `public.fin_end_member_plan('${key()}', '${plan.id}', '2026-03-20', 'Pediu desligamento')`);
    expect(res.canceled_charges).toBe(3); // abr, mai, jun
    const rows = await charges(w, plan.id);
    expect(rows.map((c) => [c.competence_month, c.status])).toEqual([
      ['2026-01-01', 'paid'], ['2026-02-01', 'partial'], ['2026-03-01', 'open'], // março: o vínculo existiu no mês
      ['2026-04-01', 'canceled'], ['2026-05-01', 'canceled'], ['2026-06-01', 'canceled'],
    ]);
    // pagamentos e histórico intactos
    expect((await q(w.db, `select 1 from public.fin_charge_payments`)).length).toBe(2);
    // nada novo é gerado para plano encerrado
    expect(await generate(w, '2026-09-01')).toMatchObject({ created: 0 });
  }, 60000);

  it('inativar o perfil encerra o plano sozinho (gatilho) e não bloqueia a edição do perfil', async () => {
    const { w, plan } = await setup();
    await w.db.exec(`update public.profiles set is_active = false where id = '${U.socioA}'`);
    const p = (await q<{ status: string; ended_on: string }>(w.db, `select status, ended_on::text from public.fin_member_plans where id = '${plan.id}'`))[0];
    expect(p.status).toBe('ended');
    const rows = await charges(w, plan.id);
    expect(rows.filter((c) => c.status === 'paid' || c.status === 'partial').length).toBe(2);
    expect((await q(w.db, `select 1 from public.fin_charge_payments`)).length).toBe(2);

    // se a função do gatilho quebrar, o perfil ainda salva (vira aviso)
    const w2 = await world();
    await newPlan(w2);
    await w2.db.exec(`create or replace function fin_private.end_plan(p_plan uuid, p_ended_on date, p_reason text, p_auto boolean) returns jsonb language plpgsql as $$ begin raise exception 'quebrou de propósito'; end $$;`);
    await w2.db.exec(`update public.profiles set is_active = false where id = '${U.socioA}'`);
    expect((await q<{ is_active: boolean }>(w2.db, `select is_active from public.profiles where id = '${U.socioA}'`))[0].is_active).toBe(false);
  }, 60000);

  it('deixar de ser sócio (papel) também encerra; trocar o nome não', async () => {
    const w = await world();
    const plan = await newPlan(w);
    await w.db.exec(`update public.profiles set name = 'Ana Renomeada' where id = '${U.socioA}'`);
    expect((await q<{ status: string }>(w.db, `select status from public.fin_member_plans where id = '${plan.id}'`))[0].status).toBe('active');
    await w.db.exec(`update public.profiles set role = 'lanchonete' where id = '${U.socioA}'`);
    expect((await q<{ status: string }>(w.db, `select status from public.fin_member_plans where id = '${plan.id}'`))[0].status).toBe('ended');
  }, 60000);
});

describe('encargos: banco = TypeScript', () => {
  const policies: Array<[string, FeePolicy, Record<string, unknown>]> = [
    ['fixo', { confirmed: true, graceDays: 0, fineFixedCents: 500, finePercentBps: null, interestDailyFixedCents: 25, interestDailyPercentBps: null },
      { fine_fixed_cents: 500, interest_daily_fixed_cents: 25 }],
    ['percentual', { confirmed: true, graceDays: 0, fineFixedCents: null, finePercentBps: 200, interestDailyFixedCents: null, interestDailyPercentBps: 33 },
      { fine_percent_bps: 200, interest_daily_percent_bps: 33 }],
    ['combinado + carência', { confirmed: true, graceDays: 3, fineFixedCents: 100, finePercentBps: 150, interestDailyFixedCents: 7, interestDailyPercentBps: 15 },
      { grace_days: 3, fine_fixed_cents: 100, fine_percent_bps: 150, interest_daily_fixed_cents: 7, interest_daily_percent_bps: 15 }],
  ];

  for (const [name, policy, data] of policies) {
    it(`política ${name}: extrato idêntico antes, durante e depois de pagamentos parciais`, async () => {
      const w = await world();
      const plan = await newPlan(w, { amount_cents: 12345 });
      const today = await dbToday(w.db);
      await generate(w, today);
      const first = (await charges(w, plan.id))[0];
      await setPolicy(w, { ...data, late_fee_confirmed: true });
      const due = first.due_date;
      const base = { originalCents: 12345, dueDate: due };
      const asOfs = [addDays(due, -2), due, addDays(due, 1), addDays(due, 4), addDays(due, 10), addDays(due, 25)].filter((d) => d <= today);
      const check = async (payments: Array<{ paidOn: string; fineCents: number; interestCents: number; principalCents: number }>, label: string) => {
        for (const asOf of asOfs) {
          const sql = (await q<any>(w.db, `select * from fin_private.charge_statement('${first.id}', '${asOf}')`))[0];
          const ts = computeStatement({ ...base, payments }, policy, asOf);
          const got = {
            principalRemaining: Number(sql.principal_remaining), fineDue: Number(sql.fine_due), interestDue: Number(sql.interest_due),
            feesDue: Number(sql.fees_due), total: Number(sql.total_due), daysLate: sql.days_late, settled: sql.settled, overdue: sql.overdue,
          };
          expect(got, `${name} ${label} @${asOf}`).toEqual({
            principalRemaining: ts.principalRemainingCents, fineDue: ts.fineDueCents, interestDue: ts.interestDueCents,
            feesDue: ts.feesDueCents, total: ts.totalDueCents, daysLate: ts.daysLate, settled: ts.settled, overdue: ts.overdue,
          });
        }
      };
      await check([], 'sem pagamento');
      // pagamento parcial depois do vencimento (se couber no relógio do banco)
      const payDate = addDays(due, 4);
      if (payDate <= today) {
        const r = await pay(w, first.id, 5000, payDate);
        await check([{ paidOn: payDate, fineCents: r.fine_cents, interestCents: r.interest_cents, principalCents: r.principal_cents }], 'parcial');
      }
    }, 120000);
  }
});

describe('pagamentos: integral, parcial, excedente, duplicado, estorno, cancelamento', () => {
  async function one(over: Record<string, unknown> = {}) {
    const w = await world();
    const plan = await newPlan(w, { amount_cents: 10000, ...over });
    const today = await dbToday(w.db);
    await generate(w, today);
    const c = (await charges(w, plan.id))[0];
    return { w, plan, c, today };
  }
  const status = async (w: W, id: string) => (await q<{ status: string }>(w.db, `select status from public.fin_member_charges where id = '${id}'`))[0].status;

  it('pagamento parcial → parcial; completar → paga', async () => {
    const { w, c } = await one();
    const p1 = await pay(w, c.id, 4000, c.due_date <= (await dbToday(w.db)) ? c.due_date : (await dbToday(w.db)));
    expect(p1).toMatchObject({ principal_cents: 4000, excess_cents: 0, charge_status: 'partial' });
    const p2 = await pay(w, c.id, 6000, (await dbToday(w.db)));
    expect(p2.charge_status).toBe('paid');
    expect(await status(w, c.id)).toBe('paid');
  }, 60000);

  it('excedente vira crédito do sócio — nunca é descartado', async () => {
    const { w, c, today } = await one();
    const p = await pay(w, c.id, 12500, today);
    expect(p).toMatchObject({ principal_cents: 10000, excess_cents: 2500, duplicate: false, charge_status: 'paid' });
    const cr = await q<{ amount_cents: string; remaining_cents: string; reason: string; status: string }>(w.db,
      `select amount_cents::text, remaining_cents::text, reason, status from public.fin_member_credits`);
    expect(cr).toEqual([{ amount_cents: '2500', remaining_cents: '2500', reason: 'excess', status: 'open' }]);
  }, 60000);

  it('pagamento sobre cobrança já quitada é registrado como crédito "duplicado"', async () => {
    const { w, c, today } = await one();
    await pay(w, c.id, 10000, today);
    const dup = await pay(w, c.id, 10000, today);
    expect(dup).toMatchObject({ principal_cents: 0, excess_cents: 10000, duplicate: true });
    expect((await q<{ reason: string }>(w.db, `select reason from public.fin_member_credits`))[0].reason).toBe('duplicate');
  }, 60000);

  it('estorno devolve a cobrança a aberta, preserva o histórico e só vale para o último pagamento', async () => {
    const { w, c, today } = await one();
    const p1 = await pay(w, c.id, 4000, today);
    const p2 = await pay(w, c.id, 6000, today);
    expect(await rpcError(w.db, U.admin, `public.fin_reverse_payment('${key()}', '${p1.payment_id}', 'Estorno de teste')`)).toMatch(/ONLY_LAST_PAYMENT_REVERSIBLE/);
    expect(await rpcError(w.db, U.admin, `public.fin_reverse_payment('${key()}', '${p2.payment_id}', 'x')`)).toMatch(/REASON_REQUIRED/);
    const rev = await rpc<any>(w.db, U.admin, `public.fin_reverse_payment('${key()}', '${p2.payment_id}', 'Pix devolvido pelo banco')`);
    expect(rev.charge_status).toBe('partial');
    expect(await rpcError(w.db, U.admin, `public.fin_reverse_payment('${key()}', '${p2.payment_id}', 'de novo')`)).toMatch(/PAYMENT_ALREADY_REVERSED/);
    const rows = await q<{ kind: string }>(w.db, `select kind from public.fin_charge_payments order by created_at, id`);
    expect(rows.map((r) => r.kind).sort()).toEqual(['payment', 'payment', 'reversal']); // nada foi apagado
    await rpc(w.db, U.admin, `public.fin_reverse_payment('${key()}', '${p1.payment_id}', 'Estornando o primeiro também')`);
    expect(await status(w, c.id)).toBe('open');
  }, 60000);

  it('estornar pagamento com excedente já aplicado é recusado; sem uso, o crédito some', async () => {
    const { w, c, today } = await one();
    const p = await pay(w, c.id, 13000, today);
    await rpc(w.db, U.admin, `public.fin_reverse_payment('${key()}', '${p.payment_id}', 'Pagamento lançado por engano')`);
    expect((await q<{ status: string }>(w.db, `select status from public.fin_member_credits`))[0].status).toBe('void');
    expect(await status(w, c.id)).toBe('open');
  }, 60000);

  it('cancelar: só sem pagamento efetivo; com pagamento, estorna antes', async () => {
    const { w, c, today } = await one();
    const p = await pay(w, c.id, 3000, today);
    expect(await rpcError(w.db, U.admin, `public.fin_cancel_charge('${key()}', '${c.id}', 'Cobrança lançada errada')`)).toMatch(/CHARGE_HAS_PAYMENTS/);
    await rpc(w.db, U.admin, `public.fin_reverse_payment('${key()}', '${p.payment_id}', 'Estorno para cancelar')`);
    await rpc(w.db, U.admin, `public.fin_cancel_charge('${key()}', '${c.id}', 'Cobrança lançada errada')`);
    expect(await status(w, c.id)).toBe('canceled');
    expect(await rpcError(w.db, U.admin, `public.fin_register_payment('${key()}', '${c.id}', 1000, '${today}', 'pix', '${w.account}', null)`)).toMatch(/CHARGE_CANCELED/);
  }, 60000);

  it('crédito: aplicar em outra cobrança, devolver (saída de caixa) ou baixar com justificativa', async () => {
    const { w, plan, c, today } = await one();
    await generate(w, addMonths(firstOfMonth(today), 1));
    const next = (await charges(w, plan.id))[1];
    await pay(w, c.id, 13000, today); // 30,00 de excedente
    const credit = (await q<{ id: string }>(w.db, `select id from public.fin_member_credits`))[0].id;
    const applied = await rpc<any>(w.db, U.admin, `public.fin_resolve_credit('${key()}', '${credit}', 'apply', ${j({ charge_id: next.id, amount_cents: 2000 })})`);
    expect(applied.result.charge_status).toBe('partial');
    let cr = (await q<{ remaining_cents: string; status: string }>(w.db, `select remaining_cents::text, status from public.fin_member_credits`))[0];
    expect(cr).toEqual({ remaining_cents: '1000', status: 'open' });
    // aplicar crédito não é entrada de dinheiro: não aparece como pagamento em caixa
    const credPay = await q<{ method: string; account_id: string | null }>(w.db, `select method, account_id from public.fin_charge_payments where method = 'credit'`);
    expect(credPay).toEqual([{ method: 'credit', account_id: null }]);
    // devolver o resto
    await rpc(w.db, U.admin, `public.fin_resolve_credit('${key()}', '${credit}', 'refund', ${j({ account_id: w.account, reason: 'Devolvido por Pix' })})`);
    cr = (await q<any>(w.db, `select remaining_cents::text, status from public.fin_member_credits`))[0];
    expect(cr).toEqual({ remaining_cents: '0', status: 'refunded' });
    expect((await q(w.db, `select 1 from public.fin_entries where kind = 'member_refund' and amount_cents = 1000`)).length).toBe(1);
    expect(await rpcError(w.db, U.admin, `public.fin_resolve_credit('${key()}', '${credit}', 'void', ${j({ reason: 'não deveria' })})`)).toMatch(/CREDIT_NOT_OPEN/);
  }, 60000);
});

describe('política de encargos: sem regra definida não há cálculo; dispensa é auditada', () => {
  async function overdue() {
    const w = await world();
    const plan = await newPlan(w, { start_on: addMonths(firstOfMonth(await dbToday(w.db)), -4) });
    const today = await dbToday(w.db);
    await generate(w, today);
    const c = (await charges(w, plan.id))[0]; // a mais antiga: vencida
    return { w, c, today };
  }

  it('sem política confirmada os encargos ficam zerados e o extrato avisa', async () => {
    const { w, c, today } = await overdue();
    const st = (await q<any>(w.db, `select * from fin_private.charge_statement('${c.id}', '${today}')`))[0];
    expect(st).toMatchObject({ fees_configured: false, overdue: true });
    expect(Number(st.fees_due)).toBe(0);
    expect(st.days_late).toBeGreaterThan(0);
  }, 60000);

  it('confirmada a política, calcula; mudar política confirmada exige motivo', async () => {
    const { w, c, today } = await overdue();
    await setPolicy(w, { fine_fixed_cents: 300, interest_daily_fixed_cents: 10, late_fee_confirmed: true });
    const st = (await q<any>(w.db, `select * from fin_private.charge_statement('${c.id}', '${today}')`))[0];
    expect(Number(st.fine_due)).toBe(300);
    expect(Number(st.interest_due)).toBe(10 * st.days_late);
    expect(await rpcError(w.db, U.admin, `public.fin_save_settings('${key()}', ${SETTINGS_VERSION}, ${j({ fine_fixed_cents: 400 })})`)).toMatch(/REASON_REQUIRED/);
    await rpc(w.db, U.admin, `public.fin_save_settings('${key()}', ${SETTINGS_VERSION}, ${j({ fine_fixed_cents: 400, reason: 'Aprovado em assembleia' })})`);
  }, 60000);

  it('dispensa de encargos: só admin, só com justificativa, só sobre encargo existente, com antes/depois na auditoria', async () => {
    const { w, c, today } = await overdue();
    await setPolicy(w, { fine_fixed_cents: 300, interest_daily_fixed_cents: 10, late_fee_confirmed: true });
    const before = (await q<any>(w.db, `select * from fin_private.charge_statement('${c.id}', '${today}')`))[0];
    const call = (uid: string, amount: number, reason: string) =>
      `public.fin_adjust_charge('${key()}', '${c.id}', 'fee_waiver', ${amount}, '${reason}')`;
    expect(await rpcError(w.db, U.socioA, call(U.socioA, 100, 'Sou eu mesmo pedindo'))).toMatch(/FINANCE_FORBIDDEN/);
    expect(await rpcError(w.db, U.admin, call(U.admin, 100, 'ruim'))).toMatch(/REASON_REQUIRED/);
    expect(await rpcError(w.db, U.admin, call(U.admin, Number(before.fees_due) + 1, 'Excede os encargos'))).toMatch(/WAIVER_EXCEEDS_FEES/);
    const res = await rpc<any>(w.db, U.admin, call(U.admin, 300, 'Sócio com problema de saúde'));
    const after = (await q<any>(w.db, `select * from fin_private.charge_statement('${c.id}', '${today}')`))[0];
    expect(Number(after.fees_due)).toBe(Number(before.fees_due) - 300);
    expect(Number(after.fees_waived)).toBe(300);
    const adj = (await q<any>(w.db, `select kind, amount_cents::text, reason, actor_id, before_data, after_data from public.fin_charge_adjustments where id = '${res.id}'`))[0];
    expect(adj).toMatchObject({ kind: 'fee_waiver', amount_cents: '300', reason: 'Sócio com problema de saúde', actor_id: U.admin });
    expect(adj.before_data.fees_due).toBe(Number(before.fees_due));
    expect(adj.after_data.fees_due).toBe(Number(after.fees_due));
    // trilha de auditoria do STC (admin_audit_logs) com ator, objeto e valores
    const audit = await q<any>(w.db, `select action, table_name, actor_user_id, metadata, new_data from public.admin_audit_logs
      where source = 'finance' and table_name = 'fin_charge_adjustments' and record_id = '${res.id}'`);
    // 2 linhas: a criação do ajuste e o preenchimento do "depois" na mesma transação
    expect(audit.length).toBe(2);
    expect(audit.every((a) => a.action === 'fin.charge_adjust_fee_waiver' && a.actor_user_id === U.admin)).toBe(true);
    expect(audit.every((a) => a.metadata.reason === 'Sócio com problema de saúde')).toBe(true);
    const created = audit.find((a) => a.metadata.op === 'insert');
    expect(created.new_data.amount_cents).toBe(300);
    expect(created.new_data.before_data.fees_due).toBe(Number(before.fees_due));
    const filled = audit.find((a) => a.metadata.op === 'update');
    expect(filled.new_data.after_data.fees_due).toBe(Number(after.fees_due));
  }, 60000);

  it('desconto não passa do saldo e reduz a base; tudo com justificativa', async () => {
    const { w, c } = await overdue();
    expect(await rpcError(w.db, U.admin, `public.fin_adjust_charge('${key()}', '${c.id}', 'discount', 99999, 'Desconto absurdo')`)).toMatch(/DISCOUNT_EXCEEDS_BALANCE/);
    expect(await rpcError(w.db, U.admin, `public.fin_adjust_charge('${key()}', '${c.id}', 'discount', 100, '')`)).toMatch(/REASON_REQUIRED/);
    await rpc(w.db, U.admin, `public.fin_adjust_charge('${key()}', '${c.id}', 'discount', 2000, 'Desconto de bolsa atleta')`);
    const st = (await q<any>(w.db, `select * from fin_private.charge_statement('${c.id}', fin_private.today())`))[0];
    expect(Number(st.principal_base)).toBe(8000);
  }, 60000);
});

describe('idempotência', () => {
  it('a mesma chave devolve o mesmo resultado e não duplica o pagamento', async () => {
    const w = await world();
    const plan = await newPlan(w);
    const today = await dbToday(w.db);
    await generate(w, today);
    const c = (await charges(w, plan.id))[0];
    const k = key();
    const call = `public.fin_register_payment('${k}', '${c.id}', 3000, '${today}', 'pix', '${w.account}', null)`;
    const a = await rpc<any>(w.db, U.admin, call);
    const b = await rpc<any>(w.db, U.admin, call);
    expect(b.payment_id).toBe(a.payment_id);
    expect(b.replayed).toBe(true);
    expect((await q(w.db, `select 1 from public.fin_charge_payments`)).length).toBe(1);
    // chave reaproveitada para outra ação é recusada
    expect(await rpcError(w.db, U.admin, `public.fin_cancel_charge('${k}', '${c.id}', 'Outra ação com a mesma chave')`)).toMatch(/IDEMPOTENCY_KEY_REUSED/);
    expect(await rpcError(w.db, U.admin, `public.fin_register_payment(null, '${c.id}', 1000, '${today}', 'pix', '${w.account}', null)`)).toMatch(/IDEMPOTENCY_KEY_REQUIRED/);
  }, 60000);
});

describe('RLS e permissões — sócio, professor, administrador e lanchonete', () => {
  async function seed() {
    const w = await world();
    const pa = await newPlan(w, { profile_id: U.socioA });
    await newPlan(w, { profile_id: U.socioB, amount_cents: 20000 });
    const today = await dbToday(w.db);
    await generate(w, today);
    const own = (await charges(w)).filter(Boolean);
    return { w, pa, own, today };
  }

  it('sócio vê só as próprias cobranças; os outros papéis, nenhuma', async () => {
    const { w } = await seed();
    const count = async (uid: string | null, table: string) =>
      Number((await asUser<{ n: string }>(w.db, uid, `select count(*)::text n from public.${table}`))[0].n);
    const total = await count(U.admin, 'fin_member_charges');
    expect(total).toBeGreaterThan(0);
    const mineA = await count(U.socioA, 'fin_member_charges');
    const mineB = await count(U.socioB, 'fin_member_charges');
    expect(mineA + mineB).toBe(total);
    expect(mineA).toBeGreaterThan(0);
    expect(mineB).toBeGreaterThan(0);
    for (const uid of [U.prof, U.lanch, U.profOther]) expect(await count(uid, 'fin_member_charges'), `uid ${uid}`).toBe(0);
    // sócio A não enxerga o plano nem o preço do B
    const plansSeenByA = await asUser<{ profile_id: string }>(w.db, U.socioA, `select profile_id from public.fin_member_plans`);
    expect(plansSeenByA.every((p) => p.profile_id === U.socioA)).toBe(true);
    const pricesSeenByA = await asUser<{ amount_cents: string }>(w.db, U.socioA, `select amount_cents::text from public.fin_member_plan_prices`);
    expect(pricesSeenByA.map((p) => p.amount_cents)).toEqual(['10000']);
    // anônimo não lê nada
    expect(await asUserError(w.db, null, `select * from public.fin_member_charges`)).toMatch(/permission denied/);
  }, 60000);

  it('tabelas de gestão (contas, categorias, configuração, lançamentos) só para o administrador', async () => {
    const { w } = await seed();
    const cat = (await q<{ id: string }>(w.db, `select id from public.fin_categories where name = 'Energia'`))[0].id;
    await rpc(w.db, U.admin, `public.fin_create_entry('${key()}', ${j({ kind: 'expense', description: 'Conta de luz', category_id: cat, amount_cents: 30000, status: 'pending', due_date: '2026-11-10' })})`);
    await rpc(w.db, U.admin, `public.fin_save_recurrence('${key()}', null, null, ${j({ description: 'Aluguel', category_id: cat, amount_cents: 100000, due_day: 10, start_month: '2026-11-01' })}, null)`);
    for (const t of ['fin_accounts', 'fin_categories', 'fin_settings', 'fin_holidays', 'fin_entries', 'fin_recurrences', 'fin_entry_payments']) {
      const n = Number((await asUser<{ n: string }>(w.db, U.admin, `select count(*)::text n from public.${t}`))[0].n);
      if (t !== 'fin_entry_payments') expect(n, t).toBeGreaterThan(0);
      for (const uid of [U.socioA, U.prof, U.lanch]) {
        const rows = await asUser<{ n: string }>(w.db, uid, `select count(*)::text n from public.${t}`);
        expect(Number(rows[0].n), `${t} como ${uid}`).toBe(0);
      }
    }
  }, 60000);

  it('escrita direta é negada a todos (inclusive ao administrador): só as funções escrevem', async () => {
    const { w, own } = await seed();
    const c = own[0].id;
    for (const uid of [U.admin, U.socioA, U.prof, U.lanch, null]) {
      const label = String(uid);
      expect(await asUserError(w.db, uid, `insert into public.fin_member_charges(plan_id, profile_id, competence_month, period_months, due_date, original_amount_cents)
        select plan_id, profile_id, '2030-01-01', 1, '2030-02-05', 1 from public.fin_member_charges limit 1`), `insert ${label}`).not.toBeNull();
      expect(await asUserError(w.db, uid, `update public.fin_member_charges set original_amount_cents = 1 where id = '${c}'`), `update ${label}`).not.toBeNull();
      expect(await asUserError(w.db, uid, `delete from public.fin_member_charges where id = '${c}'`), `delete ${label}`).not.toBeNull();
      expect(await asUserError(w.db, uid, `update public.fin_settings set fine_fixed_cents = 1`), `settings ${label}`).not.toBeNull();
    }
    // o valor não mudou
    expect((await q<{ n: string }>(w.db, `select original_amount_cents::text n from public.fin_member_charges where id = '${c}'`))[0].n).not.toBe('1');
    // mesmo o superusuário não apaga (gatilho)
    await expect(w.db.exec(`delete from public.fin_member_charges where id = '${c}'`)).rejects.toThrow(/FINANCE_NO_DELETE/);
  }, 60000);

  it('funções de gestão recusam sócio, professor e lanchonete; anônimo nem executa', async () => {
    const { w, own } = await seed();
    const calls = [
      `public.fin_charge_statements()`,
      `public.fin_generate_member_charges('${key()}')`,
      `public.fin_register_payment('${key()}', '${own[0].id}', 1000, '2026-01-05', 'pix', '${w.account}', null)`,
      `public.fin_save_settings('${key()}', 1, '{}'::jsonb)`, // sócio não lê fin_settings: a versão não pode ser subconsulta aqui
      `public.fin_adjust_charge('${key()}', '${own[0].id}', 'discount', 100, 'Quero desconto')`,
    ];
    for (const uid of [U.socioA, U.prof, U.lanch]) {
      for (const call of calls) expect(await rpcError(w.db, uid, call), `${uid} ${call}`).toMatch(/FINANCE_FORBIDDEN/);
    }
    for (const call of calls) expect(await rpcError(w.db, null, call), `anon ${call}`).toMatch(/permission denied/);
  }, 60000);

  it('fin_my_charges devolve só as do próprio sócio; extrato por ids recusa cobrança alheia', async () => {
    const { w, own } = await seed();
    const mineA = await asUser<{ profile_id: string }>(w.db, U.socioA, `select profile_id from public.fin_my_charges()`);
    expect(mineA.length).toBeGreaterThan(0);
    expect(mineA.every((r) => r.profile_id === U.socioA)).toBe(true);
    const ofB = (await q<{ id: string }>(w.db, `select id from public.fin_member_charges where profile_id = '${U.socioB}' limit 1`))[0].id;
    expect(await asUserError(w.db, U.socioA, `select * from public.fin_charge_statements_by_ids(array['${ofB}']::uuid[])`)).toMatch(/FINANCE_FORBIDDEN/);
    expect(own.length).toBeGreaterThan(0);
    expect(await asUserError(w.db, U.admin, `select * from public.fin_charge_statements_by_ids(array['${ofB}']::uuid[])`)).toBeNull();
  }, 60000);

  it('regra pública de vencimento/encargos é legível por qualquer logado, sem expor a configuração inteira', async () => {
    const { w } = await seed();
    const row = (await asUser<any>(w.db, U.socioA, `select * from public.fin_public_settings()`))[0];
    expect(row).toMatchObject({ due_day: 5, due_month_offset: 0, non_business_rule: 'next_business_day', late_fee_confirmed: false });
    expect(row.fine_fixed_cents).toBeNull();
    expect(await asUserError(w.db, null, `select * from public.fin_public_settings()`)).toMatch(/permission denied/);
  }, 60000);
});

void ID;
