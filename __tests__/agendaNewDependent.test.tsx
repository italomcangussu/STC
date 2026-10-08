import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Agenda } from '../components/Agenda';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import { supabase } from '../lib/supabase';
import { User } from '../types';

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

const PROFESSOR_ID = 'professor-1';

// Só existe um professor no clube e ele é quem usa o aplicativo aqui.
const currentUser: User = {
  id: 'user-diego', name: 'Diego', email: 'diego@example.com', phone: '', role: 'socio', balance: 0, isActive: true, isProfessor: true,
};

const profileRow = (id: string, name: string) => ({
  id, name, email: `${id}@example.com`, phone: '', role: 'socio', category: 'A', avatar_url: null, is_active: true,
});

const tableData: Record<string, any[]> = {
  profiles: [profileRow('user-diego', 'Diego'), profileRow('user-hermeson', 'Hermeson')],
  courts: [{ id: 'court-rapida', name: 'Quadra Rápida', type: 'Rápida', is_active: true }],
  professors: [{ id: PROFESSOR_ID, user_id: 'user-diego', is_active: true, bio: null, profiles: { name: 'Diego' } }],
};

let inserts: Array<{ table: string; row: any }> = [];

function makeQuery(table: string) {
  let lastRow: any = null;
  const query: any = {
    select: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    not: vi.fn(() => query),
    in: vi.fn(() => query),
    contains: vi.fn(() => query),
    eq: vi.fn(() => query),
    update: vi.fn(() => query),
    insert: vi.fn((row: any) => { lastRow = row; inserts.push({ table, row }); return query; }),
    single: vi.fn(async () => ({ data: { id: `${table}-created`, ...lastRow }, error: null })),
    then: (resolve: (value: any) => void) => Promise.resolve({ data: tableData[table] ?? [], error: null }).then(resolve),
  };
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  inserts = [];
  vi.mocked(supabase.from).mockImplementation(((table: string) => makeQuery(table)) as never);
  vi.mocked(supabase.channel).mockReturnValue({
    on: vi.fn(function (this: unknown) { return this; }),
    subscribe: vi.fn(() => ({})),
  } as never);
  vi.mocked(supabase.removeChannel).mockImplementation(() => undefined as never);
});

async function openStudentFormAsProfessor() {
  render(<ConfirmProvider><Agenda currentUser={currentUser} /></ConfirmProvider>);

  fireEvent.click(await screen.findByRole('button', { name: /nova reserva/i }));
  fireEvent.click((await screen.findByText(/reserve horário para aulas/i)).closest('button')!);
  fireEvent.click(screen.getByRole('button', { name: /próximo/i }));

  const timeSelect = screen.getAllByRole('combobox').find(select => (select as HTMLSelectElement).querySelector('option[value="08:00"]'))!;
  fireEvent.change(timeSelect, { target: { value: '08:00' } });
  fireEvent.click(screen.getByRole('button', { name: /próximo/i }));

  fireEvent.click(await screen.findByRole('button', { name: /novo aluno/i }));
}

describe('Agenda — professor cadastra dependente pelo modal de aula', () => {
  it('grava o dependente e o perfil de aluno com o professor do clube, não sem professor', async () => {
    await openStudentFormAsProfessor();

    fireEvent.click(await screen.findByRole('button', { name: 'Dependente' }));
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Vinícius Frota' } });
    fireEvent.change(screen.getByDisplayValue('Sócio responsável'), { target: { value: 'user-hermeson' } });
    fireEvent.change(screen.getByDisplayValue('Vínculo com o responsável'), { target: { value: 'filho' } });
    fireEvent.change(screen.getByLabelText(/nível técnico/i), { target: { value: 'Iniciante' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar e adicionar/i }));

    await waitFor(() => expect(inserts.map(i => i.table)).toEqual(['non_socio_students', 'student_profiles']));
    const [dependent, studentProfile] = inserts;
    expect(dependent.row).toMatchObject({
      name: 'Vinícius Frota', student_type: 'dependent', responsible_socio_id: 'user-hermeson', relationship_type: 'filho', plan_type: 'Dependente',
      professor_id: PROFESSOR_ID,
    });
    expect(studentProfile.row).toMatchObject({ professor_id: PROFESSOR_ID });
  });
});
