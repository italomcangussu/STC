import { beforeEach, describe, expect, it, vi } from 'vitest';

const chain = vi.hoisted(() => {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.from = vi.fn(() => c);
  c.select = vi.fn(() => c);
  c.in = vi.fn();
  return c;
});
vi.mock('../../lib/supabase', () => ({ supabase: chain }));

import { profileNames } from '../../lib/finance/financeApi';

beforeEach(() => { chain.from.mockClear(); chain.select.mockClear(); chain.in.mockReset(); });

describe('profileNames', () => {
  it('sem ids não vai ao banco', async () => {
    expect(await profileNames([])).toEqual({});
    expect(chain.from).not.toHaveBeenCalled();
  });

  it('busca só os ids pedidos e devolve o nome por id', async () => {
    chain.in.mockResolvedValue({ data: [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Beto' }], error: null });

    expect(await profileNames(['u1', 'u2'])).toEqual({ u1: 'Ana', u2: 'Beto' });
    expect(chain.from).toHaveBeenCalledWith('profiles');
    expect(chain.in).toHaveBeenCalledWith('id', ['u1', 'u2']);
  });

  it('repassa o erro do banco', async () => {
    const failure = { message: 'permission denied' };
    chain.in.mockResolvedValue({ data: null, error: failure });

    await expect(profileNames(['u1'])).rejects.toBe(failure);
  });
});
