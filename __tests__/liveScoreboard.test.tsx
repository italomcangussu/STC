import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveScoreboard } from '../components/LiveScoreboard';
import { supabase } from '../lib/supabase';
import type { Match, User } from '../types';

vi.mock('../lib/supabase', () => ({
    supabase: { from: vi.fn() },
}));

const admin: User = {
    id: 'user-admin',
    name: 'Admin',
    email: 'admin@example.com',
    phone: '',
    role: 'admin',
    balance: 0,
    isActive: true,
};

const profiles: User[] = [
    { ...admin, id: 'user-thieslley', name: 'Thieslley Soares', role: 'socio' },
    { ...admin, id: 'user-diego', name: 'Diego Memória', role: 'socio' },
];

const partidaDeCampeonato: Match = {
    id: 'match-j5',
    type: 'Campeonato',
    playerAId: 'user-thieslley',
    playerBId: 'user-diego',
    scoreA: [0, 0, 0],
    scoreB: [0, 0, 0],
    status: 'pending',
    registration_a_id: 'reg-thieslley',
    registration_b_id: 'reg-diego',
};

let upsert: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.clearAllMocks();
    upsert = vi.fn(() => ({ select: vi.fn(async () => ({ data: [], error: null })) }));
    (supabase.from as any).mockReturnValue({ upsert });
});

/** Leva o placar a 6/0 6/0 para o jogador A, deixando a partida pronta para salvar. */
function marcarVitoriaDeA() {
    const somar = screen.getAllByRole('button').filter(b => b.querySelector('.lucide-plus'));
    // Dois primeiros grupos de sets pertencem ao jogador A (sets 1 e 2).
    for (let i = 0; i < 6; i++) {
        fireEvent.click(somar[0]);
        fireEvent.click(somar[1]);
    }
}

describe('LiveScoreboard — resultado de campeonato', () => {
    it('grava a inscrição do vencedor, que é o que faz a chave avançar', async () => {
        render(
            <LiveScoreboard match={partidaDeCampeonato} profiles={profiles} currentUser={admin} />
        );

        marcarVitoriaDeA();
        fireEvent.click(screen.getByRole('button', { name: /salvar resultado/i }));

        await waitFor(() => expect(upsert).toHaveBeenCalled());
        expect(upsert.mock.calls[0][0]).toMatchObject({
            id: 'match-j5',
            winner_id: 'user-thieslley',
            winner_registration_id: 'reg-thieslley',
            status: 'finished',
        });
    });

    /**
     * Antes, uma partida sem inscrição era gravada com `winner_registration_id:
     * null`: o placar aparecia certo e a chave ficava parada para sempre.
     */
    it('recusa salvar partida de campeonato sem inscrição, em vez de travar a chave', async () => {
        render(
            <LiveScoreboard
                match={{ ...partidaDeCampeonato, registration_a_id: undefined, registration_b_id: undefined }}
                profiles={profiles}
                currentUser={admin}
            />
        );

        marcarVitoriaDeA();
        fireEvent.click(screen.getByRole('button', { name: /salvar resultado/i }));

        expect(await screen.findByText(/inscrição do vencedor/i)).toBeInTheDocument();
        expect(upsert).not.toHaveBeenCalled();
    });

    it('mantém desafio de ranking salvando sem inscrição', async () => {
        render(
            <LiveScoreboard
                match={{
                    ...partidaDeCampeonato,
                    type: 'Desafio Ranking',
                    registration_a_id: undefined,
                    registration_b_id: undefined,
                }}
                profiles={profiles}
                currentUser={admin}
            />
        );

        marcarVitoriaDeA();
        fireEvent.click(screen.getByRole('button', { name: /salvar resultado/i }));

        await waitFor(() => expect(upsert).toHaveBeenCalled());
        expect(upsert.mock.calls[0][0]).toMatchObject({
            winner_id: 'user-thieslley',
            winner_registration_id: null,
        });
    });
});
