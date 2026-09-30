import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditProfileModal } from '../components/EditProfileModal';
import type { User } from '../types';

const update = vi.fn((_updates: Record<string, unknown>) => ({
    eq: vi.fn().mockResolvedValue({ error: null }),
}));
const from = vi.fn((_table: string) => ({ update }));

vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => from(table) } }));
vi.mock('../lib/notifications', () => ({
    notify: { failure: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function socio(overrides: Partial<User> = {}): User {
    return {
        id: 'u1',
        name: 'Ítalo',
        email: '',
        phone: '',
        role: 'socio',
        balance: 0,
        ...overrides,
    } as User;
}

function salvar(user: User) {
    render(<EditProfileModal currentUser={user} onClose={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /salvar alterações/i }));
}

describe('EditProfileModal — classe do sócio', () => {
    beforeEach(() => {
        update.mockClear();
        from.mockClear();
    });

    /**
     * Gravar uma classe que o sócio nunca escolheu era lido pelo banco como
     * promoção e estourava `class_change_events.from_class` (NOT NULL). O 23502
     * chegava na tela como "Faltou preencher um campo obrigatório" — um erro
     * falso, com o formulário todo preenchido.
     */
    it('não inventa uma classe para quem ainda não tem', async () => {
        salvar(socio({ category: undefined }));

        await waitFor(() => expect(update).toHaveBeenCalled());
        expect(update.mock.calls[0][0]).toMatchObject({ category: null });
    });

    it('mostra o convite para escolher a classe em vez de uma classe qualquer', () => {
        render(<EditProfileModal currentUser={socio({ category: undefined })} onClose={vi.fn()} onUpdate={vi.fn()} />);

        expect(screen.getByRole('combobox')).toHaveValue('');
        expect(screen.getByRole('option', { name: /selecione sua classe/i })).toBeInTheDocument();
    });

    it('preserva a classe de quem já tem uma', async () => {
        salvar(socio({ category: '4ª Classe' }));

        await waitFor(() => expect(update).toHaveBeenCalled());
        expect(update.mock.calls[0][0]).toMatchObject({ category: '4ª Classe' });
    });
});
