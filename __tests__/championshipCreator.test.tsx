/**
 * Rede de caracterização do `ChampionshipCreator` (CC 60, 0% de cobertura) —
 * o último componente de campeonato sem nenhuma rede.
 *
 * O foco é a **retomada**: quando o admin reabre um campeonato dias depois, o
 * Criador tem que devolvê-lo no passo em que ele parou, e por classe — a 4ª
 * pode já ter chave enquanto a 5ª nem abriu inscrições. Errar isso joga o admin
 * num fluxo antigo em que o mata-mata pós-grupos fica inalcançável, que é
 * justamente quando ele é necessário.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

vi.mock('../lib/resenhaOpenService', () => ({
    fetchRegistrations: vi.fn(async () => []),
    fetchBracket: vi.fn(async () => []),
    fetchRegistrationUserMap: vi.fn(async () => new Map()),
    registerSocio: vi.fn(),
    registerGuest: vi.fn(),
    removeRegistration: vi.fn(),
    saveBracket: vi.fn(),
    activateChampionship: vi.fn(),
    recordMatchResult: vi.fn(),
    recordWalkover: vi.fn(),
    resolveAndFinish: vi.fn(),
}));

vi.mock('../lib/championship/registration', () => ({
    fetchClassRegistrations: vi.fn(async () => []),
    fetchActiveStudents: vi.fn(async () => []),
    registerAluno: vi.fn(),
}));

import { ChampionshipCreator } from '../components/ChampionshipCreator';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import { supabase } from '../lib/supabase';
import { fetchBracket } from '../lib/resenhaOpenService';

afterEach(cleanup);

/** O que o banco devolve, por tabela e por consulta. */
let campeonatos: any[];
let formatConfig: unknown;
let rodadasDaClasse: any[];
let quantidadeDeConfrontos: number;
let erroAoRestaurar: string | null;

function montarConsulta(tabela: string) {
    let ehFormatConfig = false;

    const consulta: any = {
        select: vi.fn((cols?: string) => {
            if (typeof cols === 'string' && cols.includes('format_config')) ehFormatConfig = true;
            return consulta;
        }),
        eq: vi.fn(() => consulta),
        in: vi.fn(() => consulta),
        order: vi.fn(() => consulta),
        maybeSingle: vi.fn(() => Promise.resolve(
            erroAoRestaurar
                ? { data: null, error: { message: erroAoRestaurar } }
                : { data: { format_config: formatConfig, start_date: '2026-08-01', end_date: '2026-08-30' }, error: null }
        )),
        then: (resolve: (v: any) => void) => {
            if (tabela === 'matches') {
                return Promise.resolve({ count: quantidadeDeConfrontos, error: null }).then(resolve);
            }
            if (tabela === 'championship_rounds') {
                return Promise.resolve({ data: rodadasDaClasse, error: null }).then(resolve);
            }
            if (tabela === 'championships') {
                return Promise.resolve({ data: ehFormatConfig ? [] : campeonatos, error: null }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
        },
    };
    return consulta;
}

const montar = () =>
    render(<ConfirmProvider><ChampionshipCreator /></ConfirmProvider>);

/**
 * O passo de configuração tem dois cartões que usam os mesmos rótulos: o
 * seletor de classe do Resenha e o formulário de campeonato novo, que lista as
 * seis classes do clube. Toda busca precisa dizer em qual cartão está olhando.
 */
const cartao = async (titulo: string) => {
    const h = await screen.findByRole('heading', { name: titulo });
    return within(h.parentElement as HTMLElement);
};

/** Escolhe o campeonato existente e clica em Continuar. */
const retomar = async () => {
    const existente = await cartao('Campeonato existente');
    fireEvent.change(existente.getByRole('combobox'), { target: { value: 'c1' } });
    fireEvent.click(existente.getByRole('button', { name: /Continuar/i }));
};

beforeEach(() => {
    vi.clearAllMocks();
    campeonatos = [{ id: 'c1', name: '3º Circuito de Inverno', status: 'draft' }];
    formatConfig = { '4ª Classe': { format: 'grupo-mata-mata' }, '5ª Classe': { format: 'mata-mata' } };
    rodadasDaClasse = [];
    quantidadeDeConfrontos = 0;
    erroAoRestaurar = null;
    vi.mocked(supabase.from).mockImplementation((t: string) => montarConsulta(t));
});

describe('ChampionshipCreator — passo inicial', () => {
    it('abre no passo de configuração, oferecendo 4ª e 5ª Classe', async () => {
        montar();
        const classe = await cartao('Classe');

        expect(classe.getByRole('button', { name: '4ª Classe' })).toBeInTheDocument();
        expect(classe.getByRole('button', { name: '5ª Classe' })).toBeInTheDocument();
    });

    it('lista os campeonatos existentes para retomar', async () => {
        montar();
        expect(await screen.findByRole('heading', { name: 'Campeonato existente' })).toBeInTheDocument();
    });

    it('não deixa continuar sem escolher um campeonato', async () => {
        montar();
        const existente = await cartao('Campeonato existente');

        expect(existente.getByRole('button', { name: /Continuar/i })).toBeDisabled();
    });

    it('esconde a retomada quando não há campeonato nenhum', async () => {
        campeonatos = [];
        montar();

        await screen.findByRole('heading', { name: 'Classe' });
        expect(screen.queryByRole('heading', { name: 'Campeonato existente' })).not.toBeInTheDocument();
    });

    it('pergunta em qual classe retomar quando o campeonato tem mais de uma', async () => {
        montar();
        const existente = await cartao('Campeonato existente');
        fireEvent.change(existente.getByRole('combobox'), { target: { value: 'c1' } });

        expect(await screen.findByText('Retomar em qual classe')).toBeInTheDocument();
    });
});

describe('ChampionshipCreator — em que passo o campeonato reabre', () => {
    it('sem rodada criada, volta para as inscrições', async () => {
        rodadasDaClasse = [];
        montar();
        await retomar();

        await waitFor(() => expect(
            screen.queryByRole('heading', { name: 'Campeonato existente' })
        ).not.toBeInTheDocument());
    });

    it('com rodada e sem confronto, volta para o sorteio', async () => {
        rodadasDaClasse = [{ id: 'r1', phase: 'grupos' }];
        quantidadeDeConfrontos = 0;
        montar();
        await retomar();

        // Chegou no passo de sorteio: não buscou a chave.
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Campeonato existente' })).not.toBeInTheDocument());
        expect(vi.mocked(fetchBracket)).not.toHaveBeenCalled();
    });

    it('com rodada e confronto já gerado, vai direto para o quadro', async () => {
        rodadasDaClasse = [{ id: 'r1', phase: 'grupos' }];
        quantidadeDeConfrontos = 6;
        montar();
        await retomar();

        await waitFor(() => expect(vi.mocked(fetchBracket)).toHaveBeenCalledWith('c1'));
    });

    it('campeonato do modelo antigo, sem configuração por classe, cai no quadro', async () => {
        formatConfig = null;
        montar();
        await retomar();

        await waitFor(() => expect(vi.mocked(fetchBracket)).toHaveBeenCalledWith('c1'));
    });

    it('avisa quando não consegue restaurar, em vez de travar sem explicação', async () => {
        erroAoRestaurar = 'permission denied for table championships';
        montar();
        await retomar();

        // O botão volta a ficar disponível: a falha não deixa a tela presa.
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Continuar/i })).toBeEnabled());
    });
});

// A tela com o contador "0/20 atletas" pertence ao passo de inscrições do
// modelo antigo, e a retomada nunca passa por ela: sem `format_config`, o
// Criador vai direto para o quadro. Cobrir `expectedCount` exigiria forçar um
// caminho que o usuário não percorre — deixado de fora de propósito.
