/**
 * A quadra que o sócio escolhe é a quadra que a reserva recebe.
 *
 * O modal fica aberto enquanto a agenda escuta o realtime: qualquer reserva,
 * jogo ou desafio criado no clube refaz o array `courts`. Enquanto o efeito de
 * padrões dependia dessa identidade, ele reaplicava o saibro por cima da
 * Quadra Rápida que o sócio tinha acabado de escolher.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AddReservationModal } from '../components/Agenda';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import type { User } from '../types';

/** `Agenda.tsx` usa uma forma própria de quadra, mais estrita que a de `types.ts`. */
type AgendaCourt = { id: string; name: string; type: string; isActive: boolean };

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

afterEach(cleanup);

const SAIBRO = '987e8d30-2e98-4211-9f8c-db7ab1500c7b';
const RAPIDA = 'd0dd4044-6d1d-477a-a1a6-ad81746260db';

/** Cada chamada devolve um array novo — é isso que o realtime faz. */
const freshCourts = (): AgendaCourt[] => [
    { id: RAPIDA, name: 'Quadra Rápida', type: 'Rápida', isActive: true },
    { id: SAIBRO, name: 'Quadra Saibro', type: 'Saibro', isActive: true },
];

const socio: User = {
    id: 'u1',
    name: 'Ítalo',
    email: '',
    phone: '',
    role: 'socio',
    balance: 0,
} as User;

function renderModal(courts: AgendaCourt[]) {
    const view = render(
        <ConfirmProvider>
            <AddReservationModal
                onClose={vi.fn()}
                onSave={vi.fn()}
                currentUser={socio}
                profiles={[socio]}
                courts={courts}
                professors={[]}
                nonSocioStudents={[]}
                existingReservations={[]}
            />
        </ConfirmProvider>
    );

    const rerenderWith = (next: AgendaCourt[]) =>
        view.rerender(
            <ConfirmProvider>
                <AddReservationModal
                    onClose={vi.fn()}
                    onSave={vi.fn()}
                    currentUser={socio}
                    profiles={[socio]}
                    courts={next}
                    professors={[]}
                    nonSocioStudents={[]}
                    existingReservations={[]}
                />
            </ConfirmProvider>
        );

    return { rerenderWith };
}

/** Passo 1 escolhe o tipo; o seletor de quadra só existe no passo 2. */
function irParaOPasso2() {
    fireEvent.click(screen.getByText('Play Amistoso'));
    fireEvent.click(screen.getByRole('button', { name: /continuar|próximo|avançar/i }));
}

/** O select de quadra é o que lista as quadras — os outros combobox são data e horário. */
function seletorDeQuadra(): HTMLSelectElement {
    const opcao = screen.getByRole('option', { name: /Quadra Saibro/ });
    return opcao.closest('select') as HTMLSelectElement;
}

describe('AddReservationModal — quadra escolhida', () => {
    it('sugere o saibro para o Play, como padrão', () => {
        renderModal(freshCourts());
        irParaOPasso2();

        expect(seletorDeQuadra()).toHaveValue(SAIBRO);
    });

    it('mantém a Quadra Rápida quando a agenda recarrega por trás do modal', () => {
        const { rerenderWith } = renderModal(freshCourts());
        irParaOPasso2();

        fireEvent.change(seletorDeQuadra(), { target: { value: RAPIDA } });
        expect(seletorDeQuadra()).toHaveValue(RAPIDA);

        // Alguém no clube criou uma reserva: o realtime refaz `courts`.
        rerenderWith(freshCourts());
        rerenderWith(freshCourts());

        expect(seletorDeQuadra()).toHaveValue(RAPIDA);
    });
});
