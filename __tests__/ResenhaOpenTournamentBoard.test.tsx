import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    scheduled_date: overrides.scheduled_date ?? null,
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

    it('switches to 5ª Classe and shows only the sets that were played', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);

        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));

        expect(screen.getAllByText('Davi Arcelino')).toHaveLength(2);
        expect(screen.getByLabelText('Placar set 1: Davi Arcelino 6, Williams Santos 4')).toBeInTheDocument();
        expect(screen.getByLabelText('Placar set 2: Davi Arcelino 6, Williams Santos 3')).toBeInTheDocument();
        // O terceiro set não foi jogado: a coluna não existe, no lugar dos
        // traços que faziam todo cartão parecer ter dados.
        expect(screen.queryByLabelText(/set 3/)).not.toBeInTheDocument();
    });

    it('carrega o número do jogo e o horário dentro do cartão, não pendurados fora', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);

        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));
        const cartao = screen.getByRole('button', { name: /^Jogo 1,/ });

        expect(within(cartao).getByText('J1 · Oitavas')).toBeInTheDocument();
    });

    it('mostra o dia da semana e a data curta na faixa do cartão', () => {
        const comData = [
            ...bracket,
            baseMatch({
                bracket_class: '5ª Classe', match_number: 4,
                registration_a_id: 'a4', registration_b_id: 'b4',
                player_a_label: 'Ítalo Cangussú', player_b_label: 'Diego Parente',
                scheduled_date: '2026-08-26',
            }),
        ];
        render(<ResenhaOpenTournamentBoard bracket={comData} championshipName="Resenha Open 2026" />);

        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));
        const cartao = screen.getByRole('button', { name: /^Jogo 4,/ });

        expect(within(cartao).getByText('J4 · Qua 26/08')).toBeInTheDocument();
    });

    it('cai para o nome da fase quando o jogo não tem data marcada', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);

        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));
        const cartao = screen.getByRole('button', { name: /^Jogo 1,/ });

        expect(within(cartao).getByText('J1 · Oitavas')).toBeInTheDocument();
    });

    it('mostra relógio no lugar do placar quando o jogo ainda não começou', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);

        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));
        const porJogar = screen.getByRole('button', { name: /^Jogo 2,/ });

        expect(within(porJogar).queryByLabelText(/Placar set/)).not.toBeInTheDocument();
        expect(within(porJogar).getByTestId('aguardando')).toBeInTheDocument();
    });

    it('marca como ao vivo a partida com placar lançado e ainda em aberto', () => {
        const comJogoAoVivo = [
            ...bracket,
            baseMatch({
                bracket_class: '5ª Classe', match_number: 3,
                registration_a_id: 'a3', registration_b_id: 'b3',
                player_a_label: 'Derlan', player_b_label: 'Ealber Luna',
                score_a: [6, 3], score_b: [4, 4],
            }),
        ];
        render(<ResenhaOpenTournamentBoard bracket={comJogoAoVivo} championshipName="Resenha Open 2026" />);

        fireEvent.click(screen.getByRole('button', { name: '5ª Classe' }));
        const aoVivo = screen.getByRole('button', { name: /^Jogo 3,/ });

        expect(within(aoVivo).getByText('Ao vivo')).toBeInTheDocument();
    });

    /**
     * `backdrop-blur` dentro do contêiner que rola repinta a cada quadro do
     * arrasto. A dica precisa ficar fora do scroller.
     */
    it('mantém a dica desfocada fora do contêiner que rola', () => {
        const { container } = render(
            <ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />
        );

        const scroller = container.querySelector('[data-bracket-viewport]');
        const dica = screen.getByText(/Arraste para navegar/);

        expect(scroller).not.toBeNull();
        expect(scroller!.contains(dica)).toBe(false);
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

    it('oferece exportar a chave como imagem', () => {
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Resenha Open 2026" />);

        expect(screen.getByRole('button', { name: /exportar (\d+ )?image(m|ns)/i })).toBeInTheDocument();
    });

    /**
     * O modo de exportação é a cópia montada fora da tela: uma classe fixa, em
     * tamanho real, sem nada que só serve para navegar.
     */
    describe('modo de exportação', () => {
        it('desenha a classe pedida sem os controles de navegação', () => {
            render(
                <ResenhaOpenTournamentBoard
                    bracket={bracket}
                    championshipName="Resenha Open 2026"
                    exportClass="5ª Classe"
                />
            );

            expect(screen.getByText('Lucas Rodrigues')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Aumentar zoom' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: '4ª Classe' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /exportar (\d+ )?image(m|ns)/i })).not.toBeInTheDocument();
            expect(screen.queryByText(/Arraste para navegar/)).not.toBeInTheDocument();
        });

        it('escreve a classe no título, já que não há mais abas para dizer qual é', () => {
            render(
                <ResenhaOpenTournamentBoard
                    bracket={bracket}
                    championshipName="Resenha Open 2026"
                    exportClass="5ª Classe"
                />
            );

            // Preso ao bloco do título: sem isso o teste passaria só porque o
            // texto "5ª Classe" existe em algum outro lugar da tela.
            const titulo = screen.getByRole('heading', { name: 'Resenha Open 2026' });
            expect(within(titulo.parentElement!).getByText('5ª Classe')).toBeInTheDocument();
        });

        it('não rola nem escala: a chave sai inteira', () => {
            const { container } = render(
                <ResenhaOpenTournamentBoard
                    bracket={bracket}
                    championshipName="Resenha Open 2026"
                    exportClass="5ª Classe"
                />
            );

            const viewport = container.querySelector('[data-bracket-viewport]') as HTMLElement;
            expect(viewport.className).not.toContain('overflow-auto');
            expect(container.querySelector('.origin-top-left')?.getAttribute('style'))
                .toContain('scale(1)');
        });
    });
});
