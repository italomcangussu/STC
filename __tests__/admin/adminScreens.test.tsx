/**
 * Telas do painel que ganharam o padrão novo: Professores, Regras e o editor de
 * cadastro. Cada teste cobre um defeito real que existia antes:
 *  - Regras: o campo de pontos perdia o foco a cada tecla (componente declarado
 *    dentro do render) e não dava para apagar o número para digitar outro.
 *  - Professores: a coluna "alunos ativos" lia um campo que nunca era preenchido
 *    (sempre 0) e o modal fechava "como se tivesse salvo" mesmo com erro do banco.
 *  - Editor: fechar com dados digitados jogava tudo fora; mudar a função para
 *    administrador não pedia confirmação.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => {
    type Row = Record<string, unknown>;
    const state = {
        rows: {} as Record<string, Row[]>,
        errors: {} as Record<string, unknown>,
        calls: [] as Array<{ table: string; op: string; payload?: unknown; eq?: unknown[] }>,
    };
    const from = (table: string) => {
        const q: any = { op: 'select', payload: undefined, eqs: [] as unknown[] };
        q.select = () => q;
        q.order = () => q;
        q.not = () => q;
        q.eq = (_col: string, value: unknown) => { q.eqs.push(value); return q; };
        q.update = (payload: unknown) => { q.op = 'update'; q.payload = payload; return q; };
        q.insert = (payload: unknown) => { q.op = 'insert'; q.payload = payload; return q; };
        q.delete = () => { q.op = 'delete'; return q; };
        q.then = (resolve: any, reject: any) => {
            state.calls.push({ table, op: q.op, payload: q.payload, eq: q.eqs });
            const error = state.errors[`${table}.${q.op}`] ?? null;
            return Promise.resolve({ data: q.op === 'select' ? (state.rows[table] ?? []) : null, error }).then(resolve, reject);
        };
        return q;
    };
    return {
        state,
        from,
        confirm: vi.fn(async (_opts: unknown) => true),
        notify: { failure: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    };
});

vi.mock('../../lib/supabase', () => ({ supabase: { from: h.from } }));
vi.mock('../../lib/notifications', () => ({ notify: h.notify }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => h.confirm }));

import { AdminRules } from '../../components/AdminRules';
import { AdminProfessors } from '../../components/AdminProfessors';
import { AdminUserEditor } from '../../components/AdminUserEditor';
import { categoryOf, parsePoints } from '../../lib/pointRules';
import type { User } from '../../types';

beforeEach(() => {
    h.state.rows = {};
    h.state.errors = {};
    h.state.calls = [];
    h.confirm.mockReset();
    h.confirm.mockResolvedValue(true);
    Object.values(h.notify).forEach(fn => fn.mockClear());
});
afterEach(cleanup);

const writes = (table: string, op: string) => h.state.calls.filter(c => c.table === table && c.op === op);

describe('regras de pontuação (lib)', () => {
    it('aceita só inteiro, com sinal opcional', () => {
        expect(parsePoints('15')).toBe(15);
        expect(parsePoints(' -5 ')).toBe(-5);
        expect(parsePoints('')).toBeNull();
        expect(parsePoints('-')).toBeNull();
        expect(parsePoints('1.5')).toBeNull();
        expect(parsePoints('abc')).toBeNull();
    });

    it('agrupa pela chave; "wo" só como palavra inteira', () => {
        expect(categoryOf('victory_singles')).toBe('victory');
        expect(categoryOf('wo_loss')).toBe('victory');
        expect(categoryOf('loss_by_wo')).toBe('victory');
        expect(categoryOf('two_set_bonus')).toBe('match');
        expect(categoryOf('workshop_attendance')).toBe('bonus');
        expect(categoryOf('final_champion')).toBe('ranking');
        expect(categoryOf('participation')).toBe('bonus');
    });
});

describe('AdminRules', () => {
    const rule = (id: string, key: string, points: number, description = `Regra ${key}`) => ({ id, rule_key: key, points, description, updated_at: '' });

    beforeEach(() => {
        h.state.rows.point_rules = [rule('r1', 'victory_singles', 10), rule('r2', 'game_won', 1), rule('r3', 'final_champion', 50)];
    });

    it('digitar não remonta o campo (o teclado do celular não fecha a cada dígito) e dá para apagar o número', async () => {
        render(<AdminRules />);
        const input = await screen.findByRole('spinbutton', { name: /Regra victory_singles/ });

        fireEvent.change(input, { target: { value: '1' } });
        fireEvent.change(input, { target: { value: '15' } });
        expect(document.body.contains(input)).toBe(true);
        expect(input).toHaveValue(15);

        fireEvent.change(input, { target: { value: '' } });
        expect(input).toHaveValue(null);
        expect(screen.getByRole('alert')).toHaveTextContent('Digite um número inteiro');
        expect(screen.getByRole('button', { name: /Salvar$/ })).toBeDisabled();
    });

    it('mostra o valor anterior e só marca como alterado se houver diferença', async () => {
        render(<AdminRules />);
        const input = await screen.findByRole('spinbutton', { name: /Regra victory_singles/ });

        fireEvent.change(input, { target: { value: '12' } });
        expect(screen.getByText('Era 10 · alterado, falta salvar')).toBeInTheDocument();

        fireEvent.change(input, { target: { value: '10' } });
        expect(screen.queryByText(/falta salvar/)).not.toBeInTheDocument();
    });

    it('salva uma regra, confirma na linha e atualiza a tela', async () => {
        render(<AdminRules />);
        const input = await screen.findByRole('spinbutton', { name: /Regra victory_singles/ });
        fireEvent.change(input, { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: /Salvar$/ }));

        await screen.findByText('Salvo');
        expect(writes('point_rules', 'update')).toHaveLength(1);
        expect(writes('point_rules', 'update')[0]).toMatchObject({ payload: { points: 12 }, eq: ['r1'] });
        expect(screen.getByRole('spinbutton', { name: /Regra victory_singles/ })).toHaveValue(12);
    });

    it('Enter salva e Escape desfaz', async () => {
        render(<AdminRules />);
        const input = await screen.findByRole('spinbutton', { name: /Regra game_won/ });

        fireEvent.change(input, { target: { value: '3' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(input).toHaveValue(1);
        expect(writes('point_rules', 'update')).toHaveLength(0);

        fireEvent.change(input, { target: { value: '3' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(writes('point_rules', 'update')).toHaveLength(1));
    });

    it('com duas ou mais alterações oferece "Salvar tudo"', async () => {
        render(<AdminRules />);
        fireEvent.change(await screen.findByRole('spinbutton', { name: /Regra victory_singles/ }), { target: { value: '11' } });
        expect(screen.queryByRole('region', { name: 'Alterações não salvas' })).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole('spinbutton', { name: /Regra game_won/ }), { target: { value: '2' } });
        const barra = screen.getByRole('region', { name: 'Alterações não salvas' });
        expect(barra).toHaveTextContent('2 alterações não salvas');

        fireEvent.click(within(barra).getByRole('button', { name: /Salvar tudo/ }));
        await waitFor(() => expect(writes('point_rules', 'update')).toHaveLength(2));
        await waitFor(() => expect(h.notify.success).toHaveBeenCalledWith('2 regras atualizadas.'));
    });

    it('erro ao salvar mantém o valor digitado e avisa', async () => {
        h.state.errors['point_rules.update'] = { message: 'permission denied' };
        render(<AdminRules />);
        const input = await screen.findByRole('spinbutton', { name: /Regra victory_singles/ });
        fireEvent.change(input, { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: /Salvar$/ }));

        await waitFor(() => expect(h.notify.failure).toHaveBeenCalled());
        expect(screen.getByRole('spinbutton', { name: /Regra victory_singles/ })).toHaveValue(12);
        expect(screen.getByText('Era 10 · alterado, falta salvar')).toBeInTheDocument();
    });

    it('falha ao carregar mostra "Tentar de novo" em vez de uma tela vazia', async () => {
        h.state.errors['point_rules.select'] = { message: 'boom' };
        render(<AdminRules />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');
        h.state.errors = {};
        fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
        expect(await screen.findByRole('spinbutton', { name: /Regra victory_singles/ })).toBeInTheDocument();
    });
});

describe('AdminProfessors', () => {
    beforeEach(() => {
        h.state.rows.professors = [
            { id: 'p1', user_id: 'u1', name: 'Carlos', is_active: true, bio: 'Avançado' },
            { id: 'p2', user_id: 'u2', name: 'Beatriz', is_active: true, bio: '' },
            { id: 'p3', user_id: 'u3', name: 'Zeca', is_active: false, bio: '' },
        ];
        h.state.rows.non_socio_students = [
            { id: 's1', name: 'Ana', plan_type: 'Card Mensal', plan_status: 'active', professor_id: 'p1', is_active: true },
            { id: 's2', name: 'Bia', plan_type: 'Day Card', plan_status: 'inactive', professor_id: 'p1', is_active: true },
            { id: 's3', name: 'Caio', plan_type: 'Card Mensal', plan_status: 'active', professor_id: 'p1', is_active: false },
        ];
    });

    it('conta os alunos ativos de cada professor (pausado não entra) e mostra ativos primeiro', async () => {
        render(<AdminProfessors />);
        await screen.findByText('Carlos');
        const itens = screen.getAllByRole('listitem').filter(li => li.querySelector('[aria-expanded]'));
        expect(itens.map(li => li.querySelector('[aria-expanded]')!.textContent)).toEqual([
            expect.stringContaining('Beatriz'),
            expect.stringContaining('Carlos'),
            expect.stringContaining('Zeca'),
        ]);
        expect(screen.getByText('2 alunos ativos')).toBeInTheDocument();
        expect(screen.getAllByText('0 alunos ativos')).toHaveLength(2);
    });

    it('abre a lista de alunos e distingue pausado de plano inativo', async () => {
        render(<AdminProfessors />);
        fireEvent.click((await screen.findByText('Carlos')).closest('button')!);
        expect(screen.getByText('Avançado')).toBeInTheDocument();
        expect(screen.getByText('Plano ativo')).toBeInTheDocument();
        expect(screen.getByText('Plano inativo')).toBeInTheDocument();
        expect(screen.getByText('Pausado')).toBeInTheDocument();
    });

    it('não deixa remover professor com aluno e explica o que fazer, sem sequer perguntar', async () => {
        render(<AdminProfessors />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remover Carlos' }));
        expect(h.notify.error).toHaveBeenCalledWith(expect.stringContaining('3 alunos vinculados'), expect.objectContaining({ description: expect.stringContaining('outro professor') }));
        expect(h.confirm).not.toHaveBeenCalled();
        expect(writes('professors', 'delete')).toHaveLength(0);
    });

    it('remove professor sem alunos depois de confirmar', async () => {
        render(<AdminProfessors />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remover Beatriz' }));
        await waitFor(() => expect(writes('professors', 'delete')).toHaveLength(1));
        expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remover Beatriz?' }));
        expect(writes('professors', 'delete')[0].eq).toEqual(['p2']);
    });

    it('se o usuário desistir na confirmação, nada é removido', async () => {
        h.confirm.mockResolvedValue(false);
        render(<AdminProfessors />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remover Beatriz' }));
        await waitFor(() => expect(h.confirm).toHaveBeenCalled());
        expect(writes('professors', 'delete')).toHaveLength(0);
    });

    it('exige o nome antes de salvar', async () => {
        render(<AdminProfessors />);
        fireEvent.click(await screen.findByRole('button', { name: /Novo professor/ }));
        const dialogo = await screen.findByRole('dialog', { name: 'Novo professor' });
        fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));
        expect(within(dialogo).getByRole('alert')).toHaveTextContent('Informe o nome');
        expect(writes('professors', 'insert')).toHaveLength(0);
    });

    it('cadastra um professor e avisa', async () => {
        render(<AdminProfessors />);
        fireEvent.click(await screen.findByRole('button', { name: /Novo professor/ }));
        const dialogo = await screen.findByRole('dialog', { name: 'Novo professor' });
        fireEvent.change(within(dialogo).getByPlaceholderText('Nome do professor'), { target: { value: '  Dani  ' } });
        fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));

        await waitFor(() => expect(writes('professors', 'insert')).toHaveLength(1));
        expect(writes('professors', 'insert')[0].payload).toEqual({ name: 'Dani', bio: '', is_active: true });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novo professor' })).not.toBeInTheDocument());
        expect(h.notify.success).toHaveBeenCalledWith('Professor cadastrado.');
    });

    it('erro do banco ao salvar NÃO fecha o modal nem finge que salvou', async () => {
        h.state.errors['professors.insert'] = { message: 'permission denied' };
        render(<AdminProfessors />);
        fireEvent.click(await screen.findByRole('button', { name: /Novo professor/ }));
        const dialogo = await screen.findByRole('dialog', { name: 'Novo professor' });
        fireEvent.change(within(dialogo).getByPlaceholderText('Nome do professor'), { target: { value: 'Dani' } });
        fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));

        await waitFor(() => expect(h.notify.failure).toHaveBeenCalled());
        expect(screen.getByRole('dialog', { name: 'Novo professor' })).toBeInTheDocument();
        expect(h.notify.success).not.toHaveBeenCalled();
    });

    it('lista vazia explica o próximo passo', async () => {
        h.state.rows.professors = [];
        render(<AdminProfessors />);
        expect(await screen.findByText('Nenhum professor cadastrado')).toBeInTheDocument();
    });
});

describe('AdminUserEditor', () => {
    const socio = (over: Partial<User> = {}): User => ({
        id: 'abcdef12-0000', name: 'Marina Souza', email: 'marina@clube.com', phone: '85999990000',
        role: 'socio', balance: 0, category: '3ª Classe', avatar: '', ...over,
    } as User);

    const open = (user = socio()) => {
        const onClose = vi.fn();
        const onSave = vi.fn();
        render(<AdminUserEditor user={user} onClose={onClose} onSave={onSave} />);
        return { onClose, onSave, dialogo: screen.getByRole('dialog', { name: 'Editar cadastro' }) };
    };
    const salvar = () => screen.getByRole('button', { name: /Salvar alterações/ });

    it('mostra o atleta e só habilita Salvar depois de mudar algo', () => {
        const { dialogo } = open();
        expect(within(dialogo).getByText(/Marina Souza · ID abcdef12/)).toBeInTheDocument();
        expect(salvar()).toBeDisabled();
        fireEvent.change(within(dialogo).getByLabelText(/Telefone/), { target: { value: '85988887777' } });
        expect(salvar()).toBeEnabled();
    });

    it('e-mail inválido bloqueia o envio e mostra o motivo no campo', () => {
        const { dialogo } = open();
        fireEvent.change(within(dialogo).getByLabelText(/E-mail/), { target: { value: 'marina@' } });
        fireEvent.click(salvar());
        expect(within(dialogo).getByRole('alert')).toHaveTextContent('E-mail inválido');
        expect(writes('profiles', 'update')).toHaveLength(0);
    });

    it('salva o cadastro com os campos aparados e avisa quem chamou', async () => {
        const { dialogo, onSave, onClose } = open();
        fireEvent.change(within(dialogo).getByLabelText(/Nome completo/), { target: { value: '  Marina S. Souza ' } });
        fireEvent.click(salvar());

        await waitFor(() => expect(onSave).toHaveBeenCalled());
        expect(onClose).toHaveBeenCalled();
        expect(writes('profiles', 'update')[0]).toMatchObject({
            payload: { name: 'Marina S. Souza', email: 'marina@clube.com', role: 'socio', category: '3ª Classe' },
            eq: ['abcdef12-0000'],
        });
        expect(writes('point_history', 'insert')).toHaveLength(0);
    });

    it('promover a administrador pede confirmação; recusando, nada é gravado', async () => {
        h.confirm.mockResolvedValue(false);
        const { dialogo, onSave } = open();
        fireEvent.change(within(dialogo).getByLabelText(/Função/), { target: { value: 'admin' } });
        fireEvent.click(salvar());

        await waitFor(() => expect(h.confirm).toHaveBeenCalled());
        expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Mudar Marina Souza de Sócio para Administrador?',
            description: expect.stringContaining('acesso total'),
        }));
        expect(writes('profiles', 'update')).toHaveLength(0);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('promover a administrador gravando depois de confirmar', async () => {
        const { dialogo, onSave } = open();
        fireEvent.change(within(dialogo).getByLabelText(/Função/), { target: { value: 'admin' } });
        fireEvent.click(salvar());
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        expect(writes('profiles', 'update')[0].payload).toMatchObject({ role: 'admin' });
    });

    it('ajuste de pontos: mostra o efeito, exige motivo e grava no histórico', async () => {
        const { dialogo, onSave } = open();
        fireEvent.change(within(dialogo).getByLabelText(/Pontos/), { target: { value: '100' } });
        expect(within(dialogo).getByRole('status')).toHaveTextContent('+100 pontos entram no histórico de Marina Souza');

        fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: '   ' } });
        fireEvent.click(salvar());
        expect(within(dialogo).getByRole('alert')).toHaveTextContent('Explique o motivo');
        expect(writes('profiles', 'update')).toHaveLength(0);

        fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: 'Torneio interno' } });
        fireEvent.click(salvar());
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        expect(writes('point_history', 'insert')[0].payload).toMatchObject({ user_id: 'abcdef12-0000', amount: 100, description: 'Torneio interno', event_type: 'Manual Adjustment' });
    });

    it('cadastro salvo mas pontos com erro: avisa exatamente isso e não fecha', async () => {
        h.state.errors['point_history.insert'] = { message: 'permission denied' };
        const { dialogo, onSave, onClose } = open();
        fireEvent.change(within(dialogo).getByLabelText(/Pontos/), { target: { value: '-20' } });
        fireEvent.click(salvar());

        await waitFor(() => expect(h.notify.failure).toHaveBeenCalled());
        expect(h.notify.failure.mock.calls[0][1]).toContain('Os dados foram salvos, mas o ajuste de pontos não foi registrado');
        expect(onSave).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('fechar sem mexer em nada não pergunta', async () => {
        const { onClose } = open();
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(h.confirm).not.toHaveBeenCalled();
    });

    it('fechar com dados digitados pede confirmação; "continuar editando" mantém o formulário', async () => {
        h.confirm.mockResolvedValue(false);
        const { dialogo, onClose } = open();
        fireEvent.change(within(dialogo).getByLabelText(/Telefone/), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

        await waitFor(() => expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Descartar alterações?', cancelLabel: 'Continuar editando' })));
        expect(onClose).not.toHaveBeenCalled();
        expect(within(dialogo).getByLabelText(/Telefone/)).toHaveValue('1');

        h.confirm.mockResolvedValue(true);
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('tocar no fundo não fecha nem descarta o formulário', () => {
        const { dialogo, onClose } = open();
        fireEvent.click(dialogo);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('sem link de foto mostra a inicial, não uma imagem de outro site', () => {
        const { dialogo } = open();
        expect(dialogo.querySelector('img')).toBeNull();
        expect(within(dialogo).getByText('M')).toBeInTheDocument();
    });
});
