/**
 * Casca do Painel Admin: navegação em dois níveis, selos de pendência, busca
 * por teclado e o aviso "estou dentro do painel" que evita títulos repetidos.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { AdminNav, AdminSearchBox, AdminSectionHeading } from '../components/admin/AdminNav';
import { AdminPending } from '../components/admin/AdminPending';
import { AdminEmbedProvider } from '../components/admin/AdminEmbedContext';
import { AdminPageHeader, AdminEmpty, ChipGroup } from '../components/admin/ui';
import { pendingBySection, type AdminCounts } from '../components/admin/useAdminPending';
import { sectionById } from '../components/admin/adminNavMeta';
import { SectionTabs, Card } from '../components/finance/ui';

afterEach(cleanup);

const counts = (over: Partial<AdminCounts> = {}): AdminCounts => ({ access: 0, challenges: 0, today: 0, payments: 0, forms: 0, ...over });

describe('AdminNav', () => {
    it('mostra as 5 áreas e só as seções da área aberta', () => {
        render(<AdminNav active="reservas" onGo={vi.fn()} />);
        const areas = screen.getByRole('tablist', { name: 'Áreas' });
        expect(within(areas).getAllByRole('tab')).toHaveLength(5);
        const secoes = screen.getByRole('tablist', { name: 'Quadra' });
        expect(within(secoes).getAllByRole('tab').map(t => t.textContent)).toEqual(['Reservas', 'Desafios', 'Lançamentos', 'SuperSet']);
        expect(within(secoes).getByRole('tab', { name: 'Reservas' })).toHaveAttribute('aria-selected', 'true');
    });

    it('área com uma só seção (Início) não mostra a segunda faixa', () => {
        render(<AdminNav active="dashboard" onGo={vi.fn()} />);
        expect(screen.getAllByRole('tablist')).toHaveLength(1);
    });

    it('trocar de área abre a primeira seção; tocar na área atual não tira o usuário da seção em que está', () => {
        const onGo = vi.fn();
        render(<AdminNav active="desafios" onGo={onGo} />);
        const areas = screen.getByRole('tablist', { name: 'Áreas' });

        fireEvent.click(within(areas).getByRole('tab', { name: /Quadra/ }));
        expect(onGo).toHaveBeenLastCalledWith('desafios');

        fireEvent.click(within(areas).getByRole('tab', { name: /Pessoas/ }));
        expect(onGo).toHaveBeenLastCalledWith('acessos');
    });

    it('selo da seção e da área soma o que espera ação; a área aberta não repete o selo', () => {
        const pending = pendingBySection(counts({ access: 3, challenges: 2, payments: 1, today: 9, forms: 4 }));
        expect(pending).toEqual({ acessos: 3, desafios: 2, financeiro: 1 });

        render(<AdminNav active="acessos" onGo={vi.fn()} pending={pending} />);
        const areas = screen.getByRole('tablist', { name: 'Áreas' });
        // Quadra (desafios=2) e Clube (financeiro=1) mostram selo; Pessoas é a aberta
        expect(within(within(areas).getByRole('tab', { name: /Quadra/ })).getByText('2')).toBeInTheDocument();
        expect(within(within(areas).getByRole('tab', { name: /Clube/ })).getByText('1')).toBeInTheDocument();
        expect(within(within(areas).getByRole('tab', { name: /Pessoas/ })).queryByText('3')).not.toBeInTheDocument();
        // dentro da área aberta o selo fica na seção
        const secoes = screen.getByRole('tablist', { name: 'Pessoas' });
        expect(within(within(secoes).getByRole('tab', { name: /Acessos/ })).getByText('3')).toBeInTheDocument();
    });
});

describe('AdminSearchBox', () => {
    it('encontra por palavra-chave sem acento e abre a seção com Enter', () => {
        const onGo = vi.fn();
        render(<AdminSearchBox onGo={onGo} />);
        const campo = screen.getByRole('combobox', { name: 'Buscar seção do painel' });
        fireEvent.change(campo, { target: { value: 'MENSALIDADE' } });
        expect(screen.getByRole('option', { name: /Financeiro/ })).toBeInTheDocument();
        fireEvent.keyDown(campo, { key: 'Enter' });
        expect(onGo).toHaveBeenCalledWith('financeiro');
        expect(campo).toHaveValue('');
    });

    it('navega pelas opções com as setas e limpa com Escape', () => {
        const onGo = vi.fn();
        render(<AdminSearchBox onGo={onGo} />);
        const campo = screen.getByRole('combobox');
        fireEvent.change(campo, { target: { value: 'partida' } });
        const opcoes = screen.getAllByRole('option');
        expect(opcoes.length).toBeGreaterThan(1);
        expect(opcoes[0]).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(campo, { key: 'ArrowDown' });
        expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(campo, { key: 'Escape' });
        expect(campo).toHaveValue('');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('avisa quando nada é encontrado', () => {
        render(<AdminSearchBox onGo={vi.fn()} />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } });
        expect(screen.getByText(/Nada encontrado/)).toBeInTheDocument();
    });
});

describe('AdminSectionHeading', () => {
    it('é o único h1 da página: nome da seção e para que ela serve', () => {
        render(<AdminSectionHeading section={sectionById('financeiro')} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Financeiro' })).toBeInTheDocument();
        expect(screen.getByText('Cobranças e pagamentos')).toBeInTheDocument();
    });
});

describe('AdminPending', () => {
    it('lista só o que tem pendência e leva à seção', () => {
        const onGo = vi.fn();
        render(<AdminPending counts={counts({ access: 2 })} onGo={onGo} />);
        fireEvent.click(screen.getByRole('button', { name: /cadastros aguardando aprovação/ }));
        expect(onGo).toHaveBeenCalledWith('acessos');
        expect(screen.queryByText(/desafios aguardando/)).not.toBeInTheDocument();
    });

    it('concorda no singular: "1 cadastro", não "1 cadastros"', () => {
        render(<AdminPending counts={counts({ access: 1, forms: 1 })} onGo={vi.fn()} />);
        expect(screen.getByRole('button', { name: '1 cadastro aguardando aprovação' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '1 formulário aberto' })).toBeInTheDocument();
    });

    it('sem pendências diz que está tudo em dia; sem dados ainda não mostra nada', () => {
        const { rerender, container } = render(<AdminPending counts={counts()} onGo={vi.fn()} />);
        expect(screen.getByText('Tudo em dia: nenhuma pendência.')).toBeInTheDocument();
        rerender(<AdminPending counts={null} onGo={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('AdminPageHeader', () => {
    it('fora do painel se apresenta sozinho, com título e ação', () => {
        render(<AdminPageHeader title="Gestão de Alunos" subtitle="Cadastre alunos" actions={<button>Novo</button>} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Gestão de Alunos' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Novo' })).toBeInTheDocument();
    });

    it('dentro do painel não repete o título: sobra só a ação', () => {
        render(<AdminEmbedProvider><AdminPageHeader title="Gestão de Alunos" actions={<button>Novo</button>} /></AdminEmbedProvider>);
        expect(screen.queryByRole('heading')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Novo' })).toBeInTheDocument();
    });

    it('dentro do painel e sem ações não renderiza nada', () => {
        const { container } = render(<AdminEmbedProvider><AdminPageHeader title="Sem ação" /></AdminEmbedProvider>);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('peças comuns', () => {
    it('ChipGroup marca o escolhido e avisa a troca', () => {
        const onChange = vi.fn();
        render(<ChipGroup label="Papel" value="a" onChange={onChange} items={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} />);
        expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'B' }));
        expect(onChange).toHaveBeenCalledWith('b');
    });

    it('AdminEmpty explica o que fazer', () => {
        render(<AdminEmpty title="Nada aqui" hint="Crie o primeiro." />);
        expect(screen.getByText('Nada aqui')).toBeInTheDocument();
        expect(screen.getByText('Crie o primeiro.')).toBeInTheDocument();
    });
});

describe('financeiro: abas e cartões', () => {
    it('as duas faixas do financeiro são abas, mas com desenhos diferentes', () => {
        const items = [{ id: 'a', label: 'Receber', badge: 3 }, { id: 'b', label: 'Pagar' }];
        const { rerender } = render(<SectionTabs variant="segmented" label="Áreas" value="a" onChange={vi.fn()} items={items} />);
        const seg = screen.getByRole('tablist', { name: 'Áreas' });
        expect(seg.className).toMatch(/grid/);
        expect(screen.getByRole('tab', { name: /Receber/ })).toHaveAttribute('aria-selected', 'true');
        rerender(<SectionTabs label="Áreas" value="a" onChange={vi.fn()} items={items} />);
        expect(screen.getByRole('tablist', { name: 'Áreas' }).className).toMatch(/overflow-x-auto/);
    });

    it('Card com ações empilha título e ações no celular, para o título não ser esmagado', () => {
        render(<Card title="Recorrências" right={<><button>Gerar lançamentos</button><button>Nova</button></>} />);
        const titulo = screen.getByRole('heading', { name: 'Recorrências' });
        const cabecalho = titulo.closest('header')!;
        expect(cabecalho.className).toMatch(/flex-col/);
        expect(cabecalho.className).toMatch(/sm:flex-row/);
        // as ações podem quebrar de linha em vez de empurrar o título
        expect(screen.getByRole('button', { name: 'Nova' }).parentElement!.className).toMatch(/flex-wrap/);
    });
});
