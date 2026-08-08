/**
 * Rede de caracterização do `Championships` — a maior função do repositório
 * (1.682 linhas, CC 67) e a tela que o sócio abre para ver o campeonato.
 *
 * Estava em 2,41%. Aqui ficam travados os estados que o usuário realmente
 * encontra: carregando, sem campeonato, inscrições abertas e campeonato em
 * andamento com as abas.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../lib/supabase', () => ({
    supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

import { Championships } from '../components/Championships';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import { supabase } from '../lib/supabase';
import type { User } from '../types';

afterEach(cleanup);

type Tabela =
    | 'championships'
    | 'profiles'
    | 'courts'
    | 'championship_registrations'
    | 'championship_rounds'
    | 'matches'
    | 'championship_groups';

let tabelas: Record<Tabela, any[]>;

const CAMPEONATO = {
    id: 'c1',
    name: '3º Circuito de Inverno',
    status: 'ongoing',
    format: 'pontos-corridos',
    format_config: null,
    start_date: '2026-08-01',
    end_date: '2026-08-30',
    registration_open: false,
    slug: 'circuito-inverno-3',
    pts_victory: 3,
    pts_defeat: 0,
};

function montarConsulta(tabela: Tabela) {
    const consulta: any = {
        select: vi.fn(() => consulta),
        eq: vi.fn(() => consulta),
        in: vi.fn(() => consulta),
        not: vi.fn(() => consulta),
        or: vi.fn(() => consulta),
        limit: vi.fn(() => consulta),
        order: vi.fn(() => consulta),
        update: vi.fn(() => consulta),
        insert: vi.fn(() => Promise.resolve({ error: null })),
        delete: vi.fn(() => consulta),
        single: vi.fn(() => Promise.resolve({ data: tabelas[tabela][0] ?? null, error: null })),
        maybeSingle: vi.fn(() => Promise.resolve({ data: tabelas[tabela][0] ?? null, error: null })),
        then: (resolve: (v: any) => void) =>
            Promise.resolve({ data: tabelas[tabela], error: null }).then(resolve),
    };
    return consulta;
}

const socio: User = {
    id: 'u1', name: 'Ana', email: '', phone: '', role: 'socio', balance: 0, isActive: true,
};

const montar = (user: User = socio) =>
    render(<ConfirmProvider><Championships currentUser={user} /></ConfirmProvider>);

beforeEach(() => {
    vi.clearAllMocks();
    tabelas = {
        championships: [],
        profiles: [{ id: 'u1', name: 'Ana', role: 'socio', avatar_url: null, is_active: true }],
        courts: [{ id: 'q1', name: 'Quadra 1', type: 'Saibro' }],
        championship_registrations: [],
        championship_rounds: [],
        matches: [],
        championship_groups: [],
    };
    vi.mocked(supabase.from).mockImplementation((t: string) => montarConsulta(t as Tabela));
    vi.mocked(supabase.channel).mockReturnValue({
        on: vi.fn(function (this: any) { return this; }),
        subscribe: vi.fn(() => ({})),
    } as any);
    vi.mocked(supabase.removeChannel).mockImplementation(() => undefined as any);
});

describe('Championships — estados de entrada', () => {
    it('avisa que está carregando antes de ter dado', () => {
        montar();
        expect(screen.getByText('Carregando competições...')).toBeInTheDocument();
    });

    it('mostra estado vazio desenhado quando não há competição — não uma tela em branco', async () => {
        montar();

        expect(await screen.findByText('Sem competições ativas')).toBeInTheDocument();
        expect(screen.getByText('Aguarde o próximo campeonato!')).toBeInTheDocument();
    });
});

describe('Championships — inscrições abertas', () => {
    beforeEach(() => {
        tabelas.championships = [{ ...CAMPEONATO, status: 'draft', registration_open: true }];
        tabelas.championship_registrations = [
            { id: 'reg1', championship_id: 'c1', participant_type: 'socio', user_id: 'u1', guest_name: null, class: '4ª Classe', shirt_size: 'M', user: { name: 'Ana' } },
            { id: 'reg2', championship_id: 'c1', participant_type: 'guest', user_id: null, guest_name: 'Beto', class: '4ª Classe', shirt_size: 'G' },
        ];
    });

    it('anuncia as inscrições abertas com a contagem de inscritos', async () => {
        montar();

        expect(await screen.findByText('📝 Inscrições Abertas')).toBeInTheDocument();
        // O número e a palavra são nós de texto separados (há um ícone no meio),
        // então a busca precisa olhar o texto do elemento inteiro.
        expect(await screen.findByText(
            (_, el) => el?.tagName === 'P' && /2\s+inscritos/.test(el.textContent ?? '')
        )).toBeInTheDocument();
    });

    it('agrupa os inscritos por classe, com a contagem da classe', async () => {
        montar();

        expect(await screen.findByRole('heading', { name: '4ª Classe' })).toBeInTheDocument();
        // Também quebrado em nós, como a contagem do cabeçalho.
        expect(await screen.findByText(
            (_, el) => el?.tagName === 'SPAN' && el.textContent?.trim() === '2 inscritos'
        )).toBeInTheDocument();
    });

    it('distingue sócio de convidado na lista', async () => {
        montar();

        // A linha traz tipo, ponto e tamanho de camisa no mesmo parágrafo.
        expect(await screen.findByText(/✅ Sócio/)).toBeInTheDocument();
        expect(screen.getByText(/🎫 Convidado/)).toBeInTheDocument();
    });

    it('oferece exportar a lista, que é como o clube divulga', async () => {
        montar();

        expect(await screen.findByRole('button', { name: /Exportar PDF/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /WhatsApp/i })).toBeInTheDocument();
    });
});

describe('Championships — campeonato em andamento', () => {
    beforeEach(() => {
        tabelas.championships = [CAMPEONATO];
        tabelas.championship_rounds = [
            { id: 'r1', championship_id: 'c1', round_number: 1, name: 'Rodada 1', phase: 'classificatoria', class: null, start_date: '2026-08-01', end_date: '2026-08-07', status: 'active' },
        ];
        tabelas.championship_registrations = [
            { id: 'reg1', championship_id: 'c1', participant_type: 'socio', user_id: 'u1', guest_name: null, class: '4ª Classe', user: { name: 'Ana' } },
        ];
    });

    it('mostra o nome do campeonato selecionado', async () => {
        montar();
        await waitFor(() => expect(screen.queryByText('Carregando competições...')).not.toBeInTheDocument());

        expect(screen.getAllByText(/3º Circuito de Inverno/).length).toBeGreaterThan(0);
    });

    it('oferece as abas de partidas e jogos em pontos corridos', async () => {
        montar();

        expect(await screen.findByRole('button', { name: /Partidas/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Jogos$/i })).toBeInTheDocument();
    });

    it('não oferece Chaveamento em pontos corridos — não há chave para desenhar', async () => {
        montar();

        await screen.findByRole('button', { name: /Partidas/i });
        expect(screen.queryByRole('button', { name: /Chaveamento|Chave/i })).not.toBeInTheDocument();
    });

    it('oferece Chaveamento em mata-mata', async () => {
        tabelas.championships = [{ ...CAMPEONATO, format: 'mata-mata' }];
        montar();

        expect(await screen.findByRole('button', { name: /Chaveamento|Chave/i })).toBeInTheDocument();
    });
});
