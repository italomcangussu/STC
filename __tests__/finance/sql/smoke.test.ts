// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { newDb } from './harness';

describe('migrations aplicam', () => {
  it('fundação', async () => {
    const db = await newDb();
    const r = await db.query<{ n: string }>(`select count(*)::text n from public.fin_holidays`);
    expect(Number(r.rows[0].n)).toBeGreaterThan(100);
  }, 60000);
});
