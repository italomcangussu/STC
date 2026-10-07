import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/supabase', () => ({
  supabase: { rpc, from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) }) },
}));
vi.mock('../../../lib/pushNotifications', () => ({
  isPushSupported: () => false, isInstalledPWA: () => false, isIOS: () => false, getPermissionStatus: () => 'default', subscribeToPush: vi.fn(), isSubscribed: async () => false,
}));
vi.mock('../../../components/PushPermissionPrompt', () => ({ PushPermissionPrompt: () => null }));
vi.mock('../../../components/AdminLogin', () => ({ AdminLogin: () => null }));

import { Layout } from '../../../components/Layout';
import { SIGNATURES_CHANGED_EVENT } from '../../../lib/signatures/usePendingSignatures';
import type { User } from '../../../types';

const user = (role: string) => ({ id: 'u1', name: 'Fulano', avatar: '', role, isProfessor: false }) as unknown as User;
const mount = (role: string, setView = vi.fn()) => render(<Layout view="agenda" setView={setView} currentUser={user(role)} onLogout={() => {}}><div /></Layout>);

beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: 0, error: null }); });

describe('menu: Documentos e Assinaturas', () => {
  it('sócio e administrador veem a aba; lanchonete não (e nem consulta pendências)', () => {
    const socio = mount('socio');
    expect(screen.getAllByText('Documentos e Assinaturas').length).toBeGreaterThan(0);
    socio.unmount();

    const admin = mount('admin');
    expect(screen.getAllByText('Documentos e Assinaturas').length).toBeGreaterThan(0);
    admin.unmount();

    rpc.mockClear();
    mount('lanchonete');
    expect(screen.queryByText('Documentos e Assinaturas')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('mostra o selo com quantos documentos faltam assinar, e o ponto vermelho no menu do celular', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    mount('socio');
    await waitFor(() => expect(screen.getAllByLabelText('2 pendente(s)').length).toBeGreaterThan(0));
    expect(rpc).toHaveBeenCalledWith('sig_my_pending_count', {});
    expect(screen.getByLabelText('2 documento(s) para assinar')).toBeInTheDocument();
  });

  it('sem pendências não há selo nem ponto', async () => {
    mount('socio');
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByLabelText(/pendente\(s\)/)).toBeNull();
    expect(screen.queryByLabelText(/documento\(s\) para assinar/)).toBeNull();
  });

  it('o selo se atualiza quando o sócio assina (aviso do app)', async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    mount('socio');
    await waitFor(() => expect(screen.getAllByLabelText('1 pendente(s)').length).toBeGreaterThan(0));

    rpc.mockResolvedValue({ data: 0, error: null });
    await act(async () => { window.dispatchEvent(new Event(SIGNATURES_CHANGED_EVENT)); });
    await waitFor(() => expect(screen.queryByLabelText(/pendente\(s\)/)).toBeNull());
  });

  it('falha na consulta não quebra o menu nem mostra erro (o selo é só um auxílio)', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    mount('socio');
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.getAllByText('Documentos e Assinaturas').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/pendente\(s\)/)).toBeNull();
  });

  it('tocar na aba troca para "documentos"', async () => {
    const setView = vi.fn();
    mount('socio', setView);
    await act(async () => { screen.getAllByText('Documentos e Assinaturas')[0].closest('button')!.click(); });
    expect(setView).toHaveBeenCalledWith('documentos');
  });
});
