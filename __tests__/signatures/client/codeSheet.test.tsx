import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

import { CodeSheet, RESEND_AFTER_SECONDS, type ActiveChallenge } from '../../../components/signatures/CodeSheet';
import { SignatureError, type Signed } from '../../../lib/signatures/api';

const T0 = Date.parse('2026-10-07T12:00:00Z');
let clock = T0;
const advance = (ms: number) => act(() => { clock += ms; vi.advanceTimersByTime(ms); });

const challenge = (over: Partial<ActiveChallenge> = {}): ActiveChallenge => ({
  challengeId: 'CH1', phoneMasked: '(88) •••••-1234', expiresAt: new Date(T0 + 10 * 60_000).toISOString(), location: 'granted', requestedAt: T0, ...over,
});
const signed: Signed = { signatureId: 'S1', signedAt: '2026-10-07T12:01:00Z', seq: 1, replayed: false };

const mount = (props: Partial<React.ComponentProps<typeof CodeSheet>> = {}) => {
  const handlers = { onClose: vi.fn(), onResend: vi.fn(async () => undefined), onConfirm: vi.fn(async () => signed), onSigned: vi.fn() };
  const view = render(<CodeSheet challenge={challenge()} now={() => clock} {...handlers} {...props} />);
  return { ...handlers, ...view };
};
const typeCode = (value: string) => fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value } });
const confirmButton = () => screen.getByRole('button', { name: /Assinar documento|Assinando/ });
const resendButton = () => screen.getByRole('button', { name: /novo código|Enviando/ });
const click = (el: HTMLElement) => act(async () => { fireEvent.click(el); });

beforeEach(() => { clock = T0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('folha do código de 6 dígitos', () => {
  it('diz para onde o código foi (número mascarado) e que só se digita no app', () => {
    mount();
    expect(screen.getByText('Enviado para (88) •••••-1234')).toBeInTheDocument();
    expect(screen.getByText(/só se digita neste app/)).toBeInTheDocument();
  });

  it('só aceita dígitos, no máximo 6 (colar "123 456" funciona) e só habilita com 6', () => {
    mount();
    const input = screen.getByLabelText('Código de 6 dígitos') as HTMLInputElement;
    expect(confirmButton()).toBeDisabled();
    typeCode('12a3');
    expect(input.value).toBe('123');
    expect(confirmButton()).toBeDisabled();
    typeCode('123 456 789');
    expect(input.value).toBe('123456');
    expect(confirmButton()).toBeEnabled();
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
  });

  it('confirma com o código digitado e entrega a assinatura', async () => {
    const { onConfirm, onSigned } = mount();
    typeCode('123456');
    await click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ challengeId: 'CH1', location: 'granted' }), '123456');
    expect(onSigned).toHaveBeenCalledWith(signed);
  });

  it('Enter no campo também confirma', async () => {
    const { onConfirm } = mount();
    typeCode('654321');
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Código de 6 dígitos'), { key: 'Enter' }); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('código errado: mostra quantas tentativas restam e limpa o campo', async () => {
    const { onSigned } = mount({ onConfirm: vi.fn(async () => { throw new SignatureError('wrong_code', { attemptsLeft: 3 }); }) });
    typeCode('111111');
    await click(confirmButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Código incorreto. Restam 3 tentativas.');
    expect((screen.getByLabelText('Código de 6 dígitos') as HTMLInputElement).value).toBe('');
    expect(onSigned).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', /venceu/], ['locked', /bloqueado/], ['superseded', /substituído/],
  ])('código "%s": explica e manda pedir outro', async (reason, text) => {
    mount({ onConfirm: vi.fn(async () => { throw new SignatureError(reason); }) });
    typeCode('111111');
    await click(confirmButton());
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });

  it('o reenvio só libera 60 s depois do pedido, com contagem regressiva', async () => {
    const { onResend } = mount();
    expect(resendButton()).toBeDisabled();
    expect(resendButton()).toHaveTextContent('Pedir novo código em 1:00');

    await advance(30_000);
    expect(resendButton()).toHaveTextContent('Pedir novo código em 0:30');
    expect(resendButton()).toBeDisabled();

    await advance((RESEND_AFTER_SECONDS - 30) * 1000);
    expect(resendButton()).toBeEnabled();
    expect(resendButton()).toHaveTextContent('Pedir novo código');

    await click(resendButton());
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it('reenvio recusado pelo servidor mostra o motivo', async () => {
    mount({ onResend: vi.fn(async () => { throw new SignatureError('too_soon', { retryInSeconds: 12 }); }) });
    await advance(61_000);
    await click(resendButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Aguarde 12 segundos');
  });

  it('código novo (outro desafio) limpa o campo, o erro e reinicia a contagem', async () => {
    const { rerender, onClose, onResend, onConfirm, onSigned } = mount({ onConfirm: vi.fn(async () => { throw new SignatureError('wrong_code', { attemptsLeft: 1 }); }) });
    typeCode('111111');
    await click(confirmButton());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await advance(61_000);
    expect(resendButton()).toBeEnabled();

    rerender(<CodeSheet challenge={challenge({ challengeId: 'CH2', requestedAt: clock, expiresAt: new Date(clock + 600_000).toISOString() })} now={() => clock} onClose={onClose} onResend={onResend} onConfirm={onConfirm} onSigned={onSigned} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByLabelText('Código de 6 dígitos') as HTMLInputElement).value).toBe('');
    expect(resendButton()).toBeDisabled();
  });

  it('mostra quanto tempo falta e avisa quando o código vence (10 min)', async () => {
    mount();
    expect(screen.getByText('O código vale por mais 10:00.')).toBeInTheDocument();
    await advance(9 * 60_000 + 30_000);
    expect(screen.getByText('O código vale por mais 0:30.')).toBeInTheDocument();
    await advance(31_000);
    expect(screen.getByText('Este código venceu. Peça um novo.')).toBeInTheDocument();
  });

  it('localização negada: explica que a assinatura segue só com o IP; permitida: nada a dizer', () => {
    const denied = mount({ challenge: challenge({ location: 'denied' }) });
    expect(screen.getByRole('status')).toHaveTextContent(/Localização não permitida/);
    denied.unmount();

    mount();
    expect(screen.queryByText(/Localização/)).toBeNull();
  });

  it('o botão de fechar chama onClose', async () => {
    const { onClose } = mount();
    await click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
