/**
 * Tela de um documento: ler → concordar → confirmar o CPF → assinar com o código do WhatsApp.
 *
 * A ordem é a do servidor, que a exige e carimba cada passo com a hora dele (`sig_log_event`):
 *   viewed + read_started (ao abrir) → read_completed (leu até o fim) → consent_checked (concordou).
 * O botão "Assinar digitalmente" chama `requestSignatureCode`, que abre o pedido de localização do
 * sistema logo no clique e só depois pede o código. Nada aqui assina: quem assina é a função de borda,
 * depois de conferir o código.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, FileText, ShieldCheck } from 'lucide-react';
import type { User } from '../../types';
import {
  documentErrorMessage, downloadDocumentFile, getMyCpf, logJourneyEvent, saveMyCpf, type MyDocumentRow,
} from '../../lib/signatures/documents';
import { confirmSignatureCode, requestSignatureCode, signatureMessage, type Signed } from '../../lib/signatures/api';
import { LOCATION_NOTICE } from '../../lib/signatures/location';
import { createJourney } from '../../lib/signatures/journey';
import type { ReadingSnapshot } from '../../lib/signatures/reading';
import { cpfDigits, cpfValid, formatCpf, maskCpf } from '../../lib/signatures/cpf';
import { matchesSha256 } from '../../lib/signatures/hash';
import { dueInfo, formatDateTime } from '../../lib/signatures/format';
import { notifySignaturesChanged } from '../../lib/signatures/usePendingSignatures';
import { PdfReader } from './PdfReader';
import { ReceiptButton } from './ReceiptButton';
import { CodeSheet, type ActiveChallenge } from './CodeSheet';
import { Badge, Notice, Spinner, Step, btnGhost, btnPrimary, inputCls } from './ui';

const HASH_MISMATCH = 'O arquivo baixado não confere com o que foi publicado pelo clube. Tente de novo e, se continuar, avise a administração.';

class HashMismatch extends Error {}

type ReadState = 'idle' | 'recording' | 'done' | 'failed';

export type DocumentSigningProps = {
  doc: MyDocumentRow;
  currentUser: Pick<User, 'id'>;
  onBack: () => void;
};

export const DocumentSigning: React.FC<DocumentSigningProps> = ({ doc, currentUser, onBack }) => {
  const [signed, setSigned] = useState<Signed | null>(null);
  const signedAt = signed?.signedAt ?? doc.signed_at;
  const finished = Boolean(signedAt);

  // ---- arquivo -------------------------------------------------------------
  const [file, setFile] = useState<{ bytes: ArrayBuffer; url: string | null } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setFile(null);
    setFileError(null);
    (async () => {
      try {
        const bytes = await downloadDocumentFile(doc.storage_path);
        if (!(await matchesSha256(bytes, doc.content_sha256))) throw new HashMismatch();
        if (!alive) return;
        if (typeof URL.createObjectURL === 'function') url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        setFile({ bytes, url });
      } catch (e) {
        if (alive) setFileError(e instanceof HashMismatch ? HASH_MISMATCH : documentErrorMessage(e));
      }
    })();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [doc.storage_path, doc.content_sha256, attempt]);

  // ---- leitura e aceite (trilha no servidor) --------------------------------
  const journey = useMemo(() => createJourney((kind, meta) => logJourneyEvent(doc.document_id, kind, meta)), [doc.document_id]);
  const [snapshot, setSnapshot] = useState<ReadingSnapshot | null>(null);
  const [readerError, setReaderError] = useState(false);
  const [readState, setReadState] = useState<ReadState>('idle');
  const [readError, setReadError] = useState<string | null>(null);

  const handleReady = useCallback(() => {
    if (finished) return;
    // Começou a ler: o servidor carimba a hora (dela sai o tempo de leitura do dossiê).
    journey.log('viewed').then(() => journey.log('read_started')).catch(() => { /* reenviado ao fim da leitura */ });
  }, [finished, journey]);

  const recordRead = useCallback(async (s: ReadingSnapshot) => {
    setReadState('recording');
    setReadError(null);
    try {
      await journey.log('viewed');
      await journey.log('read_started');
      await journey.log('read_completed', { pages_seen: s.pagesSeen, pages_total: s.pagesTotal });
      setReadState('done');
    } catch (e) {
      setReadState('failed');
      setReadError(documentErrorMessage(e));
    }
  }, [journey]);

  useEffect(() => {
    if (!finished && snapshot?.complete && readState === 'idle') void recordRead(snapshot);
  }, [finished, snapshot, readState, recordRead]);

  const [consent, setConsent] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  const toggleConsent = async (checked: boolean) => {
    setConsentError(null);
    if (!checked) { setConsent(false); return; }
    setConsentBusy(true);
    try {
      await journey.log('consent_checked');
      setConsent(true);
    } catch (e) {
      setConsentError(documentErrorMessage(e));
    } finally {
      setConsentBusy(false);
    }
  };

  // ---- CPF -----------------------------------------------------------------
  const [savedCpf, setSavedCpf] = useState<string | null>(null);
  const [cpfInput, setCpfInput] = useState('');
  const [cpfBusy, setCpfBusy] = useState(false);
  const [cpfError, setCpfError] = useState<string | null>(null);

  useEffect(() => {
    if (finished) return undefined;
    let alive = true;
    getMyCpf(currentUser.id).then((cpf) => {
      if (!alive || !cpf) return;
      setSavedCpf(cpf);
      setCpfInput(formatCpf(cpf));
    }, () => { /* sem CPF salvo: o sócio informa */ });
    return () => { alive = false; };
  }, [currentUser.id, finished]);

  const typedCpf = cpfDigits(cpfInput);
  const cpfConfirmed = savedCpf !== null && savedCpf === typedCpf;

  const saveCpf = async () => {
    setCpfError(null);
    if (!cpfValid(typedCpf)) { setCpfError('CPF inválido. Confira os 11 números e tente de novo.'); return; }
    setCpfBusy(true);
    try {
      await saveMyCpf(typedCpf);
      setSavedCpf(typedCpf);
    } catch (e) {
      setCpfError(documentErrorMessage(e));
    } finally {
      setCpfBusy(false);
    }
  };

  // ---- assinatura ------------------------------------------------------------
  const [challenge, setChallenge] = useState<ActiveChallenge | null>(null);
  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const canSign = readState === 'done' && consent && cpfConfirmed && !signBusy && !readerError && !fileError;

  const requestCode = async () => {
    // Primeira ação do clique: `requestSignatureCode` abre o pedido de localização do sistema.
    const r = await requestSignatureCode(doc.document_id);
    setChallenge({ ...r, requestedAt: Date.now() });
  };

  const sign = async () => {
    if (!canSign) return;
    setSignBusy(true);
    setSignError(null);
    try {
      await requestCode();
    } catch (e) {
      setSignError(signatureMessage(e));
    } finally {
      setSignBusy(false);
    }
  };

  const confirmed = (result: Signed) => {
    setChallenge(null);
    setSigned(result);
    // A lista e o selo do menu se atualizam por este aviso.
    notifySignaturesChanged();
  };

  const due = finished ? null : dueInfo(doc.due_at);
  const reading = snapshot;

  return (
    <div className="space-y-4 pb-6">
      <button type="button" className={`${btnGhost} !min-h-9 !px-3`} onClick={onBack}><ArrowLeft size={16} /> Documentos</button>

      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {finished ? <Badge tone="good">Assinado</Badge> : <Badge tone="warn">Pendente</Badge>}
          {due && <Badge tone={due.tone}>{due.label}</Badge>}
        </div>
        <h2 className="text-xl font-black leading-tight text-stone-800">{doc.title}</h2>
        {doc.description && <p className="text-sm text-stone-500">{doc.description}</p>}
        <p className="text-xs text-stone-400">Versão {doc.version} · {doc.page_count} {doc.page_count === 1 ? 'página' : 'páginas'}</p>
      </header>

      {finished && (
        <Notice tone="good" title="Documento assinado">
          Você assinou em <b>{formatDateTime(signedAt)}</b>{signed ? ` (assinatura nº ${signed.seq})` : ''}. O registro ficou guardado com o dia, a hora e os dados do código confirmado.
          {(signed?.signatureId ?? doc.signature_id) && (
            <span className="mt-2 block"><ReceiptButton signatureId={(signed?.signatureId ?? doc.signature_id) as string} full={false} /></span>
          )}
        </Notice>
      )}

      {fileError ? (
        <Notice tone="bad" title="Não foi possível abrir o documento" action={<button type="button" className={btnGhost} onClick={() => setAttempt((n) => n + 1)}>Tentar de novo</button>}>
          {fileError}
        </Notice>
      ) : !file ? (
        <Spinner label="Baixando o documento…" />
      ) : (
        <div className="space-y-2">
          {!finished && reading && (
            <div aria-label="Progresso da leitura">
              <div className="flex items-center justify-between text-[11px] font-bold text-stone-500">
                <span>{reading.complete ? 'Você leu até o fim' : 'Role até o fim do documento'}</span>
                <span>{reading.pagesSeen}/{reading.pagesTotal} páginas</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuenow={reading.percent} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full rounded-full transition-all ${reading.complete ? 'bg-emerald-500' : 'bg-saibro-500'}`} style={{ width: `${reading.percent}%` }} />
              </div>
            </div>
          )}
          <PdfReader
            data={file.bytes}
            expectedPages={doc.page_count}
            track={!finished}
            onReady={handleReady}
            onProgress={setSnapshot}
            onError={() => setReaderError(true)}
          />
          {file.url && (
            <a href={file.url} download={`${doc.title}.pdf`} className="inline-flex items-center gap-1.5 text-xs font-bold text-saibro-700 underline">
              <Download size={14} /> Baixar uma cópia do PDF
            </a>
          )}
        </div>
      )}

      {!finished && (
        <div className="space-y-3">
          <Step n={1} title="Leia o documento até o fim" done={readState === 'done'} active={readState !== 'done'}>
            {readState === 'done' && <p className="text-xs text-emerald-700">Leitura registrada.</p>}
            {readState === 'recording' && <p className="text-xs text-stone-500">Registrando a sua leitura…</p>}
            {readState === 'idle' && <p className="text-xs text-stone-500">Role o documento acima até o final. O passo 2 libera quando você terminar.</p>}
            {readState === 'failed' && (
              <Notice tone="warn" action={<button type="button" className={btnGhost} onClick={() => snapshot && void recordRead(snapshot)}>Tentar registrar de novo</button>}>
                {readError}
              </Notice>
            )}
          </Step>

          <Step n={2} title="Concorde com os termos" done={consent} active={readState === 'done' && !consent}>
            <label className={`flex items-start gap-3 text-sm ${readState === 'done' ? 'text-stone-700' : 'text-stone-400'}`}>
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-saibro-600"
                checked={consent}
                disabled={readState !== 'done' || consentBusy}
                onChange={(e) => void toggleConsent(e.target.checked)}
              />
              <span>{doc.consent_text}{consentBusy && <span className="ml-1 text-[11px] text-stone-400">Registrando…</span>}</span>
            </label>
            {readState !== 'done' && <p className="text-[11px] text-stone-400">Disponível depois que você ler o documento até o fim.</p>}
            {consentError && <Notice tone="bad">{consentError}</Notice>}
          </Step>

          <Step n={3} title="Confirme o seu CPF" done={cpfConfirmed} active={consent && !cpfConfirmed}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={cpfInput}
                onChange={(e) => { setCpfInput(formatCpf(e.target.value)); setCpfError(null); }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                aria-label="CPF"
                className={inputCls}
                disabled={cpfBusy}
              />
              <button type="button" className={btnGhost} onClick={saveCpf} disabled={cpfBusy || cpfConfirmed || typedCpf.length !== 11}>
                {cpfBusy ? 'Salvando…' : cpfConfirmed ? 'CPF confirmado' : 'Confirmar CPF'}
              </button>
            </div>
            {cpfConfirmed && <p className="text-[11px] text-emerald-700">CPF {maskCpf(typedCpf)} registrado para a sua assinatura.</p>}
            {cpfError && <Notice tone="bad">{cpfError}</Notice>}
          </Step>

          <Step n={4} title="Assine digitalmente" done={false} active={readState === 'done' && consent && cpfConfirmed}>
            <p className="text-xs leading-relaxed text-stone-600">
              Vamos enviar um código de 6 dígitos para o <b>WhatsApp do seu cadastro</b>. Você o digita no app e a assinatura é registrada.
            </p>
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-stone-500"><ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />{LOCATION_NOTICE}</p>
            <button type="button" className={`${btnPrimary} w-full`} onClick={sign} disabled={!canSign}>
              <FileText size={16} /> {signBusy ? 'Preparando a assinatura…' : 'Assinar digitalmente'}
            </button>
            {signError && <Notice tone="bad">{signError}</Notice>}
          </Step>
        </div>
      )}

      {challenge && (
        <CodeSheet
          challenge={challenge}
          onClose={() => setChallenge(null)}
          onResend={requestCode}
          onConfirm={(c, code) => confirmSignatureCode(c.challengeId, code, c.location)}
          onSigned={confirmed}
        />
      )}
    </div>
  );
};
