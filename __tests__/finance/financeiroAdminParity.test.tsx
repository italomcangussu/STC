import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceiroAdmin } from '../../components/FinanceiroAdmin';
import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { supabase } from '../../lib/supabase';
import { fxPayments, fxReservations, fxStudents, EXPECTED, FX } from './fixtures/studentsAndGuests';

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

/**
 * Painel de alunos (`FinanceiroAdmin`), na aba "Alunos e Day Card" do hub.
 *
 * Regra do clube (corrige o painel antigo): Day Card = taxa do CONVIDADO de um sócio, derivada da
 * reserva com convidado. Aula avulsa e Card Mensal = o que o aluno não-sócio PAGOU ao clube e foi
 * registrado em `student_payments`. A aula do aluno não soma nada por conta própria — antes o painel
 * contava R$ 50 por aula de aluno em cima do pagamento (dupla contagem e cobrança de quem tem Card Mensal).
 * O professor é pago pelo aluno e não aparece aqui.
 */
const reservationRows = fxReservations.map((r) => ({
  id: r.id, type: r.type, date: r.date, start_time: '08:00', end_time: '09:00', court_id: 'c1', creator_id: 'u1',
  participant_ids: r.participant_ids, guest_name: r.guest_name, student_type: r.student_type, non_socio_student_id: r.non_socio_student_id,
  non_socio_student_ids: r.non_socio_student_ids, status: r.status, payment_status: r.payment_status,
}));
const studentRows = fxStudents.map((s) => ({
  id: s.id, name: s.name, phone: null, plan_type: s.plan_type, plan_status: s.plan_status, master_expiration_date: s.master_expiration_date,
  professor_id: FX.prof.p1, student_type: s.student_type, responsible_socio_id: null, relationship_type: null,
}));
const paymentRows = fxPayments.map((p) => ({ id: p.id, amount: p.amount, payment_date: p.payment_date, student_id: p.student_id, status: p.status, cancelled_reason: p.cancelled_reason }));

/** Imita o PostgREST no que o componente usa: `.neq()` filtra de verdade (reservas canceladas ficam de fora). */
function builder(data: Array<Record<string, unknown>>) {
  let rows = data;
  const b: any = {
    select: () => b, order: () => b, eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; },
    range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return b; },
    neq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] !== v); return b; },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
  };
  return b;
}

const mount = (props: Record<string, unknown> = {}) => render(<ConfirmProvider><FinanceiroAdmin {...props} /></ConfirmProvider>);

describe('FinanceiroAdmin — números existentes (paridade)', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockImplementation(((table: string) =>
      builder(table === 'reservations' ? reservationRows : table === 'non_socio_students' ? studentRows : paymentRows)) as never);
  });

  async function openAugust() {
    const { container } = mount();
    await waitFor(() => expect(screen.getByText('Painel Financeiro')).toBeInTheDocument());
    fireEvent.change(container.querySelector('input[type="month"]') as HTMLInputElement, { target: { value: FX.month } });
    return container;
  }

  it('receita = Day Card dos convidados + pagamentos de alunos; aula de aluno não soma nada', async () => {
    await openAugust();
    // Day Card: 1 convidado cobrado (o isento fica de fora) × R$ 50
    await waitFor(() => expect(screen.getByText(`${EXPECTED.dayCardCount} convidados`)).toBeInTheDocument());
    expect(screen.getAllByText('R$ 50.00').length).toBeGreaterThan(0);
    // Pagamentos ativos: 200 + 50 + 200; o experimental cancelado é "estornado", fora da receita
    expect(screen.getByText('R$ 450.00')).toBeInTheDocument();
    expect(screen.getAllByText(/3 ativos/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 estornados/).length).toBeGreaterThan(0);
    // Receita Total = 50 + 450 (as 6 participações de alunos em aula não entram)
    expect(screen.getByText('R$ 500.00')).toBeInTheDocument();
    expect(EXPECTED.grandTotal).toBe(50000);
  });

  it('lista só o convidado cobrado (isento fora) e chama os pagamentos de aluno de Card Mensal e Aula avulsa', async () => {
    await openAugust();
    await waitFor(() => expect(screen.getByText('Convidado Fulano')).toBeInTheDocument());
    expect(screen.queryByText('Convidado Isento')).not.toBeInTheDocument();
    expect(screen.getByText('CONVIDADO')).toBeInTheDocument();
    // alunos aparecem pelos PAGAMENTOS, não por aula
    expect(screen.getAllByText('Aluno Day Card').length).toBe(1);
    expect(screen.getAllByText('Card Mensal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aula avulsa').length).toBe(1);
    expect(screen.queryByText('Day Card', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.getByText('ESTORNADO')).toBeInTheDocument();
  });

  it('o valor do Day Card pode vir da configuração (mesmo valor do app = nenhum número muda)', async () => {
    const { container } = mount({ dayCardPriceCents: 5000 });
    await waitFor(() => expect(screen.getByText('Painel Financeiro')).toBeInTheDocument());
    fireEvent.change(container.querySelector('input[type="month"]') as HTMLInputElement, { target: { value: FX.month } });
    await waitFor(() => expect(screen.getByText('R$ 500.00')).toBeInTheDocument());
  });

  it('com outro valor de Day Card só o convidado muda; os pagamentos de alunos não', async () => {
    const { container } = mount({ dayCardPriceCents: 7000 });
    await waitFor(() => expect(screen.getByText('Painel Financeiro')).toBeInTheDocument());
    fireEvent.change(container.querySelector('input[type="month"]') as HTMLInputElement, { target: { value: FX.month } });
    await waitFor(() => expect(screen.getByText('R$ 520.00')).toBeInTheDocument()); // 70 + 450
    expect(screen.getByText('R$ 450.00')).toBeInTheDocument();
  });
});
