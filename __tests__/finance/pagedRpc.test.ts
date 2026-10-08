import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));

import { listCharges, movements } from '../../lib/finance/financeApi';

const API_MAX_ROWS = 1000;

// Imita o servidor: aplica p_limit/p_offset do SQL e nunca entrega mais que o teto da API por resposta.
function serverWith(totalRows: number) {
  const table = Array.from({ length: totalRows }, (_, id) => ({ id, total_count: totalRows }));
  rpc.mockImplementation(async (_fn: string, args: { p_limit: number; p_offset: number }) => {
    const size = Math.min(args.p_limit, API_MAX_ROWS);
    return { data: table.slice(args.p_offset, args.p_offset + size), error: null };
  });
}

const argsOfCalls = () => rpc.mock.calls.map(([, args]) => [args.p_limit, args.p_offset]);

beforeEach(() => { rpc.mockReset(); });

describe('listCharges — exportação de cobranças pede até 5000 linhas', () => {
  it('junta as páginas de 1000 que a API entrega, em vez de parar na primeira', async () => {
    serverWith(2600);

    const charges = await listCharges({}, 5000);

    expect(charges).toHaveLength(2600);
    expect(argsOfCalls()).toEqual([[1000, 0], [1000, 1000], [1000, 2000]]);
  });

  it('respeita o teto pedido mesmo havendo mais linhas no banco', async () => {
    serverWith(7000);

    expect(await listCharges({}, 2500)).toHaveLength(2500);
    expect(argsOfCalls()).toEqual([[1000, 0], [1000, 1000], [500, 2000]]);
  });

  it('para a tela (300 linhas) continua sendo uma única chamada, como antes', async () => {
    serverWith(2600);

    await listCharges({ status: 'open' }, 300, 0, '2026-10-08');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('fin_charge_statements', {
      p_filters: expect.any(Object), p_as_of: '2026-10-08', p_limit: 300, p_offset: 0,
    });
  });

  it('começa a ler a partir do offset pedido', async () => {
    serverWith(2600);

    const charges = await listCharges({}, 1500, 400);

    expect(charges).toHaveLength(1500);
    expect(argsOfCalls()).toEqual([[1000, 400], [500, 1400]]);
  });

  it('propaga o erro original da API, que a tela sabe traduzir', async () => {
    const failure = { message: 'FORBIDDEN', code: 'P0001' };
    const fullPage = Array.from({ length: API_MAX_ROWS }, (_, id) => ({ id }));
    rpc.mockResolvedValueOnce({ data: fullPage, error: null }).mockResolvedValueOnce({ data: null, error: failure });

    await expect(listCharges({}, 5000)).rejects.toBe(failure);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('movements — fluxo de caixa pede até 5000 movimentos', () => {
  it('traz os 5000 pedidos mesmo com a API cortando cada resposta em 1000', async () => {
    serverWith(7000);

    const moves = await movements('2025-01-01', '2026-10-08', {}, 5000);

    expect(moves).toHaveLength(5000);
    expect(argsOfCalls()).toEqual([[1000, 0], [1000, 1000], [1000, 2000], [1000, 3000], [1000, 4000]]);
    expect(rpc.mock.calls[0]).toEqual(['fin_movements', { p_from: '2025-01-01', p_to: '2026-10-08', p_filters: {}, p_limit: 1000, p_offset: 0 }]);
  });

  it('sem limite explícito pede uma página de 1000, como antes', async () => {
    serverWith(50);

    expect(await movements('2026-10-01', '2026-10-31')).toHaveLength(50);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
