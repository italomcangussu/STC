import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResenhaOpenTournamentBoard } from '../components/ResenhaOpenTournamentBoard';
import { captureNodeToPng, shareOrDownload } from '../lib/bracketImageExport';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';

vi.mock('../lib/bracketImageExport', async (importOriginal) => {
    const real = await importOriginal<typeof import('../lib/bracketImageExport')>();
    return {
        ...real,
        createExportHost: vi.fn(() => {
            const host = document.createElement('div');
            host.setAttribute('data-bracket-export-host', '');
            document.body.appendChild(host);
            return host;
        }),
        waitForPaint: vi.fn(async () => undefined),
        captureNodeToPng: vi.fn(async (_node: HTMLElement, fileName: string) =>
            new File([new Uint8Array([1])], fileName, { type: 'image/png' })),
        shareOrDownload: vi.fn(async () => 'shared' as const),
    };
});

vi.mock('../lib/notifications', () => ({
    notify: { success: vi.fn(), failure: vi.fn(), warning: vi.fn() },
}));

const match = (over: Partial<BracketMatchWithPhase>): BracketMatchWithPhase => ({
    id: `${over.bracket_class}-${over.match_number}`,
    match_number: over.match_number ?? 1,
    registration_a_id: 'a', registration_b_id: 'b',
    player_a_label: 'Atleta A', player_b_label: 'Atleta B',
    status: 'pending', winner_registration_id: null, is_walkover: false,
    round_phase: 'quartas', bracket_class: over.bracket_class,
    scheduled_date: null, scheduled_time: null, score_a: [], score_b: [],
    ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('exportar imagem da chave', () => {
    /** O pedido é explícito: duas classes inscritas, duas imagens. */
    it('gera uma imagem por classe e entrega todas de uma vez', async () => {
        const bracket = [
            match({ bracket_class: '4ª Classe', match_number: 1 }),
            match({ bracket_class: '5ª Classe', match_number: 2 }),
        ];
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Open da Galera 2026" />);

        fireEvent.click(screen.getByRole('button', { name: /exportar (\d+ )?image(m|ns)/i }));

        await waitFor(() => expect(shareOrDownload).toHaveBeenCalled());

        expect(captureNodeToPng).toHaveBeenCalledTimes(2);
        expect(vi.mocked(captureNodeToPng).mock.calls.map(c => c[1])).toEqual([
            'open-da-galera-2026-4a-classe.png',
            'open-da-galera-2026-5a-classe.png',
        ]);

        const [files] = vi.mocked(shareOrDownload).mock.calls[0];
        expect(files.map(f => f.name)).toEqual([
            'open-da-galera-2026-4a-classe.png',
            'open-da-galera-2026-5a-classe.png',
        ]);
    });

    it('gera três imagens quando o campeonato tem três classes', async () => {
        const bracket = [
            match({ bracket_class: '4ª Classe', match_number: 1 }),
            match({ bracket_class: '5ª Classe', match_number: 2 }),
            match({ bracket_class: 'Feminino', match_number: 3 }),
        ];
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Open" />);

        fireEvent.click(screen.getByRole('button', { name: /exportar (\d+ )?image(m|ns)/i }));

        await waitFor(() => expect(shareOrDownload).toHaveBeenCalled());
        expect(vi.mocked(shareOrDownload).mock.calls[0][0]).toHaveLength(3);
    });

    it('não deixa o botão preso em "Gerando…" quando a captura falha', async () => {
        vi.mocked(captureNodeToPng).mockRejectedValueOnce(new Error('sem canvas'));
        const bracket = [match({ bracket_class: '4ª Classe', match_number: 1 })];
        render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Open" />);

        fireEvent.click(screen.getByRole('button', { name: /exportar (\d+ )?image(m|ns)/i }));

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /exportar (\d+ )?image(m|ns)/i })).not.toBeDisabled()
        );
        expect(shareOrDownload).not.toHaveBeenCalled();
    });

    it('limpa as cópias fora da tela mesmo quando a captura falha', async () => {
        vi.mocked(captureNodeToPng).mockRejectedValueOnce(new Error('sem canvas'));
        const bracket = [match({ bracket_class: '4ª Classe', match_number: 1 })];
        const { container } = render(<ResenhaOpenTournamentBoard bracket={bracket} championshipName="Open" />);

        fireEvent.click(screen.getByRole('button', { name: /exportar (\d+ )?image(m|ns)/i }));

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /exportar (\d+ )?image(m|ns)/i })).not.toBeDisabled()
        );
        // A cópia fora da tela precisa sumir mesmo no caminho de erro: senão
        // cada tentativa frustrada deixa uma chave inteira pendurada no DOM.
        expect(document.querySelectorAll('[data-bracket-export-host]')).toHaveLength(0);
        expect(container.isConnected).toBe(true);
    });

    /**
     * A contagem no botão é diagnóstico: se o quadro só enxergar uma classe, o
     * usuário vê isso antes de exportar, em vez de descobrir depois que só veio
     * uma imagem e não saber se falhou a captura ou a entrega.
     */
    it('diz no botão quantas imagens vai gerar', () => {
        const duas = [
            match({ bracket_class: '4ª Classe', match_number: 1 }),
            match({ bracket_class: '5ª Classe', match_number: 2 }),
        ];
        render(<ResenhaOpenTournamentBoard bracket={duas} championshipName="Open" />);

        expect(screen.getByRole('button', { name: /exportar 2 imagens/i })).toBeInTheDocument();
    });

    it('fala no singular quando o campeonato tem uma classe só', () => {
        const uma = [match({ bracket_class: '4ª Classe', match_number: 1 })];
        render(<ResenhaOpenTournamentBoard bracket={uma} championshipName="Open" />);

        expect(screen.getByRole('button', { name: /^exportar imagem da chave$/i })).toBeInTheDocument();
    });
});
