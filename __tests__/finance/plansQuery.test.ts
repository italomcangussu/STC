import { beforeEach, describe, expect, it, vi } from 'vitest';

const chain = vi.hoisted(() => {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.from = vi.fn(() => c);
  c.select = vi.fn(() => c);
  c.order = vi.fn(async () => ({ data: [], error: null }));
  return c;
});
vi.mock('../../lib/supabase', () => ({ supabase: chain }));

import { PLAN_PROFILE_FK, listPlans } from '../../lib/finance/financeApi';

beforeEach(() => { chain.select.mockClear(); });

describe('listPlans', () => {
  it('diz ao PostgREST QUAL chave leva ao sócio (a tabela tem três para profiles; sem isso a consulta é recusada)', async () => {
    await listPlans();
    const columns = chain.select.mock.calls[0][0] as string;
    expect(columns).toContain(`profile:profiles!${PLAN_PROFILE_FK}(`);
    expect(PLAN_PROFILE_FK).toBe('fin_member_plans_profile_id_fkey');
  });
});
