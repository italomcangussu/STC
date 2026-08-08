/**
 * Testes para ConfirmDialog — o portão das ações que não têm desfazer.
 *
 * O que importa aqui não é a aparência: é que seja **impossível** confirmar
 * uma ação destrutiva por reflexo. Cada teste trava uma dessas garantias.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

afterEach(cleanup);

const base = {
    open: true,
    title: 'Apagar tudo?',
    description: 'Isso remove os confrontos.',
    confirmLabel: 'Apagar',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
};

describe('ConfirmDialog', () => {
    it('não renderiza nada quando fechado', () => {
        const { container } = render(<ConfirmDialog {...base} open={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('anuncia-se como diálogo modal rotulado pelo título', () => {
        render(<ConfirmDialog {...base} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName('Apagar tudo?');
    });

    it('lista as consequências informadas', () => {
        render(<ConfirmDialog {...base} consequences={['32 confrontos', '4 rodadas']} />);
        expect(screen.getByText('32 confrontos')).toBeInTheDocument();
        expect(screen.getByText('4 rodadas')).toBeInTheDocument();
    });

    describe('sem confirmação tipada', () => {
        it('confirma direto', () => {
            const onConfirm = vi.fn();
            render(<ConfirmDialog {...base} onConfirm={onConfirm} />);
            fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
            expect(onConfirm).toHaveBeenCalledOnce();
        });
    });

    describe('com confirmação tipada', () => {
        const typed = { ...base, requireTyped: 'APAGAR' };

        it('mantém o botão travado enquanto a palavra não confere', () => {
            render(<ConfirmDialog {...typed} />);
            const confirmar = screen.getByRole('button', { name: 'Apagar' });
            expect(confirmar).toBeDisabled();

            fireEvent.change(screen.getByLabelText(/Digite APAGAR/), { target: { value: 'APAG' } });
            expect(confirmar).toBeDisabled();
        });

        it('libera o botão quando a palavra confere', () => {
            render(<ConfirmDialog {...typed} />);
            fireEvent.change(screen.getByLabelText(/Digite APAGAR/), { target: { value: 'APAGAR' } });
            expect(screen.getByRole('button', { name: 'Apagar' })).toBeEnabled();
        });

        it('ignora caixa e espaços nas pontas — a barreira é atenção, não datilografia', () => {
            render(<ConfirmDialog {...typed} />);
            fireEvent.change(screen.getByLabelText(/Digite APAGAR/), { target: { value: '  apagar ' } });
            expect(screen.getByRole('button', { name: 'Apagar' })).toBeEnabled();
        });

        it('limpa o campo ao reabrir, para não herdar o destravamento anterior', () => {
            const { rerender } = render(<ConfirmDialog {...typed} />);
            fireEvent.change(screen.getByLabelText(/Digite APAGAR/), { target: { value: 'APAGAR' } });
            expect(screen.getByRole('button', { name: 'Apagar' })).toBeEnabled();

            rerender(<ConfirmDialog {...typed} open={false} />);
            rerender(<ConfirmDialog {...typed} open />);

            expect(screen.getByLabelText(/Digite APAGAR/)).toHaveValue('');
            expect(screen.getByRole('button', { name: 'Apagar' })).toBeDisabled();
        });
    });

    describe('saídas', () => {
        it('cancela pelo botão', () => {
            const onCancel = vi.fn();
            render(<ConfirmDialog {...base} onCancel={onCancel} />);
            fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
            expect(onCancel).toHaveBeenCalledOnce();
        });

        it('cancela pelo X', () => {
            const onCancel = vi.fn();
            render(<ConfirmDialog {...base} onCancel={onCancel} />);
            fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
            expect(onCancel).toHaveBeenCalledOnce();
        });

        it('cancela com Esc', () => {
            const onCancel = vi.fn();
            render(<ConfirmDialog {...base} onCancel={onCancel} />);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            expect(onCancel).toHaveBeenCalledOnce();
        });

        it('Esc não escapa enquanto a ação está rodando', () => {
            const onCancel = vi.fn();
            render(<ConfirmDialog {...base} busy onCancel={onCancel} />);
            fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
            expect(onCancel).not.toHaveBeenCalled();
        });
    });

    describe('estado ocupado', () => {
        it('trava os dois botões para impedir envio duplicado', () => {
            render(<ConfirmDialog {...base} busy />);
            expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Aguarde...' })).toBeDisabled();
        });
    });

    describe('empilhamento sobre outros modais', () => {
        it('renderiza fora da árvore do chamador, direto no body', () => {
            // Quase toda confirmação nasce de um botão dentro de um modal. Sem
            // o portal, o diálogo herdaria o contexto de empilhamento do modal
            // e apareceria atrás dele — clique sem resposta visível.
            const { container } = render(<ConfirmDialog {...base} />);
            expect(container).toBeEmptyDOMElement();
            expect(document.body.querySelector('[role="dialog"]')).toBeInTheDocument();
        });

        it('fica acima do z-999 do StandardModal', () => {
            render(<ConfirmDialog {...base} />);
            const overlay = screen.getByRole('dialog').parentElement!;
            expect(overlay.className).toContain('z-1000');
        });

        it('impede que o Esc chegue a quem escuta no window — só o topo fecha', () => {
            const onCancel = vi.fn();
            const doModalDeBaixo = vi.fn();
            window.addEventListener('keydown', doModalDeBaixo);

            render(<ConfirmDialog {...base} onCancel={onCancel} />);
            fireEvent.keyDown(document, { key: 'Escape' });

            window.removeEventListener('keydown', doModalDeBaixo);
            expect(onCancel).toHaveBeenCalledOnce();
            expect(doModalDeBaixo).not.toHaveBeenCalled();
        });
    });
});
