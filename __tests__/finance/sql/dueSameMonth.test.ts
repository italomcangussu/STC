// @vitest-environment node
/**
 * Migration 20261006100500 — vencimento no mês cobrado, só fins de semana (feriado não conta).
 *
 * Parte de um banco "antigo" (todas as migrations financeiras MENOS a nova, vencimento no mês
 * seguinte), cria cobranças em todos os estados e aplica a migration por cima, como acontece
 * no banco real. Só cobrança aberta, gerada pelo sistema, sem pagamento e sem ajuste muda.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { j, key, newDb, q, rpc, seedPeople, SETTINGS_VERSION, U } from './harness';

const MIGRATION = resolve(__dirname, '../../../supabase/migrations/20261006100500_finance_due_same_month.sql');
const ANTES = ['foundation', 'member_billing', 'receipts', 'day_card', 'reports'];
const HOJE = '2026-10-06';

const applyMigration = async (db: PGlite) => { await db.exec(await readFile(MIGRATION, 'utf8')); };

async function mundoAntigo() {
  const db = await newDb({ only: ANTES });
  await seedPeople(db);
  const acc = await rpc<{ id: string }>(db, U.admin,
    `public.fin_save_account('${key()}', null, null, ${j({ name: 'Banco do clube', kind: 'bank', opening_balance_cents: 0, opening_date: '2020-01-01', is_default_receipts: true })})`);
  return { db, account: acc.id };
}

const plano = (db: PGlite, profile: string, startOn: string) =>
  rpc<{ id: string }>(db, U.admin, `public.fin_create_member_plan('${key()}', ${j({ profile_id: profile, start_on: startOn, amount_cents: 10000, period_months: 1 })})`);
const gerar = (db: PGlite, planId: string) =>
  rpc(db, U.admin, `public.fin_generate_member_charges('${key()}', '${planId}', '${HOJE}')`);
const due = async (db: PGlite, planId: string) =>
  Object.fromEntries((await q<{ m: string; d: string }>(db,
    `select competence_month::text m, due_date::text d from public.fin_member_charges where plan_id = '${planId}' order by 1`)).map((r) => [r.m, r.d]));
const chargeId = async (db: PGlite, planId: string, month: string) =>
  (await q<{ id: string }>(db, `select id from public.fin_member_charges where plan_id = '${planId}' and competence_month = '${month}'`))[0].id;
const settings = async (db: PGlite) =>
  (await q<{ due_month_offset: number; version: number }>(db, `select due_month_offset, version from public.fin_settings`))[0];

describe('migration: vencimento no mês cobrado', () => {
  it('instalação nova: nasce vencendo no mês cobrado e sem feriado ativo (nem nos próximos anos)', async () => {
    const db = await newDb();
    expect((await settings(db)).due_month_offset).toBe(0);
    const ativos = async () => Number((await q<{ n: string }>(db, `select count(*)::text n from public.fin_holidays where active`))[0].n);
    expect(await ativos()).toBe(0);
    await db.exec(`select fin_private.seed_holidays(2040)`); // semear ano novo não reativa feriado
    expect(Number((await q<{ n: string }>(db, `select count(*)::text n from public.fin_holidays where extract(year from holiday_date) = 2040`))[0].n)).toBeGreaterThan(0);
    expect(await ativos()).toBe(0);
    const def = await q<{ d: string }>(db,
      `select column_default d from information_schema.columns where table_schema = 'public' and table_name = 'fin_settings' and column_name = 'due_month_offset'`);
    expect(def[0].d).toBe('0');
  }, 60000);

  it('banco existente: muda a regra do clube, desativa feriados e redata SÓ as cobranças intocadas', async () => {
    const { db, account } = await mundoAntigo();
    const antes = await settings(db);
    expect(antes.due_month_offset).toBe(1); // regra inicial: mês seguinte
    const feriadosAtivos = async () => Number((await q<{ n: string }>(db, `select count(*)::text n from public.fin_holidays where active`))[0].n);
    const totalFeriados = async () => Number((await q<{ n: string }>(db, `select count(*)::text n from public.fin_holidays`))[0].n);
    expect(await feriadosAtivos()).toBeGreaterThan(0); // regra antiga: feriados nacionais ativos

    // A: ago pago · set com desconto · out intocada · nov lançada à mão
    const a = await plano(db, U.socioA, '2026-08-10');
    await gerar(db, a.id);
    expect(await due(db, a.id)).toEqual({ '2026-08-01': '2026-09-08', '2026-09-01': '2026-10-05', '2026-10-01': '2026-11-05', '2026-11-01': '2026-12-07' });
    await rpc(db, U.admin, `public.fin_register_payment('${key()}', '${await chargeId(db, a.id, '2026-08-01')}', 10000, '2026-09-08', 'pix', '${account}', null)`);
    await rpc(db, U.admin, `public.fin_adjust_charge('${key()}', '${await chargeId(db, a.id, '2026-09-01')}', 'discount', 500, 'Desconto combinado')`);
    await db.exec(`update public.fin_member_charges set source = 'manual' where id = '${await chargeId(db, a.id, '2026-11-01')}'`);

    // C: set intocada · out cancelada · nov intocada
    const c = await plano(db, U.prof, '2026-09-10');
    await gerar(db, c.id);
    await rpc(db, U.admin, `public.fin_cancel_charge('${key()}', '${await chargeId(db, c.id, '2026-10-01')}', 'Sócio se desligou')`);

    // B: vencimento PRÓPRIO do plano (mês seguinte) — escolha explícita, não é tocada
    const b = await plano(db, U.socioB, '2026-09-10');
    await rpc(db, U.admin, `public.fin_update_member_plan('${key()}', '${b.id}', 1, ${j({ due_month_offset: 1 })})`);
    await gerar(db, b.id);
    const bAntes = await due(db, b.id);
    const versoes = async () => Object.fromEntries((await q<{ id: string; v: number }>(db, `select id, version v from public.fin_member_charges`)).map((r) => [r.id, r.v]));
    const versoesAntes = await versoes();

    // feriado local cadastrado pelo admin (segunda 5/10) também deixa de contar: sem isso, out/05 iria para out/06
    await rpc(db, U.admin, `public.fin_save_holiday('${key()}', null, ${j({ holiday_date: '2026-10-05', name: 'Aniversário da cidade', scope: 'municipal' })})`);
    const feriadosAntes = await totalFeriados();

    await applyMigration(db);

    // feriados: nenhum ativo, mas nenhum apagado (o admin pode reativar)
    expect(await feriadosAtivos()).toBe(0);
    expect(await totalFeriados()).toBe(feriadosAntes);

    // regra do clube
    const depois = await settings(db);
    expect(depois.due_month_offset).toBe(0);
    expect(depois.version).toBe(antes.version + 1);

    // A: pago, ajustado e manual ficam como estavam; só a intocada (out) vai para out/05 (segunda; o feriado local de 5/10 não conta)
    expect(await due(db, a.id)).toEqual({ '2026-08-01': '2026-09-08', '2026-09-01': '2026-10-05', '2026-10-01': '2026-10-05', '2026-11-01': '2026-12-07' });
    // C: set e nov intocadas vão para o mês cobrado; out cancelada fica. Set: 5/9 é sábado → segunda 7/9
    // (a Independência não empurra mais para o dia 8). Nov: 5/11.
    expect(await due(db, c.id)).toEqual({ '2026-09-01': '2026-09-07', '2026-10-01': '2026-11-05', '2026-11-01': '2026-11-05' });
    // B: regra própria do plano preservada
    expect(await due(db, b.id)).toEqual(bAntes);

    // só as 3 cobranças redatadas foram regravadas (versão +1); todas as outras ficam byte a byte como estavam
    const versoesDepois = await versoes();
    const mudadas = Object.keys(versoesAntes).filter((id) => versoesDepois[id] !== versoesAntes[id]).sort();
    const esperadas = [await chargeId(db, a.id, '2026-10-01'), await chargeId(db, c.id, '2026-09-01'), await chargeId(db, c.id, '2026-11-01')].sort();
    expect(mudadas).toEqual(esperadas);
    expect(mudadas.every((id) => versoesDepois[id] === versoesAntes[id] + 1)).toBe(true);
    // e a auditoria registra a ação
    const audit = await q<{ n: string }>(db, `select count(*)::text n from public.admin_audit_logs where action = 'fin.due_same_month' and source = 'finance'`);
    expect(Number(audit[0].n)).toBeGreaterThan(0);
  }, 120000);

  it('rodar duas vezes não muda mais nada', async () => {
    const { db } = await mundoAntigo();
    const a = await plano(db, U.socioA, '2026-09-10');
    await gerar(db, a.id);
    await applyMigration(db);
    const snap = async () => ({ s: await settings(db), cargas: await q(db, `select id, due_date::text, version from public.fin_member_charges order by id`) });
    const primeira = await snap();
    await applyMigration(db);
    expect(await snap()).toEqual(primeira);
  }, 120000);

  it('quem já escolheu outra regra no clube (ex.: 2º mês seguinte) não é sobrescrito', async () => {
    const { db } = await mundoAntigo();
    await rpc(db, U.admin, `public.fin_save_settings('${key()}', ${SETTINGS_VERSION}, ${j({ due_month_offset: 2 })})`);
    const antes = await settings(db);
    await applyMigration(db);
    expect(await settings(db)).toEqual(antes); // continua 2 e a versão não subiu
  }, 120000);
});
