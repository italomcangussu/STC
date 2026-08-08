/**
 * Rede de caracterização do `ChampionshipAdmin` (CC 131, 0% de cobertura).
 *
 * O foco está em duas coisas que ninguém ousaria mexer sem rede: o **fallback
 * de coluna** — um laço que refaz a consulta descartando colunas que o banco
 * diz não existir — e os **diálogos das ações caras** (encerrar campeonato,
 * cancelar edição, remover inscrição), que mudam ranking de gente real.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../lib/supabase', () => ({
    supabase: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => ({ currentUser: { id: 'u9', name: 'Admin', role: 'admin' } }),
}));

import { ChampionshipAdmin } from '../components/ChampionshipAdmin';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import { supabase } from '../lib/supabase';

afterEach(cleanup);

// ── Estado do banco ───────────────────────────────────────────────────────────

let campeonatos: any[];
let inscricoes: any[];
let rodadas: any[];
/** Colunas que o banco finge não ter, para exercitar o fallback. */
let colunasAusentes: string[];
/** Toda coluna pedida em cada tentativa de SELECT em `championships`. */
let tentativasDeSelect: string[][];
let apagados: { tabela: string; id: string }[];
let rpcChamadas: { nome: string; args: unknown }[];

const CAMPEONATO = {
    id: 'c1',
    name: '3º Circuito de Inverno',
    status: 'ongoing',
    format: 'grupo-mata-mata',
    start_date: '2026-08-01',
    end_date: '2026-08-30',
    registration_open: true,
    registration_closed: false,
    series_id: 's1',
    edition_year: 2026,
    pts_victory: 3,
    pts_defeat: 0,
    pts_wo_victory: 3,
    pts_set: 0,
    pts_game: 0,
    pts_technical_draw: 0,
};

const inscricao = (over: Partial<any> = {}) => ({
    id: 'reg1',
    championship_id: 'c1',
    participant_type: 'socio',
    user_id: 'u1',
    guest_name: null,
    class: '4ª Classe',
    shirt_size: 'M',
    created_at: '2026-08-01',
    user: { name: 'Ana Souza', avatar_url: null },
    ...over,
});

/**
 * Encadeamento do PostgREST. `championships` é o caso interessante: devolve
 * erro de "coluna não existe" enquanto o SELECT pedir alguma coluna ausente,
 * que é o que dispara o laço de fallback do componente.
 */
function montarConsulta(tabela: string) {
    let colunasPedidas: string[] = [];
    let apagando = false;
    let idAlvo = '';

    const resultado = () => {
        if (tabela !== 'championships') {
            const dados = tabela === 'championship_registrations' ? inscricoes
                : tabela === 'championship_rounds' ? rodadas
                    : [];
            return { data: dados, error: null, count: 0 };
        }
        const faltando = colunasPedidas.find(c => colunasAusentes.includes(c));
        if (faltando) {
            return {
                data: null,
                error: { message: `column championships.${faltando} does not exist` },
            };
        }
        return { data: campeonatos, error: null };
    };

    const consulta: any = {
        select: vi.fn((cols?: string) => {
            if (tabela === 'championships' && typeof cols === 'string') {
                colunasPedidas = cols.split(',').map(c => c.trim());
                tentativasDeSelect.push(colunasPedidas);
            }
            return consulta;
        }),
        eq: vi.fn((_c: string, valor: string) => { idAlvo = valor; return consulta; }),
        in: vi.fn(() => consulta),
        limit: vi.fn(() => consulta),
        order: vi.fn(() => Object.assign(Promise.resolve(resultado()), consulta)),
        maybeSingle: vi.fn(() => {
            const r = resultado();
            return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data });
        }),
        update: vi.fn(() => consulta),
        insert: vi.fn(() => Promise.resolve({ error: null })),
        delete: vi.fn(() => { apagando = true; return consulta; }),
        then: (resolve: (v: any) => void) => {
            if (apagando) {
                apagados.push({ tabela, id: idAlvo });
                return Promise.resolve({ error: null }).then(resolve);
            }
            return Promise.resolve(resultado()).then(resolve);
        },
    };
    return consulta;
}

const montar = () =>
    render(
        <ConfirmProvider>
            <ChampionshipAdmin currentUser={{ id: 'u9', name: 'Admin', role: 'admin' } as any} />
        </ConfirmProvider>
    );

beforeEach(() => {
    vi.clearAllMocks();
    campeonatos = [CAMPEONATO];
    inscricoes = [];
    rodadas = [];
    colunasAusentes = [];
    tentativasDeSelect = [];
    apagados = [];
    rpcChamadas = [];

    vi.mocked(supabase.from).mockImplementation((t: string) => montarConsulta(t));
    vi.mocked(supabase.rpc).mockImplementation((nome: string, args: unknown) => {
        rpcChamadas.push({ nome, args });
        return Promise.resolve({ data: { applied_points_count: 12 }, error: null }) as any;
    });
});

// ── Testes ────────────────────────────────────────────────────────────────────

describe('ChampionshipAdmin — carregamento', () => {
    it('seleciona o primeiro campeonato sozinho, sem exigir um clique', async () => {
        montar();
        expect(await screen.findByRole('heading', { name: '3º Circuito de Inverno' })).toBeInTheDocument();
    });

    it('diz que não há nada quando a lista volta vazia', async () => {
        campeonatos = [];
        montar();
        expect(await screen.findByText(/Nenhum campeonato encontrado/)).toBeInTheDocument();
    });
});

describe('ChampionshipAdmin — fallback de coluna ausente', () => {
    it('refaz a consulta sem a coluna que o banco diz não existir', async () => {
        // Ambiente onde a migration de pontuação ainda não rodou.
        colunasAusentes = ['pts_technical_draw'];
        montar();

        expect(await screen.findByRole('heading', { name: '3º Circuito de Inverno' })).toBeInTheDocument();
        expect(tentativasDeSelect[0]).toContain('pts_technical_draw');
        expect(tentativasDeSelect.find(t => !t.includes('pts_technical_draw'))).toBeDefined();
    });

    it('descarta uma coluna por tentativa até a consulta passar', async () => {
        colunasAusentes = ['pts_technical_draw', 'edition_year'];
        montar();

        await screen.findByRole('heading', { name: '3º Circuito de Inverno' });
        const ultima = tentativasDeSelect.at(-1)!;
        expect(ultima).not.toContain('pts_technical_draw');
        expect(ultima).not.toContain('edition_year');
    });

    it('desiste na hora quando o erro não é de coluna faltando — não fica em laço', async () => {
        vi.mocked(supabase.from).mockImplementation((t: string) => {
            if (t !== 'championships') return montarConsulta(t);
            const q: any = {
                select: vi.fn(() => { tentativasDeSelect.push(['x']); return q; }),
                eq: vi.fn(() => q),
                maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: { message: 'permission denied' } })),
                order: vi.fn(() => Promise.resolve({ data: null, error: { message: 'permission denied' } })),
            };
            return q;
        });

        montar();

        expect(await screen.findByText(/Nenhum campeonato encontrado/)).toBeInTheDocument();
        expect(tentativasDeSelect).toHaveLength(1);
    });
});

describe('ChampionshipAdmin — inscrições', () => {
    beforeEach(() => {
        inscricoes = [inscricao(), inscricao({ id: 'reg2', participant_type: 'guest', guest_name: 'Beto', user: null })];
    });

    it('lista sócios pelo nome do perfil e convidados pelo nome digitado', async () => {
        montar();

        expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
        expect(screen.getByText('Beto')).toBeInTheDocument();
    });

    it('pergunta antes de remover, e usa o nome de quem sai na pergunta', async () => {
        montar();
        await screen.findByText('Ana Souza');

        fireEvent.click(screen.getAllByRole('button', { name: 'Remover' })[0]);

        const dialogo = await screen.findByRole('dialog');
        expect(within(dialogo).getByText('Remover Ana Souza do campeonato?')).toBeInTheDocument();
    });

    it('desistir no diálogo não apaga a inscrição', async () => {
        montar();
        await screen.findByText('Ana Souza');

        fireEvent.click(screen.getAllByRole('button', { name: 'Remover' })[0]);
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(apagados).toHaveLength(0);
    });

    it('confirmar apaga a inscrição certa', async () => {
        montar();
        await screen.findByText('Ana Souza');

        fireEvent.click(screen.getAllByRole('button', { name: 'Remover' })[0]);
        fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remover inscrição' }));

        await waitFor(() => expect(apagados).toContainEqual({
            tabela: 'championship_registrations', id: 'reg1',
        }));
    });
});

describe('ChampionshipAdmin — ações que mexem no ranking', () => {
    it('avisa que o ranking de todos muda antes de encerrar', async () => {
        montar();
        fireEvent.click(await screen.findByRole('button', { name: /Finalizar Campeonato/i }));

        const dialogo = await screen.findByRole('dialog');
        expect(within(dialogo).getByText('Encerrar "3º Circuito de Inverno"?')).toBeInTheDocument();
        expect(within(dialogo).getByText('O ranking de todos os participantes muda')).toBeInTheDocument();
    });

    it('só chama a apuração depois do aceite', async () => {
        montar();
        fireEvent.click(await screen.findByRole('button', { name: /Finalizar Campeonato/i }));
        const dialogo = await screen.findByRole('dialog');

        expect(rpcChamadas).toHaveLength(0);

        fireEvent.click(within(dialogo).getByRole('button', { name: 'Encerrar e apurar' }));

        await waitFor(() => expect(rpcChamadas).toContainEqual({
            nome: 'finish_championship',
            args: { p_championship_id: 'c1' },
        }));
    });

    it('esconde "Finalizar" em campeonato já encerrado', async () => {
        campeonatos = [{ ...CAMPEONATO, status: 'finished' }];
        montar();

        await screen.findByRole('heading', { name: '3º Circuito de Inverno' });
        expect(screen.queryByRole('button', { name: /Finalizar Campeonato/i })).not.toBeInTheDocument();
    });

    it('trata cancelar edição como ação destrutiva, não como aviso', async () => {
        montar();
        fireEvent.click(await screen.findByRole('button', { name: /Cancelar Edição/i }));

        const dialogo = await screen.findByRole('dialog');
        expect(within(dialogo).getByText('Cancelar a edição "3º Circuito de Inverno"?')).toBeInTheDocument();
        expect(within(dialogo).getByText('A edição anterior volta a valer')).toBeInTheDocument();
        expect(rpcChamadas).toHaveLength(0);
    });

    it('não oferece cancelar edição fora de uma série', async () => {
        campeonatos = [{ ...CAMPEONATO, series_id: null }];
        montar();

        await screen.findByRole('heading', { name: '3º Circuito de Inverno' });
        expect(screen.queryByRole('button', { name: /Cancelar Edição/i })).not.toBeInTheDocument();
    });
});

describe('ChampionshipAdmin — rodadas', () => {
    beforeEach(() => {
        rodadas = [
            { id: 'r1', class: '4ª Classe', round_number: 1, name: 'Rodada 1', phase: 'grupos', start_date: '2026-08-01', end_date: '2026-08-07', status: 'active' },
            { id: 'r2', class: '4ª Classe', round_number: 2, name: 'Rodada 2', phase: 'grupos', start_date: '2026-08-08', end_date: '2026-08-14', status: 'pending' },
        ];
    });

    it('avisa quando não há rodada criada, em vez de mostrar uma lista vazia', async () => {
        rodadas = [];
        montar();

        fireEvent.click(await screen.findByRole('button', { name: 'Rodadas' }));
        expect(await screen.findByText('Nenhuma rodada criada ainda.')).toBeInTheDocument();
    });

    it('seleciona todas as rodadas de uma vez e mostra a contagem', async () => {
        montar();
        fireEvent.click(await screen.findByRole('button', { name: 'Rodadas' }));

        fireEvent.click(await screen.findByLabelText('Selecionar Rodada 1'));
        expect(screen.getByText('1 selecionada')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Selecionar Rodada 2'));
        expect(screen.getByText('2 selecionadas')).toBeInTheDocument();
    });
});
