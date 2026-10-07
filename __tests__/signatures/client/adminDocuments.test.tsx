import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

const api = vi.hoisted(() => ({
  listAdminDocuments: vi.fn(), listRecipients: vi.fn(), listSignableMembers: vi.fn(), getDocumentDescription: vi.fn(),
  prepareFile: vi.fn(), createDraft: vi.fn(), updateDraft: vi.fn(), uploadDraftFile: vi.fn(), removeDraftFile: vi.fn(),
  setRecipients: vi.fn(), publishDocument: vi.fn(), drainNotifications: vi.fn(), resendFailed: vi.fn(), archiveDocument: vi.fn(),
  removeRecipient: vi.fn(), updateDue: vi.fn(), addRecipients: vi.fn(), verifyIntegrity: vi.fn(), deleteDraft: vi.fn(),
}));
vi.mock('../../../lib/signatures/admin', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../lib/signatures/admin')>()), ...api }));

import { AdminDocuments } from '../../../components/signatures/admin/AdminDocuments';
import { ConfirmProvider } from '../../../components/ui/ConfirmProvider';
import type { OverviewRow, RecipientRow } from '../../../lib/signatures/admin';

const A = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const B = '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';
const C = 'c0ffee00-1111-4222-8333-444455556666';

const doc = (id: string, title: string, over: Partial<OverviewRow> = {}): OverviewRow => ({
  id, title, version: 1, status: 'published', audience_mode: 'all', applies_to_new_members: false, page_count: 4, due_at: null,
  created_at: '2026-10-01T12:00:00Z', published_at: '2026-10-02T12:00:00Z', recipients: 26, signed: 3, notifications_pending: 0, notifications_failed: 0, no_phone: 0, ...over,
});
const person = (id: string, name: string, over: Partial<RecipientRow> = {}): RecipientRow => ({
  profile_id: id, name, phone: '85999990000', source: 'all', signed_at: null, signature_id: null, notification_status: 'sent',
  notification_error: null, last_notified_at: '2026-10-02T12:05:00Z', reminders_sent: 0, ...over,
});

const renderPage = () => render(<ConfirmProvider><AdminDocuments /></ConfirmProvider>);

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.listAdminDocuments.mockResolvedValue([
    doc(A, 'Termo de Uso'),
    doc(B, 'Regimento (rascunho)', { status: 'draft', published_at: null, recipients: 0, signed: 0 }),
    doc(C, 'Autorização antiga', { status: 'archived', signed: 26 }),
  ]);
  api.listSignableMembers.mockResolvedValue([
    { id: 'm1', name: 'Ana Souza', phone: '85911112222', role: 'socio' },
    { id: 'm2', name: 'Bruno Lima', phone: null, role: 'socio' },
  ]);
  api.listRecipients.mockResolvedValue([]);
  api.getDocumentDescription.mockResolvedValue('');
  api.drainNotifications.mockResolvedValue({ sent: 0, failed: 0, rounds: 1, configured: true, finished: true });
});

describe('lista de documentos (admin)', () => {
  it('separa rascunhos, publicados e arquivados, com o andamento das assinaturas', async () => {
    renderPage();
    const published = await screen.findByRole('region', { name: 'Publicados' });
    expect(published).toHaveTextContent('Termo de Uso');
    expect(published).toHaveTextContent('3 de 26 assinaram');
    expect(screen.getByRole('region', { name: 'Rascunhos' })).toHaveTextContent('Regimento (rascunho)');
    expect(screen.getByRole('region', { name: 'Arquivados' })).toHaveTextContent('Todos assinaram');
  });

  it('destaca o que pede ação: falhas de envio e sócios sem telefone', async () => {
    api.listAdminDocuments.mockResolvedValue([doc(A, 'Termo', { notifications_failed: 2, no_phone: 1 })]);
    renderPage();
    expect(await screen.findByText('2 falhas de envio')).toBeInTheDocument();
    expect(screen.getByText('1 sem telefone')).toBeInTheDocument();
  });

  it('sem documentos: orienta o primeiro passo', async () => {
    api.listAdminDocuments.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Nenhum documento ainda/)).toBeInTheDocument();
  });

  it('falha ao carregar mostra o motivo e permite tentar de novo', async () => {
    api.listAdminDocuments.mockRejectedValueOnce(new Error('Failed to fetch'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('conexão');
    api.listAdminDocuments.mockResolvedValueOnce([doc(A, 'Termo de Uso')]);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Termo de Uso')).toBeInTheDocument();
  });
});

describe('novo documento: salvar e publicar', () => {
  const file = new File(['%PDF-1.4'], 'termo-de-uso.pdf', { type: 'application/pdf' });
  const prepared = { file, fileName: 'termo-de-uso.pdf', sizeBytes: 8, pageCount: 5, sha256: 'b'.repeat(64) };

  const openForm = async () => {
    renderPage();
    await screen.findByText('Termo de Uso');
    fireEvent.click(screen.getByRole('button', { name: /Novo documento/ }));
    await screen.findByRole('form', { name: 'Novo documento' });
  };
  const attach = async () => {
    api.prepareFile.mockResolvedValue(prepared);
    fireEvent.change(document.getElementById('sig-file')!, { target: { files: [file] } });
    await screen.findByText(/5 páginas/);
  };

  it('só deixa salvar com título (3+ letras) e PDF', async () => {
    await openForm();
    const save = screen.getByRole('button', { name: /Salvar rascunho/ });
    expect(save).toBeDisabled();
    await attach(); // o título nasce do nome do arquivo
    expect(screen.getByLabelText('Título')).toHaveValue('termo de uso');
    expect(save).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'ab' } });
    expect(save).toBeDisabled();
  });

  it('PDF recusado mostra o motivo e não libera o salvar', async () => {
    await openForm();
    const { PdfRejectedError } = await import('../../../lib/signatures/admin');
    api.prepareFile.mockRejectedValue(new PdfRejectedError('too_big'));
    fireEvent.change(document.getElementById('sig-file')!, { target: { files: [file] } });
    expect(await screen.findByText(/mais de 10 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar rascunho/ })).toBeDisabled();
  });

  it('salvar rascunho: cria a linha, DEPOIS envia o PDF para o caminho devolvido; nada é publicado', async () => {
    const order: string[] = [];
    api.createDraft.mockImplementation(async () => { order.push('cria'); return { id: A, storagePath: `${A}/x.pdf`, version: 1 }; });
    api.uploadDraftFile.mockImplementation(async () => { order.push('envia'); });
    await openForm(); await attach();
    fireEvent.click(screen.getByRole('button', { name: /Salvar rascunho/ }));
    await screen.findByText(/Rascunho salvo/);
    expect(order).toEqual(['cria', 'envia']);
    expect(api.uploadDraftFile).toHaveBeenCalledWith(`${A}/x.pdf`, file);
    expect(api.publishDocument).not.toHaveBeenCalled();
    expect(api.setRecipients).not.toHaveBeenCalled(); // público "todos": o banco monta a lista ao publicar
  });

  it('publicar pede confirmação (com o número de avisos) e, se cancelar, não grava nada', async () => {
    await openForm(); await attach();
    fireEvent.click(screen.getByRole('button', { name: /Publicar…/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('2 sócios receberão um WhatsApp');
    expect(dialog).toHaveTextContent('não podem mais ser alterados');
    expect(dialog).toHaveTextContent('1 sócio está sem telefone');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.createDraft).not.toHaveBeenCalled();
    expect(api.publishDocument).not.toHaveBeenCalled();
  });

  it('publicar confirmado: cria → envia o PDF → publica → despacha os avisos, nessa ordem, e mostra o resultado', async () => {
    const order: string[] = [];
    api.createDraft.mockImplementation(async () => { order.push('cria'); return { id: A, storagePath: `${A}/x.pdf`, version: 1 }; });
    api.uploadDraftFile.mockImplementation(async () => { order.push('envia'); });
    api.publishDocument.mockImplementation(async () => { order.push('publica'); return { id: A, recipients: 2, queued: 1, skippedNoPhone: 1 }; });
    api.drainNotifications.mockImplementation(async () => { order.push('despacha'); return { sent: 1, failed: 0, rounds: 1, configured: true, finished: true }; });
    api.listRecipients.mockResolvedValue([person('m1', 'Ana Souza')]);
    await openForm(); await attach();
    fireEvent.click(screen.getByRole('button', { name: /Publicar…/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publicar e enviar avisos' }));
    expect(await screen.findByText(/Documento publicado para 2 sócios \(1 sem telefone, sem aviso\)\. 1 aviso enviado\./)).toBeInTheDocument();
    expect(order).toEqual(['cria', 'envia', 'publica', 'despacha']);
  });

  it('se o despacho falhar, o documento FICA publicado e a tela explica que os avisos seguem na fila', async () => {
    api.createDraft.mockResolvedValue({ id: A, storagePath: `${A}/x.pdf`, version: 1 });
    api.uploadDraftFile.mockResolvedValue(undefined);
    api.publishDocument.mockResolvedValue({ id: A, recipients: 2, queued: 2, skippedNoPhone: 0 });
    api.drainNotifications.mockRejectedValue(new Error('Failed to fetch'));
    api.listRecipients.mockResolvedValue([]);
    await openForm(); await attach();
    fireEvent.click(screen.getByRole('button', { name: /Publicar…/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publicar e enviar avisos' }));
    expect(await screen.findByText(/Não foi possível enviar os avisos agora/)).toHaveTextContent('continuam na fila');
  });

  it('WhatsApp não configurado: avisa que os avisos ficaram na fila', async () => {
    api.createDraft.mockResolvedValue({ id: A, storagePath: `${A}/x.pdf`, version: 1 });
    api.uploadDraftFile.mockResolvedValue(undefined);
    api.publishDocument.mockResolvedValue({ id: A, recipients: 2, queued: 2, skippedNoPhone: 0 });
    api.drainNotifications.mockResolvedValue({ sent: 0, failed: 0, rounds: 1, configured: false, finished: true });
    api.listRecipients.mockResolvedValue([]);
    await openForm(); await attach();
    fireEvent.click(screen.getByRole('button', { name: /Publicar…/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publicar e enviar avisos' }));
    expect(await screen.findByText(/não está configurado no servidor/)).toBeInTheDocument();
  });

  it('falha ao enviar o PDF depois de criar o rascunho: mostra o erro e o 2º clique ATUALIZA o mesmo rascunho (sem duplicar)', async () => {
    api.createDraft.mockResolvedValue({ id: A, storagePath: `${A}/x.pdf`, version: 1 });
    api.uploadDraftFile.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(undefined);
    api.updateDraft.mockResolvedValue({ storagePath: `${A}/x.pdf`, previousStoragePath: null });
    await openForm(); await attach();
    fireEvent.click(screen.getByRole('button', { name: /Salvar rascunho/ }));
    expect(await screen.findByText(/Não foi possível concluir/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Salvar rascunho/ }));
    await screen.findByText(/Rascunho salvo/);
    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(api.updateDraft).toHaveBeenCalledTimes(1);
  });

  it('"só alguns sócios": exige escolher alguém e grava a lista depois do arquivo', async () => {
    api.createDraft.mockResolvedValue({ id: A, storagePath: `${A}/x.pdf`, version: 1 });
    api.uploadDraftFile.mockResolvedValue(undefined);
    api.setRecipients.mockResolvedValue(1);
    await openForm(); await attach();
    fireEvent.click(screen.getByLabelText('Só alguns sócios'));
    expect(screen.getByRole('button', { name: /Salvar rascunho/ })).toBeDisabled();
    fireEvent.click(await screen.findByLabelText(/Ana Souza/));
    expect(screen.getByText('1 de 2 escolhidos')).toBeInTheDocument();
    expect(screen.queryByText(/Vale também para quem virar sócio/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Salvar rascunho/ }));
    await screen.findByText(/Rascunho salvo/);
    expect(api.setRecipients).toHaveBeenCalledWith(A, ['m1']);
    expect(api.createDraft.mock.calls[0][0]).toMatchObject({ audienceMode: 'selected', appliesToNewMembers: false });
  });

  it('a busca filtra a lista de sócios por nome', async () => {
    await openForm();
    fireEvent.click(screen.getByLabelText('Só alguns sócios'));
    await screen.findByLabelText(/Ana Souza/);
    fireEvent.change(screen.getByLabelText('Buscar sócio'), { target: { value: 'bru' } });
    expect(screen.queryByLabelText(/Ana Souza/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Bruno Lima/)).toBeInTheDocument();
  });
});

describe('detalhe de um documento publicado', () => {
  const open = async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Termo de Uso'));
    await screen.findByRole('region', { name: 'Resumo' });
  };

  it('mostra quem assinou e quem falta, com o estado do aviso de cada um', async () => {
    api.listRecipients.mockResolvedValue([
      person('p1', 'Ana', { signed_at: '2026-10-05T15:00:00Z' }),
      person('p2', 'Bruno', { notification_status: 'failed', notification_error: 'numero invalido' }),
      person('p3', 'Carla', { phone: null, notification_status: 'skipped' }),
      person('p4', 'Davi', { notification_status: 'queued', last_notified_at: null }),
    ]);
    await open();
    const list = await screen.findByRole('region', { name: 'Destinatários' });
    expect(await within(list).findByText(/Assinou em 05\/10\/2026/)).toBeInTheDocument();
    expect(list).toHaveTextContent('Falha no envio');
    expect(list).toHaveTextContent('numero invalido');
    expect(list).toHaveTextContent('Sem telefone');
    expect(list).toHaveTextContent('Aviso na fila');
    expect(screen.getByRole('region', { name: 'Resumo' })).toHaveTextContent('1 de 4 assinaram');
    expect(screen.getByRole('progressbar', { name: 'Assinaturas' })).toHaveAttribute('aria-valuenow', '1');
  });

  it('o filtro "Faltam" esconde quem já assinou', async () => {
    api.listRecipients.mockResolvedValue([person('p1', 'Ana', { signed_at: '2026-10-05T15:00:00Z' }), person('p2', 'Bruno')]);
    await open();
    await screen.findByText('Bruno');
    fireEvent.click(screen.getByRole('tab', { name: /Faltam/ }));
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
    expect(screen.getByText('Bruno')).toBeInTheDocument();
  });

  it('"Reenviar falhas" só aparece com falha, recoloca na fila e despacha', async () => {
    api.listRecipients.mockResolvedValue([person('p2', 'Bruno', { notification_status: 'failed' })]);
    api.resendFailed.mockResolvedValue(1);
    api.drainNotifications.mockResolvedValue({ sent: 1, failed: 0, rounds: 1, configured: true, finished: true });
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /Reenviar 1 falha/ }));
    expect(await screen.findByText(/1 aviso voltou para a fila; 1 enviados agora/)).toBeInTheDocument();
    expect(api.resendFailed).toHaveBeenCalledWith(A);
  });

  it('sem falhas nem fila, os botões de reenvio não aparecem', async () => {
    api.listRecipients.mockResolvedValue([person('p2', 'Bruno')]);
    await open();
    await screen.findByText('Bruno');
    expect(screen.queryByRole('button', { name: /Reenviar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar .* agora/ })).not.toBeInTheDocument();
  });

  it('arquivar pede confirmação, avisa que não reabre e só então arquiva', async () => {
    api.listRecipients.mockResolvedValue([person('p2', 'Bruno')]);
    api.archiveDocument.mockResolvedValue(undefined);
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Arquivar/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Não dá para reabrir');
    expect(api.archiveDocument).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }));
    await screen.findByText('Documento arquivado.');
    expect(api.archiveDocument).toHaveBeenCalledWith(A);
  });

  it('cancelar o diálogo de arquivar não arquiva nada', async () => {
    api.listRecipients.mockResolvedValue([person('p2', 'Bruno')]);
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Arquivar/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.archiveDocument).not.toHaveBeenCalled();
  });

  it('tirar da lista só existe para quem ainda não assinou', async () => {
    api.listRecipients.mockResolvedValue([person('p1', 'Ana', { signed_at: '2026-10-05T15:00:00Z' }), person('p2', 'Bruno')]);
    await open();
    await screen.findByText('Bruno');
    expect(screen.queryByRole('button', { name: 'Tirar Ana da lista' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tirar Bruno da lista' })).toBeInTheDocument();
  });

  it('documento arquivado: sem ações de publicado (prazo, incluir, arquivar, reenviar), mas com nova versão e integridade', async () => {
    api.listRecipients.mockResolvedValue([person('p1', 'Ana', { signed_at: '2026-10-05T15:00:00Z' })]);
    renderPage();
    fireEvent.click(await screen.findByText('Autorização antiga'));
    await screen.findByRole('region', { name: 'Resumo' });
    expect(screen.queryByRole('button', { name: /Arquivar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prazo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Incluir sócios/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nova versão/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conferir integridade/ })).toBeInTheDocument();
  });

  it('conferir integridade: mostra "íntegras" ou os problemas encontrados', async () => {
    api.listRecipients.mockResolvedValue([]);
    api.verifyIntegrity.mockResolvedValueOnce({ checked: 3, ok: true, problems: [] });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Conferir integridade/ }));
    expect(await screen.findByText('Assinaturas íntegras')).toBeInTheDocument();
    api.verifyIntegrity.mockResolvedValueOnce({ checked: 3, ok: false, problems: [{ seq: 2, problem: 'chain_broken' }] });
    fireEvent.click(screen.getByRole('button', { name: /Conferir integridade/ }));
    expect(await screen.findByText(/inconsistência/)).toBeInTheDocument();
    expect(screen.getByText(/#2 chain_broken/)).toBeInTheDocument();
  });

  it('nova versão abre o formulário avisando que a anterior sai de circulação só ao publicar', async () => {
    api.listRecipients.mockResolvedValue([]);
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Nova versão/ }));
    expect(await screen.findByRole('form', { name: /Nova versão de "Termo de Uso"/ })).toBeInTheDocument();
    expect(screen.getByText(/Só ao publicar a versão 1 sai de circulação/)).toBeInTheDocument();
  });

  it('erro do banco ao arquivar vira frase, não SIG_*', async () => {
    api.listRecipients.mockResolvedValue([]);
    api.archiveDocument.mockRejectedValue({ message: 'SIG_NOT_PUBLISHED' });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Arquivar/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Arquivar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não está publicado');
  });
});

describe('rascunho', () => {
  it('abrir um rascunho edita (não acompanha) e traz título e descrição de volta', async () => {
    api.getDocumentDescription.mockResolvedValue('Regras de convivência');
    renderPage();
    fireEvent.click(await screen.findByText('Regimento (rascunho)'));
    const form = await screen.findByRole('form', { name: 'Editar rascunho' });
    expect(within(form).getByLabelText('Título')).toHaveValue('Regimento (rascunho)');
    await waitFor(() => expect(within(form).getByLabelText(/Descrição/)).toHaveValue('Regras de convivência'));
    // o arquivo já está lá: dá para salvar sem anexar de novo
    expect(within(form).getByRole('button', { name: /Salvar rascunho/ })).toBeEnabled();
  });

  it('apagar rascunho pede confirmação antes', async () => {
    api.deleteDraft.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Apagar rascunho "Regimento/ }));
    const dialog = await screen.findByRole('dialog');
    expect(api.deleteDraft).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apagar rascunho' }));
    await waitFor(() => expect(api.deleteDraft).toHaveBeenCalledWith(B));
  });
});
