import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

const documents = vi.hoisted(() => ({ downloadDocumentFile: vi.fn(), getMyCpf: vi.fn(), saveMyCpf: vi.fn(), logJourneyEvent: vi.fn() }));
vi.mock('../../../lib/signatures/documents', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/signatures/documents')>()), ...documents }));

const api = vi.hoisted(() => ({ requestSignatureCode: vi.fn(), confirmSignatureCode: vi.fn() }));
vi.mock('../../../lib/signatures/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/signatures/api')>()), ...api }));

const receipt = vi.hoisted(() => ({ downloadReceipt: vi.fn() }));
vi.mock('../../../lib/signatures/receipt', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/signatures/receipt')>()), ...receipt }));

// O leitor real tem teste próprio: aqui ele é um painel com botões que simulam o que o leitor informa.
vi.mock('../../../components/signatures/PdfReader', async () => {
  const React = await import('react');
  type P = { track: boolean; onReady?: () => void; onProgress?: (s: unknown) => void; onError?: (e: unknown) => void };
  const snap = (seen: number, complete: boolean) => ({ pagesSeen: seen, pagesTotal: 3, endReached: complete, complete, percent: complete ? 100 : 33 });
  return {
    PdfReader: (p: P) => React.createElement('div', { 'data-testid': 'reader', 'data-track': String(p.track) },
      React.createElement('button', { onClick: () => p.onReady?.() }, 'abrir'),
      React.createElement('button', { onClick: () => p.onProgress?.(snap(1, false)) }, 'meio'),
      React.createElement('button', { onClick: () => p.onProgress?.(snap(3, true)) }, 'terminar leitura'),
      React.createElement('button', { onClick: () => p.onError?.(new Error('x')) }, 'quebrar')),
  };
});

import { DocumentSigning } from '../../../components/signatures/DocumentSigning';
import { SignatureError } from '../../../lib/signatures/api';
import { sha256Hex } from '../../../lib/signatures/hash';
import { SIGNATURES_CHANGED_EVENT } from '../../../lib/signatures/usePendingSignatures';
import type { MyDocumentRow } from '../../../lib/signatures/documents';

const DOC = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const BYTES = new TextEncoder().encode('%PDF-1.7 documento de teste').buffer as ArrayBuffer;
let SHA = '';
beforeAll(async () => { SHA = await sha256Hex(BYTES); });

const doc = (over: Partial<MyDocumentRow> = {}): MyDocumentRow => ({
  document_id: DOC, title: 'Termo de Uso', description: 'Regras do clube', version: 2, page_count: 3, size_bytes: 1000, content_sha256: SHA,
  storage_path: `${DOC}/${SHA}.pdf`, due_at: null, status: 'published', published_at: '2026-10-01T12:00:00Z',
  consent_text: 'Li e concordo com todos os termos do documento "Termo de Uso" (versão 2).', signed_at: null, signature_id: null, ...over,
});

const mount = (d: MyDocumentRow = doc()) => {
  const onBack = vi.fn();
  render(<DocumentSigning doc={d} currentUser={{ id: 'u1' }} onBack={onBack} />);
  return { onBack };
};

const events = () => documents.logJourneyEvent.mock.calls.map((c) => c[1]);
const signButton = () => screen.getByRole('button', { name: /Assinar digitalmente|Preparando/ });
const consentBox = () => screen.getByRole('checkbox');
const cpfInput = () => screen.getByLabelText('CPF');
const press = (name: string | RegExp) => act(async () => { fireEvent.click(screen.getByRole('button', { name })); });

/** Leva a tela até o ponto "tudo pronto para assinar". */
async function readyToSign() {
  await screen.findByTestId('reader');
  await press('abrir');
  await press('terminar leitura');
  await waitFor(() => expect(consentBox()).toBeEnabled());
  await act(async () => { fireEvent.click(consentBox()); });
  await waitFor(() => expect(consentBox()).toBeChecked());
  fireEvent.change(cpfInput(), { target: { value: '52998224725' } });
  await press('Confirmar CPF');
  await waitFor(() => expect(signButton()).toBeEnabled());
}

beforeEach(() => {
  Object.values({ ...documents, ...api, ...receipt }).forEach((f) => f.mockReset());
  receipt.downloadReceipt.mockResolvedValue(undefined);
  documents.downloadDocumentFile.mockResolvedValue(BYTES);
  documents.getMyCpf.mockResolvedValue(null);
  documents.saveMyCpf.mockResolvedValue(undefined);
  documents.logJourneyEvent.mockResolvedValue(undefined);
  api.requestSignatureCode.mockResolvedValue({ challengeId: 'CH1', phoneMasked: '(88) •••••-1234', expiresAt: new Date(Date.now() + 600_000).toISOString(), location: 'granted' });
  api.confirmSignatureCode.mockResolvedValue({ signatureId: 'S1', signedAt: '2026-10-07T15:00:00Z', seq: 4, replayed: false });
  URL.createObjectURL = vi.fn(() => 'blob:pdf');
  URL.revokeObjectURL = vi.fn();
});

describe('assinar um documento: ler → concordar → CPF → código', () => {
  it('caminho completo: cada passo libera o próximo e o servidor recebe a trilha NA ORDEM', async () => {
    mount();
    await screen.findByTestId('reader');

    // nada liberado antes da leitura
    expect(consentBox()).toBeDisabled();
    expect(signButton()).toBeDisabled();
    expect(screen.getByText(/Disponível depois que você ler/)).toBeInTheDocument();

    await press('abrir');
    await waitFor(() => expect(events()).toEqual(['viewed', 'read_started']));

    await press('terminar leitura');
    await waitFor(() => expect(consentBox()).toBeEnabled());
    expect(documents.logJourneyEvent).toHaveBeenLastCalledWith(DOC, 'read_completed', { pages_seen: 3, pages_total: 3 });
    expect(signButton()).toBeDisabled();

    await act(async () => { fireEvent.click(consentBox()); });
    await waitFor(() => expect(consentBox()).toBeChecked());
    expect(documents.logJourneyEvent).toHaveBeenLastCalledWith(DOC, 'consent_checked', undefined);
    expect(signButton()).toBeDisabled();                     // ainda falta o CPF

    fireEvent.change(cpfInput(), { target: { value: '52998224725' } });
    expect((cpfInput() as HTMLInputElement).value).toBe('529.982.247-25');
    await press('Confirmar CPF');
    expect(documents.saveMyCpf).toHaveBeenCalledWith('52998224725');
    await waitFor(() => expect(signButton()).toBeEnabled());

    expect(events()).toEqual(['viewed', 'read_started', 'read_completed', 'consent_checked']);
    expect(api.requestSignatureCode).not.toHaveBeenCalled(); // nada de código antes do clique

    // Clique em "Assinar digitalmente": pede o código (e a localização, dentro de requestSignatureCode)
    await press(/Assinar digitalmente/);
    expect(api.requestSignatureCode).toHaveBeenCalledTimes(1);
    expect(api.requestSignatureCode).toHaveBeenCalledWith(DOC);
    expect(await screen.findByText('Enviado para (88) •••••-1234')).toBeInTheDocument();

    const changed = vi.fn();
    window.addEventListener(SIGNATURES_CHANGED_EVENT, changed);
    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: '123456' } });
    await press('Assinar documento');

    expect(api.confirmSignatureCode).toHaveBeenCalledWith('CH1', '123456', 'granted');
    expect(await screen.findByText('Documento assinado')).toBeInTheDocument();
    expect(screen.getByText(/assinatura nº 4/)).toBeInTheDocument();
    await press('Baixar comprovante (PDF)');                 // recém-assinado: usa o id devolvido pela assinatura
    expect(receipt.downloadReceipt).toHaveBeenCalledWith('S1', { full: false });
    expect(screen.queryByText('Digite o código do WhatsApp')).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);                // lista e selo do menu se atualizam
    window.removeEventListener(SIGNATURES_CHANGED_EVENT, changed);
  });

  it('sem marcar "Li e concordo" não assina, mesmo com leitura feita e CPF confirmado', async () => {
    mount();
    await screen.findByTestId('reader');
    await press('abrir');
    await press('terminar leitura');
    await waitFor(() => expect(consentBox()).toBeEnabled());
    fireEvent.change(cpfInput(), { target: { value: '52998224725' } });
    await press('Confirmar CPF');
    await waitFor(() => expect(screen.getByRole('button', { name: 'CPF confirmado' })).toBeDisabled());
    expect(signButton()).toBeDisabled();                     // falta só o aceite

    await act(async () => { fireEvent.click(consentBox()); });
    await waitFor(() => expect(signButton()).toBeEnabled());

    await act(async () => { fireEvent.click(consentBox()); }); // desmarcar tira a liberação
    expect(signButton()).toBeDisabled();
  });

  it('leitura incompleta (só chegou ao meio) não registra "leu" nem libera o aceite', async () => {
    mount();
    await screen.findByTestId('reader');
    await press('abrir');
    await press('meio');
    expect(screen.getByText('1/3 páginas')).toBeInTheDocument();
    expect(consentBox()).toBeDisabled();
    expect(events()).not.toContain('read_completed');
  });

  it('o aceite mostra o texto exato que o banco grava na assinatura', async () => {
    mount();
    await screen.findByTestId('reader');
    expect(screen.getByText('Li e concordo com todos os termos do documento "Termo de Uso" (versão 2).')).toBeInTheDocument();
  });

  it('falha ao registrar a leitura: oferece tentar de novo e só libera o aceite depois de registrar', async () => {
    let falhou = false;
    documents.logJourneyEvent.mockImplementation(async (_d: string, kind: string) => {
      if (kind === 'read_completed' && !falhou) { falhou = true; throw { message: 'SIG_READ_INCOMPLETE' }; }
    });
    mount();
    await screen.findByTestId('reader');
    await press('abrir');
    await press('terminar leitura');

    expect(await screen.findByText(/faltam páginas/)).toBeInTheDocument();
    expect(consentBox()).toBeDisabled();

    await press('Tentar registrar de novo');
    await waitFor(() => expect(consentBox()).toBeEnabled());
  });

  it('falha ao registrar o aceite: avisa e não marca a caixa', async () => {
    documents.logJourneyEvent.mockImplementation(async (_d: string, kind: string) => {
      if (kind === 'consent_checked') throw { message: 'SIG_READ_REQUIRED' };
    });
    mount();
    await screen.findByTestId('reader');
    await press('abrir');
    await press('terminar leitura');
    await waitFor(() => expect(consentBox()).toBeEnabled());
    await act(async () => { fireEvent.click(consentBox()); });
    expect(await screen.findByText(/Leia o documento até o fim antes de concordar/)).toBeInTheDocument();
    expect(consentBox()).not.toBeChecked();
  });

  describe('CPF', () => {
    it('CPF já salvo vem preenchido e confirmado (não pede de novo)', async () => {
      documents.getMyCpf.mockResolvedValue('52998224725');
      mount();
      await waitFor(() => expect(screen.getByRole('button', { name: 'CPF confirmado' })).toBeDisabled());
      expect((cpfInput() as HTMLInputElement).value).toBe('529.982.247-25');
      expect(screen.getByText(/CPF •••\.982\.247-•• registrado/)).toBeInTheDocument();
      expect(documents.getMyCpf).toHaveBeenCalledWith('u1');
    });

    it('alterar o CPF salvo pede nova confirmação', async () => {
      documents.getMyCpf.mockResolvedValue('52998224725');
      mount();
      await waitFor(() => expect(screen.getByRole('button', { name: 'CPF confirmado' })).toBeDisabled());
      fireEvent.change(cpfInput(), { target: { value: '11144477735' } });
      expect(screen.getByRole('button', { name: 'Confirmar CPF' })).toBeEnabled();
    });

    it('CPF inválido é recusado na tela, sem chamar o servidor', async () => {
      mount();
      await screen.findByTestId('reader');
      fireEvent.change(cpfInput(), { target: { value: '11111111111' } });
      await press('Confirmar CPF');
      expect(screen.getByText(/CPF inválido/)).toBeInTheDocument();
      expect(documents.saveMyCpf).not.toHaveBeenCalled();
    });

    it('o servidor recusa trocar o CPF depois da 1ª assinatura: mostra o motivo', async () => {
      documents.saveMyCpf.mockRejectedValue({ message: 'SIG_CPF_LOCKED' });
      mount();
      await screen.findByTestId('reader');
      fireEvent.change(cpfInput(), { target: { value: '52998224725' } });
      await press('Confirmar CPF');
      expect(await screen.findByText(/não pode mais ser alterado/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirmar CPF' })).toBeEnabled();
    });
  });

  describe('ao tocar em "Assinar digitalmente"', () => {
    it('recusa do servidor (muitos pedidos) aparece na tela e a folha do código NÃO abre', async () => {
      api.requestSignatureCode.mockRejectedValue(new SignatureError('rate_limited'));
      mount();
      await readyToSign();
      await press(/Assinar digitalmente/);
      expect(await screen.findByText(/códigos demais/)).toBeInTheDocument();
      expect(screen.queryByText('Digite o código do WhatsApp')).toBeNull();
      expect(signButton()).toBeEnabled();                    // pode tentar de novo depois
    });

    it('sem telefone no cadastro: orienta procurar a administração', async () => {
      api.requestSignatureCode.mockRejectedValue(new SignatureError('no_phone'));
      mount();
      await readyToSign();
      await press(/Assinar digitalmente/);
      expect(await screen.findByText(/sem telefone/)).toBeInTheDocument();
    });

    it('código errado: a folha fica aberta, mostra as tentativas e não assina', async () => {
      api.confirmSignatureCode.mockRejectedValue(new SignatureError('wrong_code', { attemptsLeft: 4 }));
      mount();
      await readyToSign();
      await press(/Assinar digitalmente/);
      await screen.findByText('Digite o código do WhatsApp');
      fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: '000000' } });
      await press('Assinar documento');
      expect(await screen.findByText('Código incorreto. Restam 4 tentativas.')).toBeInTheDocument();
      expect(screen.queryByText('Documento assinado')).toBeNull();
    });

    it('explica a localização (opcional) ao lado do botão', async () => {
      mount();
      await screen.findByTestId('reader');
      expect(screen.getByText(/É opcional: se você não permitir/)).toBeInTheDocument();
    });
  });

  it('erro ao exibir o PDF bloqueia a assinatura mesmo com os outros passos feitos', async () => {
    mount();
    await readyToSign();
    expect(signButton()).toBeEnabled();
    await press('quebrar');
    expect(signButton()).toBeDisabled();
  });

  describe('o arquivo', () => {
    it('arquivo diferente do publicado (hash não confere) NÃO abre para leitura', async () => {
      documents.downloadDocumentFile.mockResolvedValue(new TextEncoder().encode('outro arquivo').buffer);
      mount();
      expect(await screen.findByText(/não confere com o que foi publicado/)).toBeInTheDocument();
      expect(screen.queryByTestId('reader')).toBeNull();
    });

    it('falha no download: mostra o motivo e permite tentar de novo', async () => {
      documents.downloadDocumentFile.mockRejectedValueOnce({ message: 'SIG_FILE_UNAVAILABLE' });
      mount();
      expect(await screen.findByText(/baixar o documento/)).toBeInTheDocument();
      await press('Tentar de novo');
      expect(await screen.findByTestId('reader')).toBeInTheDocument();
      expect(documents.downloadDocumentFile).toHaveBeenCalledTimes(2);
    });

    it('oferece baixar uma cópia do PDF', async () => {
      mount();
      await screen.findByTestId('reader');
      expect(screen.getByRole('link', { name: /Baixar uma cópia/ })).toHaveAttribute('href', 'blob:pdf');
    });
  });

  it('documento já assinado: só consulta (sem passos, sem trilha, sem rastrear leitura)', async () => {
    mount(doc({ signed_at: '2026-10-05T15:30:00Z', signature_id: 'S9' }));
    await screen.findByTestId('reader');
    expect(screen.getByText('Documento assinado')).toBeInTheDocument();
    expect(screen.getByText('05/10/2026 às 12:30')).toBeInTheDocument();
    expect(screen.getByTestId('reader')).toHaveAttribute('data-track', 'false');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Assinar digitalmente/ })).toBeNull();

    await press('abrir');
    await press('terminar leitura');
    expect(documents.logJourneyEvent).not.toHaveBeenCalled();
    expect(documents.getMyCpf).not.toHaveBeenCalled();
  });

  it('documento já assinado oferece o comprovante em PDF, na cópia do sócio (CPF e telefone mascarados)', async () => {
    mount(doc({ signed_at: '2026-10-05T15:30:00Z', signature_id: 'S9' }));
    await screen.findByTestId('reader');
    await press('Baixar comprovante (PDF)');
    expect(receipt.downloadReceipt).toHaveBeenCalledWith('S9', { full: false });
  });

  it('documento pendente não mostra comprovante (ainda não há assinatura)', async () => {
    mount();
    await screen.findByTestId('reader');
    expect(screen.queryByRole('button', { name: /comprovante/i })).toBeNull();
  });

  it('falha ao gerar o comprovante mostra o motivo e permite tentar de novo', async () => {
    receipt.downloadReceipt.mockRejectedValueOnce(new Error('Failed to fetch'));
    mount(doc({ signed_at: '2026-10-05T15:30:00Z', signature_id: 'S9' }));
    await screen.findByTestId('reader');
    await press('Baixar comprovante (PDF)');
    expect(await screen.findByRole('alert')).toHaveTextContent('conexão');
    await press('Baixar comprovante (PDF)');
    expect(receipt.downloadReceipt).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('mostra o prazo e o botão de voltar', async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const { onBack } = mount(doc({ due_at: soon }));
    expect(screen.getByText(/Vence em 2 dias|Vence em 3 dias|Vence em 1 dia/)).toBeInTheDocument();
    expect(screen.getByText('Versão 2 · 3 páginas')).toBeInTheDocument();
    await press(/Documentos/);
    expect(onBack).toHaveBeenCalled();
  });
});
