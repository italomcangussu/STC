/**
 * Folha do código de 6 dígitos: o sócio recebeu o código no WhatsApp e o digita aqui.
 *
 * Regras que a tela espelha (o servidor é quem manda): o código vale 10 minutos, tem 5 tentativas e um
 * novo só pode ser pedido 60 s depois do anterior. Tocar fora da folha NÃO a fecha: um toque errado não
 * pode jogar fora o código que acabou de chegar.
 */
import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { locationHint } from '../../lib/signatures/location';
import { formatCountdown } from '../../lib/signatures/format';
import { signatureMessage, SignatureError, type CodeRequested, type Signed } from '../../lib/signatures/api';
import { Notice, btnGhost, btnPrimary, inputCls } from './ui';

export const RESEND_AFTER_SECONDS = 60;
/** Motivos em que o código não adianta mais: a pessoa precisa pedir outro. */
const NEEDS_NEW_CODE = new Set(['locked', 'expired', 'superseded', 'failed']);

export type ActiveChallenge = CodeRequested & { requestedAt: number };

export type CodeSheetProps = {
  challenge: ActiveChallenge;
  onClose: () => void;
  onResend: () => Promise<void>;
  onConfirm: (challenge: ActiveChallenge, code: string) => Promise<Signed>;
  onSigned: (signed: Signed) => void;
  /** Relógio injetável para teste. */
  now?: () => number;
};

export const CodeSheet: React.FC<CodeSheetProps> = ({ challenge, onClose, onResend, onConfirm, onSigned, now = Date.now }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => now());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(now()), 1000);
    return () => window.clearInterval(timer);
  }, [now]);

  // Código novo = campo limpo e foco de volta nele.
  useEffect(() => {
    setCode('');
    setError(null);
    input.current?.focus();
  }, [challenge.challengeId]);

  const resendIn = Math.max(0, RESEND_AFTER_SECONDS - (tick - challenge.requestedAt) / 1000);
  const expiresIn = (Date.parse(challenge.expiresAt) - tick) / 1000;
  const expired = Number.isFinite(expiresIn) && expiresIn <= 0;
  const hint = locationHint(challenge.location);

  const confirm = async () => {
    if (code.length !== 6 || busy) return;
    setBusy('confirm');
    setError(null);
    try {
      onSigned(await onConfirm(challenge, code));
    } catch (e) {
      setError(signatureMessage(e));
      setCode('');
      if (!(e instanceof SignatureError && NEEDS_NEW_CODE.has(e.reason))) input.current?.focus();
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    if (resendIn > 0 || busy) return;
    setBusy('resend');
    setError(null);
    try {
      await onResend();
    } catch (e) {
      setError(signatureMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title="Digite o código do WhatsApp"
      subtitle={`Enviado para ${challenge.phoneMasked || 'o seu WhatsApp'}`}
      footer={(
        <>
          <button type="button" className={btnGhost} onClick={resend} disabled={resendIn > 0 || busy !== null}>
            {busy === 'resend' ? 'Enviando…' : resendIn > 0 ? `Pedir novo código em ${formatCountdown(resendIn)}` : 'Pedir novo código'}
          </button>
          <button type="button" className={btnPrimary} onClick={confirm} disabled={code.length !== 6 || busy !== null}>
            {busy === 'confirm' ? 'Assinando…' : 'Assinar documento'}
          </button>
        </>
      )}
    >
      <div className="flex items-start gap-2.5 rounded-2xl bg-emerald-50 p-3 text-xs text-emerald-900">
        <MessageCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
        <p className="leading-relaxed">Abra o WhatsApp, copie o código de 6 números e cole aqui. <b>O código só se digita neste app</b> — nunca o passe a ninguém.</p>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] font-black uppercase tracking-wider text-stone-400">Código de 6 dígitos</span>
        <input
          ref={input}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter') void confirm(); }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          placeholder="000000"
          aria-label="Código de 6 dígitos"
          className={`${inputCls} text-center text-2xl font-black tracking-[0.5em] tabular-nums`}
          disabled={busy === 'confirm'}
        />
      </label>

      <p className={`text-xs font-medium ${expired ? 'text-red-600' : 'text-stone-500'}`}>
        {expired
          ? 'Este código venceu. Peça um novo.'
          : Number.isFinite(expiresIn) ? `O código vale por mais ${formatCountdown(expiresIn)}.` : 'O código vale por 10 minutos.'}
      </p>

      {hint && <Notice tone="info">{hint}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
    </Sheet>
  );
};
