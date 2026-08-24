import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentBracketView } from '../components/TournamentBracketView';
import { fetchBracket } from '../lib/resenhaOpenService';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';

vi.mock('../lib/resenhaOpenService', () => ({ fetchBracket: vi.fn() }));

vi.mock('../lib/supabase', () => ({
    supabase: {
        channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
        removeChannel: vi.fn(),
    },
}));

const jogo = (scheduledDate: string): BracketMatchWithPhase[] => ([{
    id: 'j1',
    match_number: 1,
    registration_a_id: 'a',
    registration_b_id: 'b',
    player_a_label: 'Carlos Carneiro',
    player_b_label: 'Hermeson Veras',
    status: 'pending',
    winner_registration_id: null,
    is_walkover: false,
    round_phase: 'qualify',
    bracket_class: '4ª Classe',
    scheduled_date: scheduledDate,
    scheduled_time: '19:30:00',
    score_a: [],
    score_b: [],
}]);

beforeEach(() => vi.clearAllMocks());

describe('TournamentBracketView', () => {
    /**
     * O quadro tem estado próprio, separado do da tela de campeonatos. Quando o
     * admin reagenda pelo modal, quem se atualiza é a tela — o quadro ficava
     * mostrando a data antiga, e a inscrição realtime não salva: a tabela
     * `matches` não está publicada para realtime no banco.
     */
    it('relê a chave quando o token de atualização muda', async () => {
        vi.mocked(fetchBracket).mockResolvedValue(jogo('2026-08-26'));

        const { rerender } = render(
            <TournamentBracketView championshipId="c1" championshipName="Open" refreshToken={0} />
        );
        expect(await screen.findByText('Qua 26/08', { exact: false })).toBeInTheDocument();

        vi.mocked(fetchBracket).mockResolvedValue(jogo('2026-08-25'));
        rerender(<TournamentBracketView championshipId="c1" championshipName="Open" refreshToken={1} />);

        await waitFor(() => expect(fetchBracket).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('Ter 25/08', { exact: false })).toBeInTheDocument();
    });

    it('não relê à toa quando nada mudou', async () => {
        vi.mocked(fetchBracket).mockResolvedValue(jogo('2026-08-26'));

        const { rerender } = render(
            <TournamentBracketView championshipId="c1" championshipName="Open" refreshToken={3} />
        );
        await waitFor(() => expect(fetchBracket).toHaveBeenCalledTimes(1));

        rerender(<TournamentBracketView championshipId="c1" championshipName="Open nome novo" refreshToken={3} />);

        await waitFor(() => expect(fetchBracket).toHaveBeenCalledTimes(1));
    });

    /** Reler não pode piscar a tela inteira: o admin perde o lugar na chave. */
    it('não volta para o estado de carregando ao reler', async () => {
        vi.mocked(fetchBracket).mockResolvedValue(jogo('2026-08-26'));

        const { rerender, container } = render(
            <TournamentBracketView championshipId="c1" championshipName="Open" refreshToken={0} />
        );
        await screen.findByText('Carlos Carneiro');

        rerender(<TournamentBracketView championshipId="c1" championshipName="Open" refreshToken={1} />);

        expect(container.querySelector('.animate-spin')).toBeNull();
        expect(screen.getByText('Carlos Carneiro')).toBeInTheDocument();
    });
});
