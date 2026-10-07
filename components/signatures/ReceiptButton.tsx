/**
 * Botão "Baixar comprovante (PDF)". O comprovante sai do dossiê gravado na assinatura (`lib/signatures/receipt.ts`);
 * o sócio recebe a cópia com CPF e telefone mascarados e o administrador, a completa.
 */
import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { downloadReceipt } from '../../lib/signatures/receipt';
import { documentErrorMessage } from '../../lib/signatures/documents';
import { btnGhost } from './ui';

type Props = { signatureId: string; full: boolean; label?: string; ariaLabel?: string; compact?: boolean; className?: string };

export const ReceiptButton: React.FC<Props> = ({ signatureId, full, label = 'Baixar comprovante (PDF)', ariaLabel, compact = false, className }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadReceipt(signatureId, { full });
    } catch (e) {
      setError(documentErrorMessage(e, 'Não foi possível gerar o comprovante agora. Tente de novo.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={() => void run()} disabled={busy} className={className ?? `${btnGhost} ${compact ? '!min-h-9 !px-3 text-xs' : ''}`} aria-label={ariaLabel}>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <FileDown size={16} aria-hidden />}
        {busy ? 'Gerando…' : label}
      </button>
      {error && <span role="alert" className="text-xs font-bold text-red-700">{error}</span>}
    </span>
  );
};
