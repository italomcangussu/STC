import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdminPushPermissionBanner } from '../../components/conversations/AdminPushPermissionBanner';
import * as pushLib from '../../lib/pushNotifications';

describe('AdminPushPermissionBanner (Apple HIG compliance)', () => {
  it('exibe automaticamente o banner quando o status é "default"', () => {
    vi.spyOn(pushLib, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushLib, 'getPermissionStatus').mockReturnValue('default');

    render(<AdminPushPermissionBanner />);

    expect(screen.getByText('Notificações de Mensagens')).toBeDefined();
    expect(screen.getByText('Voltar')).toBeDefined();
    expect(screen.getByText('Continuar')).toBeDefined();
  });

  it('não exibe o banner se notificações já foram concedidas ou negadas', () => {
    vi.spyOn(pushLib, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushLib, 'getPermissionStatus').mockReturnValue('granted');

    const { container } = render(<AdminPushPermissionBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('aciona subscribeToPush ao clicar em Continuar', async () => {
    vi.spyOn(pushLib, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushLib, 'getPermissionStatus').mockReturnValue('default');
    const subscribeSpy = vi.spyOn(pushLib, 'subscribeToPush').mockResolvedValue({
      endpoint: 'https://push.example.com',
      keys: { p256dh: 'key1', auth: 'auth1' },
    });

    const onSubscribed = vi.fn();
    render(<AdminPushPermissionBanner onSubscribed={onSubscribed} userId="admin-123" />);

    const continuarBtn = screen.getByText('Continuar');
    fireEvent.click(continuarBtn);

    expect(subscribeSpy).toHaveBeenCalledWith('admin-123');
  });

  it('dispensa o banner ao clicar em Voltar', () => {
    vi.spyOn(pushLib, 'isPushSupported').mockReturnValue(true);
    vi.spyOn(pushLib, 'getPermissionStatus').mockReturnValue('default');

    render(<AdminPushPermissionBanner />);
    const voltarBtn = screen.getByText('Voltar');
    fireEvent.click(voltarBtn);

    expect(screen.queryByText('Notificações de Mensagens')).toBeNull();
  });
});
