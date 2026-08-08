/**
 * Testes do `useConfirm` — o contrato aqui é o valor que a promise devolve,
 * porque é ele que decide se a ação destrutiva acontece.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import { useConfirm } from '../hooks/useConfirm';

afterEach(cleanup);

/** Botão que pergunta e reporta a resposta — o menor consumidor possível. */
const Consumer: React.FC<{ onAnswer: (answer: boolean) => void; requireTyped?: string }> = ({
    onAnswer,
    requireTyped,
}) => {
    const confirm = useConfirm();
    return (
        <button
            onClick={async () => onAnswer(await confirm({
                title: 'Apagar tudo?',
                description: 'Não dá para voltar atrás.',
                confirmLabel: 'Apagar',
                requireTyped,
            }))}
        >
            Disparar
        </button>
    );
};

const setup = (props: React.ComponentProps<typeof Consumer>) =>
    render(<ConfirmProvider><Consumer {...props} /></ConfirmProvider>);

describe('ConfirmProvider', () => {
    it('não mostra diálogo nenhum antes de alguém perguntar', () => {
        setup({ onAnswer: vi.fn() });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('resolve true quando o usuário confirma', async () => {
        const onAnswer = vi.fn();
        setup({ onAnswer });

        fireEvent.click(screen.getByText('Disparar'));
        fireEvent.click(await screen.findByRole('button', { name: 'Apagar' }));

        await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
    });

    it('resolve false quando o usuário cancela', async () => {
        const onAnswer = vi.fn();
        setup({ onAnswer });

        fireEvent.click(screen.getByText('Disparar'));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

        await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
    });

    it('fecha o diálogo depois de responder', async () => {
        setup({ onAnswer: vi.fn() });

        fireEvent.click(screen.getByText('Disparar'));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('repassa requireTyped para o diálogo', async () => {
        setup({ onAnswer: vi.fn(), requireTyped: 'APAGAR' });

        fireEvent.click(screen.getByText('Disparar'));

        expect(await screen.findByLabelText('Digite APAGAR para confirmar')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Apagar' })).toBeDisabled();
    });

    it('pode ser usado de novo depois de uma resposta — o estado não fica preso', async () => {
        const onAnswer = vi.fn();
        setup({ onAnswer });

        fireEvent.click(screen.getByText('Disparar'));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
        await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByText('Disparar'));
        fireEvent.click(await screen.findByRole('button', { name: 'Apagar' }));

        await waitFor(() => expect(onAnswer).toHaveBeenNthCalledWith(2, true));
    });

    it('lança quando falta o provider, em vez de virar um botão morto', () => {
        // O erro sobe até o console do React; silenciamos só este teste.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<Consumer onAnswer={vi.fn()} />)).toThrow(/ConfirmProvider/);
        spy.mockRestore();
    });
});
