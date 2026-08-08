/**
 * Testes do StandardModal — o primitivo por trás de ~20 modais do app.
 * O que importa aqui é o que todo modal precisa fazer igual: fechar, travar o
 * fundo e não perder o foco do usuário pelo caminho.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StandardModal } from '../components/StandardModal';

afterEach(cleanup);

const conteudo = <div className="p-6">Conteúdo do modal</div>;

describe('StandardModal', () => {
    it('não renderiza nada quando fechado', () => {
        render(<StandardModal isOpen={false} onClose={vi.fn()}>{conteudo}</StandardModal>);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renderiza no body, fora da árvore do chamador', () => {
        const { container } = render(
            <StandardModal isOpen onClose={vi.fn()}>{conteudo}</StandardModal>
        );
        expect(container).toBeEmptyDOMElement();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('fecha com Escape', () => {
        const onClose = vi.fn();
        render(<StandardModal isOpen onClose={onClose}>{conteudo}</StandardModal>);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('fecha ao clicar no fundo', () => {
        const onClose = vi.fn();
        render(<StandardModal isOpen onClose={onClose}>{conteudo}</StandardModal>);
        fireEvent.click(screen.getByRole('dialog'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('não fecha ao clicar no fundo quando closeOnBackdrop é falso', () => {
        const onClose = vi.fn();
        render(
            <StandardModal isOpen onClose={onClose} closeOnBackdrop={false}>{conteudo}</StandardModal>
        );
        fireEvent.click(screen.getByRole('dialog'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('clique no conteúdo não fecha — só o fundo fecha', () => {
        const onClose = vi.fn();
        render(<StandardModal isOpen onClose={onClose}>{conteudo}</StandardModal>);
        fireEvent.click(screen.getByText('Conteúdo do modal'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('trava o scroll do fundo enquanto está aberto e devolve ao fechar', () => {
        const { unmount } = render(
            <StandardModal isOpen onClose={vi.fn()}>{conteudo}</StandardModal>
        );
        expect(document.body.style.overflow).toBe('hidden');
        unmount();
        expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('leva o foco para dentro ao abrir', () => {
        render(<StandardModal isOpen onClose={vi.fn()}>{conteudo}</StandardModal>);
        const painel = screen.getByText('Conteúdo do modal').parentElement!;
        expect(document.activeElement).toBe(painel);
    });

    it('devolve o foco para quem abriu', () => {
        const abridor = document.createElement('button');
        document.body.appendChild(abridor);
        abridor.focus();

        const { unmount } = render(
            <StandardModal isOpen onClose={vi.fn()}>{conteudo}</StandardModal>
        );
        unmount();

        expect(document.activeElement).toBe(abridor);
        abridor.remove();
    });

    it('não rouba o foco de um campo que já se apossou dele', () => {
        render(
            <StandardModal isOpen onClose={vi.fn()}>
                <input autoFocus aria-label="Nome" />
            </StandardModal>
        );
        expect(document.activeElement).toBe(screen.getByLabelText('Nome'));
    });

    it('aceita um nome acessível para quem não vê a tela', () => {
        render(
            <StandardModal isOpen onClose={vi.fn()} ariaLabel="Gerar confrontos">{conteudo}</StandardModal>
        );
        expect(screen.getByRole('dialog', { name: 'Gerar confrontos' })).toBeInTheDocument();
    });
});
