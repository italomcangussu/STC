import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Agenda } from '../components/Agenda';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import { supabase } from '../lib/supabase';
import { User } from '../types';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const currentUser: User = {
  id: 'user-1',
  name: 'Italo',
  email: 'italo@example.com',
  phone: '',
  role: 'socio',
  balance: 0,
  isActive: true,
};

const reservationRow = {
  id: 'reservation-1',
  type: 'Play',
  date: '2026-05-14',
  start_time: '08:00',
  end_time: '09:00',
  court_id: 'court-1',
  creator_id: 'user-1',
  participant_ids: ['user-1'],
  guest_name: null,
  guest_responsible_id: null,
  professor_id: null,
  student_type: null,
  non_socio_student_id: null,
  non_socio_student_ids: [],
  observation: null,
  status: 'active',
};

type TableName =
  | 'profiles'
  | 'reservations'
  | 'matches'
  | 'courts'
  | 'professors'
  | 'non_socio_students'
  | 'challenges';

const tableData: Record<TableName, any[]> = {
  profiles: [{
    id: 'user-1',
    name: 'Italo',
    email: 'italo@example.com',
    phone: '',
    role: 'socio',
    category: 'A',
    avatar_url: null,
    is_active: true,
  }],
  reservations: [],
  matches: [],
  courts: [{ id: 'court-1', name: 'Quadra 1', type: 'Saibro', is_active: true }],
  professors: [],
  non_socio_students: [],
  challenges: [],
};

let pendingInsert: Promise<any> | null = null;
let insertResolvers: Array<(value: any) => void> = [];
let postgresCallbacks: Array<() => void> = [];
let failProfilesFetch = false;
let failReservationsFetch = false;
let gteCalls: Array<{ table: string; column: string; value: string }> = [];
let insertedRows: any[] = [];

function makeQuery(table: TableName) {
  const query: any = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    gte: vi.fn((column: string, value: string) => {
      gteCalls.push({ table, column, value });
      return query;
    }),
    not: vi.fn(() => query),
    in: vi.fn(() => query),
    contains: vi.fn(() => query),
    eq: vi.fn(() => query),
    update: vi.fn(() => query),
    insert: vi.fn((row: any) => {
      insertedRows.push(row);
      pendingInsert = new Promise(resolve => {
        insertResolvers.push(resolve);
      });
      return query;
    }),
    single: vi.fn(async () => {
      if (pendingInsert) await pendingInsert;
      return {
        data: { id: `created-${insertedRows.length}`, ...insertedRows.at(-1) },
        error: null,
      };
    }),
    then: (resolve: (value: any) => void) => {
      if (table === 'profiles' && failProfilesFetch) {
        return Promise.resolve({ data: null, error: new Error('Network offline') }).then(resolve);
      }
      if (table === 'reservations' && failReservationsFetch) {
        return Promise.resolve({ data: null, error: new Error('Falha ao ler reservas') }).then(resolve);
      }
      return Promise.resolve({ data: tableData[table], error: null }).then(resolve);
    },
  };

  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingInsert = null;
  insertResolvers = [];
  postgresCallbacks = [];
  failProfilesFetch = false;
  failReservationsFetch = false;
  gteCalls = [];
  insertedRows = [];
  tableData.reservations = [];

  vi.mocked(supabase.from).mockImplementation((table: string) => makeQuery(table as TableName));
  vi.mocked(supabase.channel).mockReturnValue({
    on: vi.fn((_event, filter, callback) => {
      if (filter.table === 'reservations') postgresCallbacks.push(callback);
      return vi.mocked(supabase.channel).mock.results.at(-1)?.value;
    }),
    subscribe: vi.fn(() => ({})),
  } as any);
  vi.mocked(supabase.removeChannel).mockImplementation(() => undefined as any);
});

async function openValidPlayReservationModal() {
  render(<ConfirmProvider><Agenda currentUser={currentUser} /></ConfirmProvider>);

  fireEvent.click(await screen.findByRole('button', { name: /nova reserva/i }));
  fireEvent.click(screen.getByRole('button', { name: /próximo/i }));

  const dialog = screen.getByRole('heading', { name: 'Nova Reserva' }).closest('.fixed') as HTMLElement;
  const controls = within(dialog).getAllByRole('combobox');
  fireEvent.change(controls[0], { target: { value: 'court-1' } });
  fireEvent.change(controls[1], { target: { value: '08:00' } });

  fireEvent.click(within(dialog).getByRole('button', { name: /próximo/i }));
  return dialog;
}

describe('Agenda reservation persistence', () => {
  it('does not create duplicate reservations when save is clicked repeatedly before the first request finishes', async () => {
    const dialog = await openValidPlayReservationModal();
    const saveButton = within(dialog).getByRole('button', { name: /confirmar reserva/i });

    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(insertedRows).toHaveLength(1);
    await act(async () => {
      insertResolvers.forEach(resolve => resolve({ data: null, error: null }));
      await pendingInsert;
    });
  });

  it('keeps already loaded reservations visible when a refetch fails because of an unstable connection', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    tableData.reservations = [{ ...reservationRow, date: new Date().toISOString().slice(0, 10) }];
    render(<ConfirmProvider><Agenda currentUser={currentUser} /></ConfirmProvider>);

    expect(await screen.findByText(/Italo/)).toBeInTheDocument();

    failProfilesFetch = true;
    postgresCallbacks[0]();

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching data:', expect.any(Error));
    });
    await waitFor(() => {
      expect(screen.getByText(/Italo/)).toBeInTheDocument();
    });

    consoleErrorSpy.mockRestore();
  });
  it('avisa quando não consegue ler as reservas, em vez de dizer que o dia está vazio', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    failReservationsFetch = true;
    render(<ConfirmProvider><Agenda currentUser={currentUser} /></ConfirmProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent(/não consegui carregar a agenda/i);
    expect(screen.queryByText(/nenhuma reserva para este dia/i)).not.toBeInTheDocument();

    failReservationsFetch = false;
    fireEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByText(/nenhuma reserva para este dia/i)).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it('abre lendo só os últimos 60 dias em diante e recua o histórico quando a pessoa navega para antes', async () => {
    render(<ConfirmProvider><Agenda currentUser={currentUser} /></ConfirmProvider>);
    await screen.findByRole('button', { name: /nova reserva/i });

    const firstLoad = gteCalls.filter(c => c.table === 'reservations');
    expect(firstLoad).toHaveLength(1);
    expect(firstLoad[0].column).toBe('date');
    expect(gteCalls.some(c => c.table === 'matches' && c.column === 'scheduled_date' && c.value === firstLoad[0].value)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    for (let i = 0; i < 10; i += 1) {
      const previous = await waitFor(() => {
        const button = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-chevron-left'));
        if (!button) throw new Error('botão anterior ainda não apareceu');
        return button;
      });
      fireEvent.click(previous);
    }

    await waitFor(() => {
      expect(gteCalls.filter(c => c.table === 'reservations').length).toBeGreaterThan(1);
    });
    const last = gteCalls.filter(c => c.table === 'reservations').at(-1)!;
    expect(last.value < firstLoad[0].value).toBe(true);
    expect(last.value.endsWith('-01')).toBe(true);
  });
});
