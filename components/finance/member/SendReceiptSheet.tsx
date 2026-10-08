import React, { useMemo } from 'react';
import { Loader2, Receipt } from 'lucide-react';
import type { User } from '../../../types';
import { notify } from '../../../lib/notifications';
import { submitReceipt } from '../../../lib/finance/financeApi';
import type { ChargeStatementRow, MemberPendencyMeta } from '../../../lib/finance/types';
import { canSendReceipt, receiptSentNotice, submittedOcrStatus } from '../../../lib/finance/memberStatement';
import { useAction, useRequestKey, useToday } from '../hooks';
import { Sheet, btnGhost, btnPrimary } from '../ui';
import { ChargePicker, FilePicker, HintsNotice, OcrNotice, PaymentFields } from './SendReceiptFields';
import { useReceiptDraft, useReceiptHints } from './useReceiptDraft';

interface Props {
  open: boolean;
  onClose: () => void;
  user: User;
  payable: ChargeStatementRow[];
  preselected: string[];
  replaces: string | null;
  pendencyMeta: Map<string, MemberPendencyMeta>;
  onSent: () => void;
}

/** Envio do comprovante: escolher as cobranças, anexar o arquivo e conferir valor e data. Enviar não quita; o clube confere. */
export const SendReceiptSheet: React.FC<Props> = ({ open, onClose, user, payable, preselected, replaces, pendencyMeta, onSent }) => {
  const today = useToday();
  const { key, renew } = useRequestKey();
  const { busy, run } = useAction({ message: 'Não foi possível enviar o comprovante.', event: 'finance_receipt_submit_failed' });
  const { draft, patch, toggleCharge, pick, submissionId } = useReceiptDraft({ open, preselected, today });
  const selected = useMemo(() => payable.filter((c) => draft.chosen.includes(c.charge_id)), [payable, draft.chosen]);
  const flags = useReceiptHints({ open, selected, today }, draft);

  const send = async () => {
    const { file, amount, paidOn } = draft;
    if (!file || amount === null || !paidOn) return;
    await run(() => submitReceipt({
      userId: user.id, submissionId: submissionId.current, requestId: key, file: file.file, type: file.type, safeName: file.name, sha256: file.hash,
      chargeIds: draft.chosen, declaredAmountCents: amount, declaredPaidOn: paidOn, reference: draft.reference.trim() || null, note: draft.note.trim() || null,
      ocrStatus: submittedOcrStatus(draft.ocr.status), ocr: draft.ocr.stored, replaces,
    }), (result) => {
      const notice = receiptSentNotice(result);
      notify.success(notice.title, { description: notice.description });
      renew(); onSent(); onClose();
    });
  };

  return (
    <Sheet
      open={open} onClose={onClose} title={replaces ? 'Enviar novo comprovante' : 'Enviar comprovante'}
      subtitle="O OCR pode confirmar automaticamente mensalidades e pendências quando valor, data e favorecido conferirem; qualquer dúvida vai para análise."
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={!canSendReceipt(draft) || busy} onClick={send}>{busy ? <Loader2 className="animate-spin" size={16} /> : <Receipt size={16} />} Enviar comprovante</button></>}
    >
      <ChargePicker payable={payable} selected={selected} chosen={draft.chosen} pendencyMeta={pendencyMeta} onToggle={toggleCharge} />
      <FilePicker file={draft.file} error={draft.fileError} onPick={pick} />
      <OcrNotice ocr={draft.ocr} />
      <PaymentFields draft={draft} today={today} patch={patch} />
      <HintsNotice flags={flags} />
    </Sheet>
  );
};
