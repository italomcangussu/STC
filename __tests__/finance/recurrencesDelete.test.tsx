import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinRecurrence, FinSettings } from '../../lib/finance/types';

const api = vi.hoisted(() => ({
  newRequestId: () => globalThis.crypto.randomUUID(),
  listRecurrences: vi.fn(), saveRecurrence: vi.fn(), generateRecurrences: vi.fn(), deleteRecurrence: vi.fn(),
}));
vi.mock('../../lib/finance/financeApi', () => api);
vi.mock('../../lib/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { ConfirmProvider } from '../../components/ui/ConfirmProvider';
import { FinanceProvider } from '../../components/finance/FinanceContext';
import RecurrencesTab from '../../components/finance/tabs/RecurrencesTab';

const rec = { id: 'r1', description: 'ENEL', supplier: null, category_id: 'c1', amount_cents: 51547, frequency: 'monthly', due_day: 5, due_month_offset: 0,
  start_month: '2026-10-01', end_month: null, account_id: null, notes: null, active: true, version: 3 } as FinRecurrence;

const mount = () => render(
  <ConfirmProvider>
    <FinanceProvider value={{ accounts: [], categories: [{ id: 'c1', name: 'Energia', kind: 'expense', active: true, parent_id: null, system_key: null, dre_line: 'operational' } as never], settings: {} as FinSettings, reload: vi.fn(), go: vi.fn() }}>
      <RecurrencesTab />
    </FinanceProvider>
  </ConfirmProvider>,
);

beforeEach(() => {
  Object.values(api).forEach((f) => { if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset(); });
  api.listRecurrences.mockResolvedValue([rec]);
  api.deleteRecurrence.mockResolvedValue({ id: 'r1', canceled: 1, kept: 1 });
});

describe('Recorrências — excluir', () => {
  it('só aparece ao editar, pede confirmação e manda a versão lida; depois recarrega a lista', async () => {
    mount();
    expect(screen.queryByRole('button', { name: /Excluir recorrência/ })).toBeNull();
    fireEvent.click(await screen.findByText('ENEL'));
    fireEvent.click(await screen.findByRole('button', { name: /Excluir recorrência/ }));
    expect(api.deleteRecurrence).not.toHaveBeenCalled();
    const dialogs = await screen.findAllByRole('button', { name: 'Excluir recorrência' });
    fireEvent.click(dialogs[dialogs.length - 1]);
    await waitFor(() => expect(api.deleteRecurrence).toHaveBeenCalledWith('r1', 3, expect.any(String)));
    await waitFor(() => expect(api.listRecurrences).toHaveBeenCalledTimes(2));
  });

  it('nova recorrência não mostra o botão', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Nova/ }));
    await screen.findByText('Nova recorrência');
    expect(screen.queryByRole('button', { name: /Excluir recorrência/ })).toBeNull();
  });
});
