// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { q, world } from './harness';

const rollback = readFileSync(path.resolve(__dirname, '../../../docs/financeiro/rollback_financeiro.sql'), 'utf8');

describe('rollback do financeiro (documentado, nunca roda sozinho)', () => {
  it('recusa executar sem a trava de confirmação e não apaga nada', async () => {
    const w = await world();
    await expect(w.db.exec(rollback)).rejects.toThrow(/bloqueado/i);
    const [t] = await q<any>(w.db, `select count(*)::int n from pg_tables where schemaname='public' and tablename like 'fin\\_%'`);
    expect(t.n).toBe(17);
  }, 60000);

  it('com a trava, remove tudo que o financeiro criou e deixa as tabelas do STC intactas', async () => {
    const w = await world();
    await w.db.exec(`set fin.confirm_drop = 'DROP_FINANCE'; ${rollback}`);
    expect((await q<any>(w.db, `select count(*)::int n from pg_tables where schemaname='public' and tablename like 'fin\\_%'`))[0].n).toBe(0);
    expect((await q<any>(w.db, `select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','fin_private') and p.proname like 'fin\\_%'`))[0].n).toBe(0);
    expect((await q<any>(w.db, `select count(*)::int n from pg_namespace where nspname='fin_private'`))[0].n).toBe(0);
    expect((await q<any>(w.db, `select count(*)::int n from pg_trigger where tgname in ('fin_profile_membership_end','fin_student_payments_audit')`))[0].n).toBe(0);
    // tabelas do STC continuam (e continuam aceitando escrita sem o gatilho do financeiro)
    await w.db.exec(`update public.profiles set is_active = is_active`);
    expect((await q<any>(w.db, `select count(*)::int n from pg_tables where schemaname='public' and tablename in ('profiles','reservations','student_payments','non_socio_students','professors')`))[0].n).toBe(5);
  }, 60000);
});
