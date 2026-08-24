import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchScheduleModal } from '../components/MatchScheduleModal';
import type { Court, Match } from '../types';

const courts: Court[] = [
    { id: 'saibro-1', name: 'Quadra Saibro', type: 'Saibro', isActive: true },
    { id: 'rapida-1', name: 'Quadra Rápida', type: 'Rápida', isActive: true },
    { id: 'rapida-2', name: 'Quadra Rápida 2', type: 'Rapida', isActive: true },
    { id: 'saibro-off', name: 'Saibro Interditada', type: 'Saibro', isActive: false },
];

const match: Match = { id: 'm1', type: 'Campeonato', scoreA: [], scoreB: [] };

function renderModal(className: string, onClose = vi.fn()) {
    render(
        <MatchScheduleModal
            match={match}
            roundName="Qualificatórias"
            roundStartDate="2026-08-27"
            roundEndDate="2026-08-29"
            className={className}
            courts={courts}
            onSchedule={vi.fn()}
            onClose={onClose}
        />
    );
    return { onClose };
}


describe('MatchScheduleModal — quadra por classe', () => {
    /** Só a 4ª joga no saibro. */
    it('oferece apenas o saibro para a 4ª Classe', () => {
        renderModal('4ª Classe');

        expect(screen.getByText('Quadra Saibro')).toBeInTheDocument();
        expect(screen.queryByText('Quadra Rápida')).not.toBeInTheDocument();
    });

    it('oferece apenas as rápidas para a 5ª Classe', () => {
        renderModal('5ª Classe');

        expect(screen.getByText('Quadra Rápida')).toBeInTheDocument();
        expect(screen.getByText('Quadra Rápida 2')).toBeInTheDocument();
        expect(screen.queryByText('Quadra Saibro')).not.toBeInTheDocument();
    });

    it('mantém a 6ª Classe na rápida', () => {
        renderModal('6ª Classe');

        expect(screen.getByText('Quadra Rápida')).toBeInTheDocument();
        expect(screen.queryByText('Quadra Saibro')).not.toBeInTheDocument();
    });

    it('deixa as classes sem restrição escolherem qualquer quadra ativa', () => {
        renderModal('1ª Classe');

        expect(screen.getByText('Quadra Saibro')).toBeInTheDocument();
        expect(screen.getByText('Quadra Rápida')).toBeInTheDocument();
    });

    it('nunca oferece quadra interditada', () => {
        renderModal('4ª Classe');

        expect(screen.queryByText('Saibro Interditada')).not.toBeInTheDocument();
    });
});

describe('MatchScheduleModal — modal no celular', () => {
    /**
     * Norman: a saída precisa estar visível. Num sheet que ocupa 90% da tela
     * sobra uma faixa fina de fundo, e fechar dependia de acertar essa faixa ou
     * de um teclado que o celular não tem.
     */
    it('tem botão de fechar visível', () => {
        const onClose = vi.fn();
        renderModal('4ª Classe', onClose);

        fireEvent.click(screen.getByRole('button', { name: /fechar/i }));

        expect(onClose).toHaveBeenCalled();
    });

    /**
     * Krug: a legenda embaixo explicava o agrupamento que a grade deveria
     * mostrar. Agora os períodos são o próprio agrupamento.
     */
    it('agrupa os horários por período, em vez de explicá-los numa legenda', () => {
        renderModal('4ª Classe');

        expect(screen.getByText(/Manhã/i)).toBeInTheDocument();
        expect(screen.getByText(/Tarde/i)).toBeInTheDocument();
        expect(screen.getByText(/Noite/i)).toBeInTheDocument();
        expect(screen.queryByText(/Manhã \(6h-7h\) • Tarde/i)).not.toBeInTheDocument();
    });

    it('respeita o alvo de toque de 44 px nos horários', () => {
        renderModal('4ª Classe');

        const seisHoras = screen.getByRole('button', { name: '06:00' });
        expect(seisHoras.className).toContain('hit-target-44');
    });

    it('mantém o horário selecionável', () => {
        renderModal('4ª Classe');
        const slot = screen.getByRole('button', { name: '19:30' });

        fireEvent.click(slot);

        expect(slot).toHaveAttribute('aria-pressed', 'true');
    });
});
