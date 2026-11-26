import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChampionshipMatchActionModal } from '../components/ChampionshipMatchActionModal';
import type { Match } from '../types';

const registrations = [
    { id: 'r-a', participant_type: 'guest' as const, guest_name: 'Ana', class: '4ª Classe' },
    { id: 'r-b', participant_type: 'guest' as const, guest_name: 'Bia', class: '4ª Classe' },
];

const pendente: Match = {
    id: 'm1', type: 'Campeonato', scoreA: [], scoreB: [], status: 'pending',
    registration_a_id: 'r-a', registration_b_id: 'r-b', match_number: 1,
};

const publicado: Match = {
    ...pendente, status: 'finished', scoreA: [6, 6], scoreB: [2, 3], winner_registration_id: 'r-a',
};

function renderModal(match: Match, isAdmin: boolean, onLaunch = vi.fn()) {
    render(
        <ChampionshipMatchActionModal
            match={match}
            registrations={registrations}
            roundName="Oitavas"
            className="4ª Classe"
            isAdmin={isAdmin}
            currentUserId="u1"
            scheduleMode="schedule"
            onClose={vi.fn()}
            onLaunch={onLaunch}
        />
    );
    return { onLaunch };
}

describe('ChampionshipMatchActionModal: placar publicado', () => {
    it('o admin edita o placar de uma partida finalizada', () => {
        const { onLaunch } = renderModal(publicado, true);
        fireEvent.click(screen.getByRole('button', { name: /editar placar/i }));
        expect(onLaunch).toHaveBeenCalledTimes(1);
    });

    it('o atleta não edita placar já publicado', () => {
        renderModal(publicado, false);
        expect(screen.queryByRole('button', { name: /editar placar|lançar/i })).toBeNull();
    });

    it('partida pendente continua com "Lançar"', () => {
        renderModal(pendente, false);
        expect(screen.getByRole('button', { name: /lançar/i })).toBeTruthy();
    });
});
