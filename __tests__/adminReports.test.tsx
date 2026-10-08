import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminReports } from '../components/AdminReports';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

const API_MAX_ROWS = 1000;
const TOTAL_ACTIVE_RESERVATIONS = 1004;

const reservations = Array.from({ length: TOTAL_ACTIVE_RESERVATIONS }, (_, index) => ({
  id: `r-${String(index).padStart(4, '0')}`,
  court_id: 'court-1',
  start_time: '08:00:00',
  status: 'active',
}));

const counts: Record<string, number> = { profiles: 30, challenges: 2, matches: 166 };

// Imita o PostgREST: respeita `.range()` mas nunca entrega mais que o limite da API.
function makeQuery(table: string) {
  let range: [number, number] = [0, Infinity];
  const query: any = {
    select: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn((from: number, to: number) => { range = [from, to]; return query; }),
    then: (resolve: (value: unknown) => void) => {
      if (table in counts) return Promise.resolve({ count: counts[table], data: null, error: null }).then(resolve);
      if (table === 'courts') return Promise.resolve({ data: [{ id: 'court-1', name: 'Quadra 1' }], error: null }).then(resolve);
      if (table === 'reservations') {
        const [from, to] = range;
        return Promise.resolve({ data: reservations.slice(from, Math.min(to + 1, from + API_MAX_ROWS)), error: null }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
  return query;
}

beforeEach(() => {
  vi.mocked(supabase.from).mockImplementation(((table: string) => makeQuery(table)) as never);
});

describe('AdminReports — reservas além do limite de 1000 linhas da API', () => {
  it('conta todas as reservas ativas do período, não só as 1000 primeiras', async () => {
    render(<AdminReports />);

    const totals = await screen.findAllByText(String(TOTAL_ACTIVE_RESERVATIONS));

    expect(totals.length).toBeGreaterThan(0);
    expect(screen.queryByText(String(API_MAX_ROWS))).not.toBeInTheDocument();
  });
});
