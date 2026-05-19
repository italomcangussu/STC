import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResenhaOpenTournamentBoard } from '../components/ResenhaOpenTournamentBoard';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';

const baseMatch = (overrides: Partial<BracketMatchWithPhase>): BracketMatchWithPhase => ({
    id: `m-${overrides.bracket_class ?? '5ª Classe'}-${overrides.match_number ?? 1}`,
    match_number: overrides.match_number ?? 1,
    registration_a_id: overrides.registration_a_id ?? 'a1',
    registration_b_id: overrides.registration_b_id ?? 'b1',
    player_a_label: overrides.player_a_label ?? 'Davi Arcelino',
    player_b_label: overrides.player_b_label ?? 'Williams Santos',
    status: overrides.status ?? 'pending',
    winner_registration_id: overrides.winner_registration_id ?? null,
    is_walkover: overrides.is_walkover ?? false,
    round_phase: overrides.round_phase ?? 'oitavas',
    bracket_class: overrides.bracket_class ?? '5ª Classe',
    player_a_source_match_number: overrides.player_a_source_match_number,
    player_b_source_match_number: overrides.player_b_source_match_number,
    score_a: overrides.score_a ?? [],
    score_b: overrides.score_b ?? [],
});

const bracket: BracketMatchWithPhase[] = [
    baseMatch({ bracket_class: '5ª Classe', match_number: 1, score_a: [6, 6], score_b: [4, 3], status: 'finished', winner_registration_id: 'a1' }),
    baseMatch({
        bracket_class: '5ª Classe',
        match_number: 2,
        registration_a_id: 'a2',
        registration_b_id: 'b2',
        player_a_label: 'Lucas Rodrigues',
        player_b_label: 'Macel Ponte',
    }),
    baseMatch({
        bracket_class: '5ª Classe',
        match_number: 9,
        registration_a_id: null,
        registration_b_id: null,
        player_a_label: 'Davi Arcelino',
        player_b_label: 'Vencedor Jogo 2',
        round_phase: 'quartas',
        player_a_source_match_number: 1,
        player_b_source_match_number: 2,
    }),
    baseMatch({
        bracket_class: '4ª Classe',
        match_number: 1,
        round_phase: 'preliminar',
        player_a_label: 'Hernades Soares',
        player_b_label: 'Claudio Sergio',
    }),
];

describe('ResenhaOpenTournamentBoard', () => {
    it('renders the internal class switch and defaults to 4ª Classe when available', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);

        expect(screen.getByRole('button', { name: '4ª Classe' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Hernades Soares')).toBeInTheDocument();
    });

    it('switches to 5ª Classe and renders compact three-set score columns', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);

        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));

        expect(screen.getAllByText('Davi Arcelino')).toHaveLength(2);
        expect(screen.getByLabelText('Placar set 1: Davi Arcelino 6, Williams Santos 4')).toBeInTheDocument();
        expect(screen.getAllByLabelText('Placar set 3: não disputado')).toHaveLength(3);
    });

    it('selects a match and exposes zoom controls', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);

        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));
        fireEvent.click(screen.getByRole('button', { name: /Jogo 1/ }));

        expect(screen.getByRole('button', { name: /Jogo 1/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Aumentar zoom' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reduzir zoom' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Resetar zoom' })).toBeInTheDocument();
    });
});
