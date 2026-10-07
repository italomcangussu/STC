import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

const listMyDocuments = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/signatures/documents', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/signatures/documents')>()), listMyDocuments }));

// A tela de assinatura tem teste próprio: aqui ela é só um marcador.
vi.mock('../../../components/signatures/DocumentSigning', async () => {
  const React = await import('react');
  return {
    DocumentSigning: (p: { doc: { title: string }; onBack: () => void }) =>
      React.createElement('div', { 'data-testid': 'signing' }, p.doc.title, React.createElement('button', { onClick: p.onBack }, 'voltar')),
  };
});

import { DocumentsPage } from '../../../components/signatures/DocumentsPage';
import { SIGNATURES_CHANGED_EVENT } from '../../../lib/signatures/usePendingSignatures';
import type { MyDocumentRow } from '../../../lib/signatures/documents';
import type { User } from '../../../types';

const A = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const B = '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';
const C = 'c0ffee00-1111-4222-8333-444455556666';

const row = (id: string, title: string, over: Partial<MyDocumentRow> = {}): MyDocumentRow => ({
  document_id: id, title, description: null, version: 1, page_count: 4, size_bytes: 1000, content_sha256: 'a'.repeat(64), storage_path: `${id}/x.pdf`,
  due_at: null, status: 'published', published_at: '2026-10-01T12:00:00Z', consent_text: 'Li e concordo.', signed_at: null, signature_id: null, ...over,
});
const user = (role: string) => ({ id: 'u1', name: 'Ana', role }) as unknown as User;

beforeEach(() => {
  listMyDocuments.mockReset();
  listMyDocuments.mockResolvedValue([
    row(A, 'Termo de Uso', { due_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }),
    row(B, 'Regimento 2025', { signed_at: '2026-09-20T15:00:00Z', signature_id: 'S1', page_count: 1 }),
  ]);
  window.location.hash = '';
});
afterEach(() => { window.location.hash = ''; });

describe('aba Documentos e Assinaturas', () => {
  it('separa "Para assinar" de "Já assinados", com prazo e data da assinatura', async () => {
    render(<DocumentsPage currentUser={user('socio')} />);
    const pending = await screen.findByRole('region', { name: 'Documentos pendentes' });
    expect(pending).toHaveTextContent('Para assinar (1)');
    expect(pending).toHaveTextContent('Termo de Uso');
    expect(pending).toHaveTextContent('Pendente');
    expect(pending).toHaveTextContent(/Vence em/);
    expect(pending).toHaveTextContent('4 páginas · versão 1');
    expect(pending).toHaveTextContent('Ler e assinar');

    const done = screen.getByRole('region', { name: 'Documentos assinados' });
    expect(done).toHaveTextContent('Já assinados (1)');
    expect(done).toHaveTextContent('Regimento 2025');
    expect(done).toHaveTextContent('Assinado em 20/09/2026');
    expect(done).toHaveTextContent('1 página ·');
    expect(done).toHaveTextContent('Ver');
  });

  it('explica como funciona a assinatura em 4 passos', async () => {
    render(<DocumentsPage currentUser={user('socio')} />);
    await screen.findByText('Para assinar (1)');
    expect(screen.getByText('Como funciona a assinatura?')).toBeInTheDocument();
    expect(screen.getByText(/código de 6 dígitos no WhatsApp/)).toBeInTheDocument();
  });

  it('tocar num documento abre a leitura; voltar retorna à lista', async () => {
    render(<DocumentsPage currentUser={user('socio')} />);
    const card = await screen.findByRole('button', { name: /Termo de Uso/ });
    await act(async () => { fireEvent.click(card); });
    await waitFor(() => expect(screen.getByTestId('signing')).toHaveTextContent('Termo de Uso'));
    expect(window.location.hash).toBe(`#documentos/${A}`);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'voltar' })); });
    await waitFor(() => expect(screen.queryByTestId('signing')).toBeNull());
    expect(window.location.hash).toBe('#documentos');
    expect(screen.getByText('Para assinar (1)')).toBeInTheDocument();
  });

  it('o link do WhatsApp (/#documentos/<id>) abre direto a leitura', async () => {
    window.location.hash = `#documentos/${A}`;
    render(<DocumentsPage currentUser={user('socio')} />);
    expect(await screen.findByTestId('signing')).toHaveTextContent('Termo de Uso');
  });

  it('com o app já aberto, mudar o # troca de documento', async () => {
    render(<DocumentsPage currentUser={user('socio')} />);
    await screen.findByText('Para assinar (1)');
    await act(async () => { window.location.hash = `#documentos/${B}`; window.dispatchEvent(new Event('hashchange')); });
    expect(await screen.findByTestId('signing')).toHaveTextContent('Regimento 2025');
  });

  it('link de documento que não é meu (ou já encerrado): avisa e mostra a lista', async () => {
    window.location.hash = `#documentos/${C}`;
    render(<DocumentsPage currentUser={user('socio')} />);
    expect(await screen.findByText('Documento indisponível')).toBeInTheDocument();
    expect(screen.queryByTestId('signing')).toBeNull();
    expect(screen.getByText('Para assinar (1)')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ver meus documentos' })); });
    expect(window.location.hash).toBe('#documentos');
  });

  it('lista vazia: explica que o aviso chega pelo WhatsApp', async () => {
    listMyDocuments.mockResolvedValue([]);
    render(<DocumentsPage currentUser={user('socio')} />);
    expect(await screen.findByText('Nenhum documento por aqui')).toBeInTheDocument();
  });

  it('tudo assinado: mostra "Tudo em dia"', async () => {
    listMyDocuments.mockResolvedValue([row(B, 'Regimento 2025', { signed_at: '2026-09-20T15:00:00Z', signature_id: 'S1' })]);
    render(<DocumentsPage currentUser={user('socio')} />);
    expect(await screen.findByText(/Tudo em dia/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Documentos pendentes' })).toBeNull();
  });

  it('falha ao carregar: mostra o motivo e tenta de novo', async () => {
    listMyDocuments.mockRejectedValueOnce(new Error('Failed to fetch'));
    render(<DocumentsPage currentUser={user('socio')} />);
    expect(await screen.findByText(/falar com o servidor/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' })); });
    expect(await screen.findByText('Para assinar (1)')).toBeInTheDocument();
  });

  it('recarrega a lista quando alguém assina (aviso do app)', async () => {
    render(<DocumentsPage currentUser={user('socio')} />);
    await screen.findByText('Para assinar (1)');
    expect(listMyDocuments).toHaveBeenCalledTimes(1);

    listMyDocuments.mockResolvedValue([row(A, 'Termo de Uso', { signed_at: '2026-10-07T15:00:00Z', signature_id: 'S2' })]);
    await act(async () => { window.dispatchEvent(new Event(SIGNATURES_CHANGED_EVENT)); });
    expect(await screen.findByText(/Tudo em dia/)).toBeInTheDocument();
    expect(listMyDocuments).toHaveBeenCalledTimes(2);
  });

  it('administrador também assina (é sócio)', async () => {
    render(<DocumentsPage currentUser={user('admin')} />);
    expect(await screen.findByText('Para assinar (1)')).toBeInTheDocument();
  });

  it.each(['lanchonete', undefined])('papel "%s": só sócios — e nem consulta o servidor', async (role) => {
    render(<DocumentsPage currentUser={user(role as string)} />);
    expect(screen.getByText('Só para sócios')).toBeInTheDocument();
    expect(listMyDocuments).not.toHaveBeenCalled();
  });
});
