/**
 * Rede de caracterização do `ChampionshipInProgress`.
 *
 * É o maior componente do módulo (CC 162, ~1.200 linhas) e estava em **0% de
 * cobertura** — a combinação exata que a auditoria marcou como "perigoso de
 * mexer E sem rede". Estes testes não julgam o desenho do componente: eles
 * travam o que ele faz hoje, para que quebrá-lo em partes seja refatoração e
 * não aposta.
 *
 * O que cada teste protege está dito no seu nome. Se um deles ficar vermelho
 * durante uma refatoração, o comportamento mudou — não o teste que envelheceu.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../lib/supabase', () => ({
    supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

import { ChampionshipInProgress } from '../components/ChampionshipInProgress';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import { supabase } from '../lib/supabase';
import type { Championship } from '../types';

afterEach(cleanup);

// ── Dados do banco, por tabela ────────────────────────────────────────────────

type Tabela =
    | 'courts'
    | 'championship_rounds'
    | 'championship_groups'
    | 'championship_registrations'
    | 'matches';

let tabelas: Record<Tabela, any[]>;
let apagados: { tabela: string; filtro: unknown }[];

const rodada = (over: Partial<any> = {}) => ({
    id: 'r1',
    championship_id: 'c1',
    round_number: 1,
    name: 'Rodada 1',
    phase: 'grupos',
    class: null,
    start_date: '2026-08-01',
    end_date: '2026-08-07',
    status: 'active',
    ...over,
});

const inscricao = (over: Partial<any> = {}) => ({
    id: 'reg1',
    championship_id: 'c1',
    participant_type: 'socio',
    user_id: 'u1',
    guest_name: null,
    class: '4ª Classe',
    user: { name: 'Ana', avatar_url: null },
    ...over,
});

const partida = (over: Partial<any> = {}) => ({
    id: 'm1',
    championship_id: 'c1',
    round_id: 'r1',
    championship_group_id: null,
    status: 'pending',
    match_number: 1,
    phase: 'grupos',
    registration_a_id: 'reg1',
    registration_b_id: 'reg2',
    player_a_id: 'u1',
    player_b_id: 'u2',
    score_a: [],
    score_b: [],
    winner_id: null,
    scheduled_date: null,
    scheduled_time: null,
    ...over,
});

/**
 * Encadeamento do PostgREST. Cada elo devolve o próprio objeto, e o `then` no
 * fim entrega o que a tabela tem — é assim que o componente consome tudo.
 */
function montarConsulta(tabela: Tabela) {
    const consulta: any = {
        select: vi.fn(() => consulta),
        eq: vi.fn(() => consulta),
        in: vi.fn((_coluna: string, valores: unknown) => {
            if (consulta._apagando) {
                apagados.push({ tabela, filtro: valores });
                return Promise.resolve({ error: null });
            }
            return consulta;
        }),
        order: vi.fn(() => consulta),
        // A aba Chaveamento monta o ResenhaOpenBracketView, que consulta o nome
        // do campeonato com `.single()`. Sem isto a promise rejeita solta e o
        // Vitest avisa que os testes podem virar falso positivo.
        single: vi.fn(() => Promise.resolve({ data: { name: 'Campeonato' }, error: null })),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        update: vi.fn(() => consulta),
        insert: vi.fn(() => Promise.resolve({ error: null })),
        delete: vi.fn(() => { consulta._apagando = true; return consulta; }),
        then: (resolve: (valor: any) => void) =>
            Promise.resolve({ data: tabelas[tabela], error: null }).then(resolve),
    };
    return consulta;
}

const campeonato = (over: Partial<Championship> = {}): Championship => ({
    id: 'c1',
    name: '3º Circuito de Inverno',
    status: 'ongoing',
    format: 'grupo-mata-mata',
    ...over,
} as Championship);

const admin = { id: 'u9', name: 'Admin', role: 'admin' };
const socio = { id: 'u1', name: 'Ana', role: 'socio' };

const montar = (props: Partial<React.ComponentProps<typeof ChampionshipInProgress>> = {}) =>
    render(
        <ConfirmProvider>
            <ChampionshipInProgress
                championship={campeonato()}
                currentUser={admin}
                {...props}
            />
        </ConfirmProvider>
    );

beforeEach(() => {
    vi.clearAllMocks();
    apagados = [];
    tabelas = {
        courts: [{ id: 'q1', name: 'Quadra 1' }],
        championship_rounds: [],
        championship_groups: [],
        championship_registrations: [],
        matches: [],
    };
    vi.mocked(supabase.from).mockImplementation((t: string) => montarConsulta(t as Tabela));
});

// ── Testes ────────────────────────────────────────────────────────────────────

describe('ChampionshipInProgress — antes de haver rodada', () => {
    it('convida a iniciar o campeonato quando ainda não há rodada', async () => {
        montar();

        expect(await screen.findByText('Pronto para Iniciar!')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Iniciar Campeonato Agora/i })).toBeEnabled();
    });

    it('pergunta antes de iniciar — gerar rodadas e partidas não tem botão de desfazer', async () => {
        montar();

        fireEvent.click(await screen.findByRole('button', { name: /Iniciar Campeonato Agora/i }));

        const dialogo = await screen.findByRole('dialog');
        expect(within(dialogo).getByText('Iniciar o campeonato agora?')).toBeInTheDocument();
    });

    it('cancelar o diálogo não escreve nada no banco', async () => {
        montar();

        fireEvent.click(await screen.findByRole('button', { name: /Iniciar Campeonato Agora/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(apagados).toHaveLength(0);
    });
});

describe('ChampionshipInProgress — com rodadas', () => {
    beforeEach(() => {
        tabelas.championship_rounds = [
            rodada({ id: 'r1', round_number: 1, name: 'Rodada 1', status: 'finished' }),
            rodada({ id: 'r2', round_number: 2, name: 'Rodada 2', status: 'active' }),
            rodada({ id: 'r3', round_number: 3, name: 'Rodada 3', status: 'pending' }),
        ];
        tabelas.championship_registrations = [inscricao()];
        tabelas.matches = [partida()];
    });

    it('abre na rodada ativa, não na primeira — é nela que o admin trabalha', async () => {
        montar();

        expect(await screen.findByRole('heading', { name: 'Rodada 2' })).toBeInTheDocument();
    });

    it('navega entre rodadas e trava nos extremos', async () => {
        montar();
        await screen.findByRole('heading', { name: 'Rodada 2' });

        const anterior = screen.getByRole('button', { name: 'Rodada anterior' });
        const proxima = screen.getByRole('button', { name: 'Próxima rodada' });

        fireEvent.click(proxima);
        expect(await screen.findByRole('heading', { name: 'Rodada 3' })).toBeInTheDocument();
        expect(proxima).toBeDisabled();

        fireEvent.click(anterior);
        fireEvent.click(anterior);
        expect(await screen.findByRole('heading', { name: 'Rodada 1' })).toBeInTheDocument();
        expect(anterior).toBeDisabled();
    });

    it('oferece as três abas em campeonato comum', async () => {
        montar();

        expect(await screen.findByRole('button', { name: 'RODADAS' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CLASSIFICAÇÃO' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CHAVEAMENTO' })).toBeInTheDocument();
    });

    it('esconde CLASSIFICAÇÃO no Resenha Open, que é mata-mata puro', async () => {
        montar({ championship: campeonato({ name: 'Resenha Open 2026' }) });

        await screen.findByRole('button', { name: 'RODADAS' });
        expect(screen.queryByRole('button', { name: 'CLASSIFICAÇÃO' })).not.toBeInTheDocument();
    });

    it('avisa o admin quando a rodada está em rascunho, invisível para os sócios', async () => {
        montar();
        await screen.findByRole('heading', { name: 'Rodada 2' });

        // Rodada 2 está ativa; a 3 é a que está pendente.
        fireEvent.click(screen.getByRole('button', { name: 'Próxima rodada' }));

        expect(await screen.findByText('Rodada em Rascunho')).toBeInTheDocument();
    });

    it('não mostra o aviso de rascunho para quem não é admin', async () => {
        tabelas.championship_rounds = [rodada({ status: 'pending' })];
        montar({ currentUser: socio });

        await screen.findByRole('heading', { name: 'Rodada 1' });
        expect(screen.queryByText('Rodada em Rascunho')).not.toBeInTheDocument();
    });
});

describe('ChampionshipInProgress — gerenciamento de confrontos', () => {
    beforeEach(() => {
        tabelas.championship_rounds = [rodada()];
        tabelas.championship_registrations = [inscricao()];
    });

    it('só o admin vê o painel de gerenciamento', async () => {
        montar({ currentUser: socio });

        await screen.findByRole('button', { name: 'RODADAS' });
        expect(screen.queryByText('Gerenciamento de Confrontos')).not.toBeInTheDocument();
    });

    it('desabilita "Limpar Confrontos" quando não há o que apagar', async () => {
        tabelas.matches = [];
        montar();

        expect(await screen.findByRole('button', { name: /Limpar Confrontos/i })).toBeDisabled();
    });

    it('mostra o tamanho do estrago antes de apagar, separando o que já foi jogado', async () => {
        tabelas.matches = [
            partida({ id: 'm1', status: 'finished' }),
            partida({ id: 'm2', status: 'finished' }),
            partida({ id: 'm3', status: 'pending' }),
        ];
        montar();

        fireEvent.click(await screen.findByRole('button', { name: /Limpar Confrontos/i }));

        const dialogo = await screen.findByRole('dialog');
        expect(within(dialogo).getByText('3 confrontos')).toBeInTheDocument();
        expect(within(dialogo).getByText('2 placares já lançados')).toBeInTheDocument();
    });

    it('mostra "0 placares já lançados" em vez de omitir a linha', async () => {
        tabelas.matches = [partida({ status: 'pending' })];
        montar();

        fireEvent.click(await screen.findByRole('button', { name: /Limpar Confrontos/i }));

        const dialogo = await screen.findByRole('dialog');
        expect(within(dialogo).getByText('1 confronto')).toBeInTheDocument();
        expect(within(dialogo).getByText('0 placares já lançados')).toBeInTheDocument();
    });

    it('mantém o botão de apagar travado até a palavra ser digitada', async () => {
        tabelas.matches = [partida()];
        montar();

        fireEvent.click(await screen.findByRole('button', { name: /Limpar Confrontos/i }));
        const dialogo = await screen.findByRole('dialog');
        const apagar = within(dialogo).getByRole('button', { name: 'Apagar confrontos' });

        expect(apagar).toBeDisabled();

        fireEvent.change(within(dialogo).getByLabelText('Digite APAGAR para confirmar'), {
            target: { value: 'APAGAR' },
        });
        expect(apagar).toBeEnabled();
    });

    it('apaga pelas rodadas conhecidas quando o admin confirma', async () => {
        tabelas.matches = [partida()];
        montar();

        fireEvent.click(await screen.findByRole('button', { name: /Limpar Confrontos/i }));
        const dialogo = await screen.findByRole('dialog');
        fireEvent.change(within(dialogo).getByLabelText('Digite APAGAR para confirmar'), {
            target: { value: 'APAGAR' },
        });
        fireEvent.click(within(dialogo).getByRole('button', { name: 'Apagar confrontos' }));

        await waitFor(() => expect(apagados).toEqual([{ tabela: 'matches', filtro: ['r1'] }]));
    });

    it('desistir no diálogo não apaga nada', async () => {
        tabelas.matches = [partida()];
        montar();

        fireEvent.click(await screen.findByRole('button', { name: /Limpar Confrontos/i }));
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(apagados).toHaveLength(0);
    });
});

describe('ChampionshipInProgress — filtro por classe', () => {
    beforeEach(() => {
        tabelas.championship_rounds = [rodada()];
        tabelas.matches = [partida()];
    });

    it('não oferece filtro quando o campeonato tem uma classe só', async () => {
        tabelas.championship_registrations = [inscricao({ class: '4ª Classe' })];
        montar();

        await screen.findByRole('button', { name: 'RODADAS' });
        expect(screen.queryByRole('button', { name: 'TODAS' })).not.toBeInTheDocument();
    });

    it('ordena as classes por número, não por alfabeto — 5ª vem antes de 10ª', async () => {
        tabelas.championship_registrations = [
            inscricao({ id: 'a', class: '10ª Classe' }),
            inscricao({ id: 'b', class: '5ª Classe' }),
            inscricao({ id: 'c', class: '4ª Classe' }),
        ];
        montar();

        await screen.findByRole('button', { name: 'TODAS' });
        const classes = screen.getAllByRole('button')
            .map(b => b.textContent)
            .filter(t => t && /^\d+ª CLASSE$/.test(t));

        // Os rótulos saem em caixa alta; o que se trava aqui é a ordem.
        expect(classes).toEqual(['4ª CLASSE', '5ª CLASSE', '10ª CLASSE']);
    });

    it('ignora inscrição sem classe em vez de criar um filtro vazio', async () => {
        tabelas.championship_registrations = [
            inscricao({ id: 'a', class: '4ª Classe' }),
            inscricao({ id: 'b', class: null }),
        ];
        montar();

        await screen.findByRole('button', { name: 'RODADAS' });
        expect(screen.queryByRole('button', { name: 'TODAS' })).not.toBeInTheDocument();
    });
});
