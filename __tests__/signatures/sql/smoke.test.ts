// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { newDb } from './harness';

describe('migrations de assinaturas aplicam', () => {
  it('todas, em ordem', async () => {
    const db = await newDb();
    const t = await db.query<{ n: string }>(`select count(*)::text n from pg_tables where schemaname = 'public' and tablename like 'sig\\_%'`);
    expect(Number(t.rows[0].n)).toBe(6);
    const f = await db.query<{ n: string }>(`select count(*)::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'sig\\_%'`);
    expect(Number(f.rows[0].n)).toBeGreaterThan(25);
  }, 60000);
});
