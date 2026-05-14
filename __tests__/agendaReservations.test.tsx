import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Agenda } from '../components/Agenda';
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
let insertedRows: any[] = [];

function makeQuery(table: TableName) {
  const query: any = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
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
  render(<Agenda currentUser={currentUser} />);

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
    tableData.reservations = [reservationRow];
    render(<Agenda currentUser={currentUser} />);

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
});
