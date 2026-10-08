import { useCallback, useEffect, useRef, useState } from 'react';
import { chargeStatementsByIds, newRequestId } from '../../../lib/finance/financeApi';
import type { ChargeStatementRow } from '../../../lib/finance/types';
import type { IsoDate } from '../../../lib/finance/dates';
import { fieldsFromOcr, IDLE_OCR, receiptHints, toggleId, type OcrState } from '../../../lib/finance/memberStatement';
import { readReceipt } from '../../../lib/finance/ocr';
import { safeReceiptFileName, sha256Hex, validateReceiptFile, type ReceiptMime } from '../../../lib/finance/receiptFile';
import type { ReceiptFlag } from '../../../lib/finance/receipts';

export interface PickedFile { file: File; type: ReceiptMime; hash: string; name: string }

export interface ReceiptDraft {
  chosen: string[];
  file: PickedFile | null;
  ocr: OcrState;
  amount: number | null;
  paidOn: IsoDate | '';
  reference: string;
  note: string;
  fileError: string | null;
}

const emptyDraft = (chosen: string[]): ReceiptDraft => ({ chosen, file: null, ocr: IDLE_OCR, amount: null, paidOn: '', reference: '', note: '', fileError: null });

const FILE_HEAD_BYTES = 16;

/** O que o sócio já preencheu no envio do comprovante; recomeça do zero toda vez que a folha abre. */
export function useReceiptDraft({ open, preselected, today }: { open: boolean; preselected: string[]; today: IsoDate }) {
  const submissionId = useRef(newRequestId());
  const [draft, setDraft] = useState<ReceiptDraft>(() => emptyDraft(preselected));
  const patch = useCallback((change: Partial<ReceiptDraft>) => setDraft((current) => ({ ...current, ...change })), []);

  const toggleCharge = useCallback((chargeId: string) => setDraft((current) => ({ ...current, chosen: toggleId(current.chosen, chargeId) })), []);

  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft(preselected));
    submissionId.current = newRequestId();
  }, [open, preselected]);

  // Confere o tipo do arquivo pelos primeiros bytes (não pelo nome), guarda o hash e deixa a leitura automática sugerir os campos.
  const pick = async (f: File | null) => {
    if (!f) return;
    patch({ fileError: null });
    const head = new Uint8Array(await f.slice(0, FILE_HEAD_BYTES).arrayBuffer());
    const check = validateReceiptFile({ name: f.name, type: f.type, size: f.size }, head);
    if ('reason' in check) { patch({ fileError: check.reason, file: null }); return; }
    const hash = await sha256Hex(await f.arrayBuffer());
    patch({ file: { file: f, type: check.type, hash, name: safeReceiptFileName(f.name, check.type) }, ocr: { ...IDLE_OCR, status: 'reading' } });
    const out = await readReceipt(f, check.type, (pct) => setDraft((current) => ({ ...current, ocr: { ...current.ocr, pct } })));
    if (out.status !== 'ok') { patch({ ocr: { ...IDLE_OCR, status: out.status } }); return; }
    patch({ ocr: { status: 'ok', pct: 100, stored: out.stored, identifier: out.extracted.identifier }, ...fieldsFromOcr(out.extracted, today) });
  };

  return { draft, patch, toggleCharge, pick, submissionId };
}

/** Orientações para o sócio antes de enviar (só orienta; o clube decide). Consulta o devido na data do pagamento. */
export function useReceiptHints({ open, selected, today }: { open: boolean; selected: ChargeStatementRow[]; today: IsoDate }, draft: Pick<ReceiptDraft, 'paidOn' | 'amount' | 'ocr'>): ReceiptFlag[] {
  const [flags, setFlags] = useState<ReceiptFlag[]>([]);
  const { paidOn, amount } = draft;
  const ocrStatus = draft.ocr.status;

  useEffect(() => {
    let alive = true;
    if (!open || selected.length === 0 || !paidOn) { setFlags((current) => (current.length ? [] : current)); return; }
    chargeStatementsByIds(selected.map((c) => c.charge_id), paidOn)
      .then((atPaid) => { if (alive) setFlags(receiptHints({ atPaid, selected, amountCents: amount, paidOn, ocrStatus, today })); })
      .catch(() => { if (alive) setFlags([]); });
    return () => { alive = false; };
  }, [open, selected, paidOn, amount, ocrStatus, today]);

  return flags;
}
