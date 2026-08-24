/**
 * Laboratório temporário — NÃO faz parte do app.
 *
 * Monta a Tabela de Confrontos real com os dados reais do Open da Galera 2026,
 * fora do login, para poder olhar e medir o componente no navegador.
 * Apagar quando a avaliação de design terminar.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ResenhaOpenTournamentBoard } from './components/ResenhaOpenTournamentBoard';
import type { BracketMatchWithPhase } from './lib/resenhaOpenService';

type Row = Partial<BracketMatchWithPhase> & {
    n: number;
    phase: string;
    classe: string;
    a: string;
    b: string;
};

const mk = (row: Row): BracketMatchWithPhase => ({
    id: `${row.classe}-${row.n}`,
    match_number: row.n,
    registration_a_id: row.a.startsWith('Vencedor') ? null : `reg-a-${row.classe}-${row.n}`,
    registration_b_id: row.b.startsWith('Vencedor') ? null : `reg-b-${row.classe}-${row.n}`,
    player_a_label: row.a,
    player_b_label: row.b,
    player_a_source_match_number: row.player_a_source_match_number,
    player_b_source_match_number: row.player_b_source_match_number,
    status: row.status ?? 'pending',
    winner_registration_id: row.winner_registration_id ?? null,
    is_walkover: row.is_walkover ?? false,
    round_phase: row.phase,
    bracket_class: row.classe,
    scheduled_date: '2026-08-20',
    scheduled_time: row.scheduled_time ?? null,
    score_a: row.score_a ?? [],
    score_b: row.score_b ?? [],
});

const bracket: BracketMatchWithPhase[] = [
    // ── 4ª Classe ────────────────────────────────────────────────────────────
    mk({ n: 1, phase: 'qualify', classe: '4ª Classe', a: 'Carlos Carneiro', b: 'Hermeson Veras', scheduled_time: '19:30:00' }),
    mk({ n: 2, phase: 'quartas', classe: '4ª Classe', a: 'Mario Rego', b: 'Vencedor Jogo 1', scheduled_time: '18:30:00', player_b_source_match_number: 1 }),
    mk({ n: 3, phase: 'quartas', classe: '4ª Classe', a: 'Tiago Gomes', b: 'Henrique Coelho', scheduled_time: '19:30:00' }),
    mk({ n: 4, phase: 'quartas', classe: '4ª Classe', a: 'Marcelo Sampieri', b: 'Flavio', scheduled_time: '20:00:00' }),
    mk({
        n: 5, phase: 'quartas', classe: '4ª Classe', a: 'Thieslley Soares', b: 'Diego Memória',
        scheduled_time: '20:00:00', status: 'finished', winner_registration_id: 'reg-a-4ª Classe-5',
        score_a: [6, 6], score_b: [1, 3],
    }),
    mk({ n: 6, phase: 'semifinal', classe: '4ª Classe', a: 'Vencedor Jogo 2', b: 'Vencedor Jogo 3', scheduled_time: '18:30:00', player_a_source_match_number: 2, player_b_source_match_number: 3 }),
    mk({ n: 7, phase: 'semifinal', classe: '4ª Classe', a: 'Vencedor Jogo 4', b: 'Thieslley Soares', scheduled_time: '19:30:00', player_a_source_match_number: 4, player_b_source_match_number: 5 }),
    mk({ n: 8, phase: 'final', classe: '4ª Classe', a: 'Vencedor Jogo 6', b: 'Vencedor Jogo 7', scheduled_time: '17:30:00', player_a_source_match_number: 6, player_b_source_match_number: 7 }),

    // ── 5ª Classe ────────────────────────────────────────────────────────────
    mk({
        n: 1, phase: 'qualify', classe: '5ª Classe', a: 'Mailson Freitas', b: 'Renan',
        scheduled_time: '20:00:00', status: 'finished', winner_registration_id: 'reg-a-5ª Classe-1',
        score_a: [6, 6], score_b: [1, 2],
    }),
    mk({ n: 2, phase: 'qualify', classe: '5ª Classe', a: 'Lucas Rodrigues', b: 'Thiago Coelho' }),
    mk({ n: 3, phase: 'quartas', classe: '5ª Classe', a: 'Davi Arcelino', b: 'Mailson Freitas', scheduled_time: '18:30:00', player_b_source_match_number: 1 }),
    mk({ n: 4, phase: 'quartas', classe: '5ª Classe', a: 'Derlan', b: 'Vinicius Cangussú', scheduled_time: '19:30:00' }),
    mk({ n: 5, phase: 'quartas', classe: '5ª Classe', a: 'Ítalo Cangussú', b: 'Vencedor Jogo 2', scheduled_time: '20:00:00', player_b_source_match_number: 2 }),
    mk({ n: 6, phase: 'quartas', classe: '5ª Classe', a: 'Diego Parente', b: 'Ealber Luna', scheduled_time: '21:00:00' }),
    mk({ n: 7, phase: 'semifinal', classe: '5ª Classe', a: 'Vencedor Jogo 3', b: 'Vencedor Jogo 4', scheduled_time: '19:30:00', player_a_source_match_number: 3, player_b_source_match_number: 4 }),
    mk({ n: 8, phase: 'semifinal', classe: '5ª Classe', a: 'Vencedor Jogo 5', b: 'Vencedor Jogo 6', scheduled_time: '19:30:00', player_a_source_match_number: 5, player_b_source_match_number: 6 }),
    mk({ n: 9, phase: 'final', classe: '5ª Classe', a: 'Vencedor Jogo 7', b: 'Vencedor Jogo 8', scheduled_time: '17:30:00', player_a_source_match_number: 7, player_b_source_match_number: 8 }),
];

/** Encerra o J4 da 4ª Classe, para ver o avanço do vencedor acontecer. */
function encerrarJ4(atual: BracketMatchWithPhase[]): BracketMatchWithPhase[] {
    const vencedor = atual.find(m => m.id === '4ª Classe-4')!.registration_a_id;
    return atual.map(m => {
        if (m.id === '4ª Classe-4') {
            return { ...m, status: 'finished' as const, winner_registration_id: vencedor, score_a: [6, 7], score_b: [4, 5] };
        }
        // O que o trigger do banco faz: promove o vencedor para a vaga do J7.
        if (m.id === '4ª Classe-7') {
            return { ...m, registration_a_id: vencedor, player_a_label: 'Marcelo Sampieri' };
        }
        return m;
    });
}

/** Coloca o J3 da 4ª Classe em andamento, para ver o estado "ao vivo". */
function porJ3AoVivo(atual: BracketMatchWithPhase[]): BracketMatchWithPhase[] {
    return atual.map(m =>
        m.id === '4ª Classe-3' ? { ...m, score_a: [6, 3], score_b: [4, 4] } : m
    );
}

const Lab: React.FC = () => {
    const [dados, setDados] = React.useState(bracket);

    return (
        <div className="min-h-dvh bg-stone-100 py-6 px-4 overflow-x-hidden">
            <div className="mx-auto mb-4 flex max-w-7xl flex-wrap gap-2">
                <button
                    onClick={() => setDados(encerrarJ4)}
                    className="rounded-full bg-saibro-600 px-4 py-2 text-xs font-black text-white"
                >
                    Encerrar J4 (ver avanço)
                </button>
                <button
                    onClick={() => setDados(porJ3AoVivo)}
                    className="rounded-full bg-slate-800 px-4 py-2 text-xs font-black text-white"
                >
                    Pôr J3 ao vivo
                </button>
                <button
                    onClick={() => setDados(bracket)}
                    className="rounded-full bg-slate-200 px-4 py-2 text-xs font-black text-slate-700"
                >
                    Resetar
                </button>
            </div>
            <ResenhaOpenTournamentBoard bracket={dados} championshipName="Open da Galera 2026" />
        </div>
    );
};

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Lab />
    </React.StrictMode>
);
