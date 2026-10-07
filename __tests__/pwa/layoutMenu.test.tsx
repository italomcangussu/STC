import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) }),
  },
}));
vi.mock('../../lib/pushNotifications', () => ({
  isPushSupported: () => false,
  isInstalledPWA: () => false,
  isIOS: () => false,
  getPermissionStatus: () => 'default',
  subscribeToPush: vi.fn(),
  isSubscribed: async () => false,
}));
vi.mock('../../components/PushPermissionPrompt', () => ({ PushPermissionPrompt: () => null }));
vi.mock('../../components/AdminLogin', () => ({ AdminLogin: () => null }));

import { Layout } from '../../components/Layout';
import type { User } from '../../types';

const user = (role: string) => ({ id: 'u1', name: 'Fulano', avatar: '', role, isProfessor: false }) as unknown as User;

const renderLayout = (role: string) =>
  render(<Layout view="agenda" setView={() => {}} currentUser={user(role)} onLogout={() => {}}><div /></Layout>);

describe('menu principal', () => {
  it('mostra Conversas só para administradores', () => {
    const admin = renderLayout('admin');
    expect(screen.getAllByText('Conversas').length).toBeGreaterThan(0);
    admin.unmount();

    renderLayout('socio');
    expect(screen.queryByText('Conversas')).toBeNull();
  });

  it('mostra Configurações para sócios e administradores', () => {
    renderLayout('socio');
    expect(screen.getAllByText('Configurações').length).toBeGreaterThan(0);
  });
});
