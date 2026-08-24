import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReservationDetails } from '../components/Agenda';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import type { Match, Reservation, User } from '../types';

vi.mock('../lib/supabase', () => ({
    supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

/** Captura a partida entregue ao marcador ao vivo, que é o objeto sob suspeita. */
const partidasRecebidas: Match[] = [];
vi.mock('../components/LiveScoreboard', () => ({
    LiveScoreboard: ({ match }: { match: Match }) => {
        partidasRecebidas.push(match);
        return <div data-testid="live-scoreboard" />;
    },
}));

const currentUser: User = {
    id: 'user-admin',
    name: 'Admin',
    email: 'admin@example.com',
    phone: '',
    role: 'admin',
    balance: 0,
    isActive: true,
};

const reservaDeCampeonato: Reservation = {
    id: 'match_j5',
    matchId: 'match-j5',
    type: 'Campeonato',
    date: '2026-08-20',
    startTime: '20:00',
    endTime: '21:30',
    courtId: 'court-1',
    creatorId: 'system',
    participantIds: ['user-thieslley', 'user-diego'],
    participantNames: ['Thieslley Soares', 'Diego Memória'],
    participantAvatars: [null, null],
    scoreA: [0, 0],
    scoreB: [0, 0],
    matchStatus: 'pending',
    matchWinnerId: null,
    matchIsWalkover: false,
    matchRegistrationAId: 'reg-thieslley',
    matchRegistrationBId: 'reg-diego',
    matchWalkoverWinnerRegistrationId: null,
    observation: 'Open da Galera 2026 | Quartas',
    status: 'active',
};

const noop = () => { };

function renderDetails() {
    return render(
        <ConfirmProvider>
            <ReservationDetails
                res={reservaDeCampeonato}
                currentUser={currentUser}
                profiles={[]}
                courts={[{ id: 'court-1', name: 'Quadra 1', type: 'Saibro' } as any]}
                professors={[]}
                nonSocioStudents={[]}
                onClose={noop}
                onEdit={noop}
                onCancel={noop}
                onJoin={noop}
                onLeave={noop}
                onUpdate={noop}
            />
        </ConfirmProvider>
    );
}

beforeEach(() => {
    partidasRecebidas.length = 0;
    vi.useFakeTimers();
    // 20h30 em Fortaleza (UTC-3) — meia hora depois do início do jogo.
    vi.setSystemTime(new Date('2026-08-20T23:30:00Z'));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Agenda — placar ao vivo de partida de campeonato', () => {
    /**
     * A regressão que travou a chave: a Agenda montava a partida com
     * `registration_a_id: undefined` escrito na mão, mesmo já tendo as
     * inscrições em mãos na própria reserva.
     */
    it('entrega as inscrições ao marcador, para o vencedor poder avançar', () => {
        renderDetails();

        expect(partidasRecebidas).toHaveLength(1);
        expect(partidasRecebidas[0]).toMatchObject({
            id: 'match-j5',
            registration_a_id: 'reg-thieslley',
            registration_b_id: 'reg-diego',
        });
    });
});
