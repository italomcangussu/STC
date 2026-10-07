import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const tableResult = vi.hoisted(() => ({ value: { data: [] as unknown, error: null as unknown } }));
const openPdf = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'in', 'eq']) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve(tableResult.value);
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(tableResult.value).then(res);
  return { supabase: { rpc, from: () => chain, storage: { from: () => ({ upload, remove }) } } };
});
vi.mock('../../../lib/signatures/pdf', () => ({ openPdf }));

import {
  addRecipients, adminErrorMessage, archiveDocument, createDraft, deleteDraft, drainNotifications, listAdminDocuments, listSignableMembers,
  MAX_PDF_BYTES, PdfRejectedError, prepareFile, publishDocument, removeRecipient, resendFailed, setRecipients, updateDraft, updateDue, verifyIntegrity,
  type PreparedFile,
} from '../../../lib/signatures/admin';
import type { DispatchSummary } from '../../../lib/signatures/api';

const ID = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const file: PreparedFile = { file: new File(['%PDF-1.4'], 'termo.pdf'), fileName: 'termo.pdf', sizeBytes: 8, pageCount: 3, sha256: 'a'.repeat(64) };
const pdfFile = (body: string, name = 'termo.pdf') => new File([body], name, { type: 'application/pdf' });

beforeEach(() => {
  rpc.mockReset(); upload.mockReset(); remove.mockReset(); openPdf.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  upload.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  tableResult.value = { data: [], error: null };
});

describe('prepareFile: o que o banco exige do PDF, conferido antes de enviar', () => {
  it('lê páginas, tamanho e SHA-256 do conteúdo real', async () => {
    openPdf.mockResolvedValue({ pageCount: 6, destroy: vi.fn(async () => {}) });
    const p = await prepareFile(pdfFile('%PDF-1.7 conteudo'));
    expect(p.pageCount).toBe(6);
    expect(p.sizeBytes).toBe(17);
    expect(p.fileName).toBe('termo.pdf');
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    // o mesmo conteúdo dá o mesmo hash; outro conteúdo, outro
    const again = await prepareFile(pdfFile('%PDF-1.7 conteudo'));
    const other = await prepareFile(pdfFile('%PDF-1.7 conteudO'));
    expect(again.sha256).toBe(p.sha256);
    expect(other.sha256).not.toBe(p.sha256);
  });

  it('libera o leitor depois de contar as páginas', async () => {
    const destroy = vi.fn(async () => {});
    openPdf.mockResolvedValue({ pageCount: 1, destroy });
    await prepareFile(pdfFile('%PDF-1.7 x'));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('recusa arquivo vazio, acima de 10 MB e o que não é PDF (pelo cabeçalho, não pela extensão)', async () => {
    await expect(prepareFile(pdfFile(''))).rejects.toMatchObject({ reason: 'empty' });
    const big = new File([new Uint8Array(MAX_PDF_BYTES + 1)], 'grande.pdf', { type: 'application/pdf' });
    await expect(prepareFile(big)).rejects.toMatchObject({ reason: 'too_big' });
    await expect(prepareFile(pdfFile('MZ executavel disfarcado', 'virus.pdf'))).rejects.toMatchObject({ reason: 'not_pdf' });
    expect(openPdf).not.toHaveBeenCalled();
  });

  it('aceita exatamente 10 MB', async () => {
    openPdf.mockResolvedValue({ pageCount: 2, destroy: vi.fn(async () => {}) });
    const body = new Uint8Array(MAX_PDF_BYTES);
    body.set(new TextEncoder().encode('%PDF-1.4'));
    const p = await prepareFile(new File([body], 'limite.pdf'));
    expect(p.sizeBytes).toBe(MAX_PDF_BYTES);
  });

  it('PDF que o leitor não abre (protegido/corrompido) é recusado, e 0 ou mais de 1000 páginas também', async () => {
    openPdf.mockRejectedValueOnce(new Error('Invalid PDF structure'));
    await expect(prepareFile(pdfFile('%PDF-1.4 quebrado'))).rejects.toMatchObject({ reason: 'unreadable' });
    openPdf.mockResolvedValueOnce({ pageCount: 1001, destroy: vi.fn(async () => {}) });
    await expect(prepareFile(pdfFile('%PDF-1.4 enorme'))).rejects.toMatchObject({ reason: 'unreadable' });
    openPdf.mockResolvedValueOnce({ pageCount: 0, destroy: vi.fn(async () => {}) });
    await expect(prepareFile(pdfFile('%PDF-1.4 vazio'))).rejects.toMatchObject({ reason: 'unreadable' });
  });
});

describe('rascunho: o que vai ao banco', () => {
  it('createDraft manda título aparado, arquivo e público; "vale para sócio novo" só no modo "todos"', async () => {
    rpc.mockResolvedValue({ data: { id: ID, storage_path: `${ID}/${'a'.repeat(64)}.pdf`, version: 1 }, error: null });
    const r = await createDraft({ title: '  Termo de uso  ', description: ' regras ', dueAt: '2026-12-01T02:59:00.000Z', audienceMode: 'all', appliesToNewMembers: true }, file);
    expect(r).toEqual({ id: ID, storagePath: `${ID}/${'a'.repeat(64)}.pdf`, version: 1 });
    expect(rpc).toHaveBeenCalledWith('sig_create_draft', { p: expect.objectContaining({
      title: 'Termo de uso', description: 'regras', due_at: '2026-12-01T02:59:00.000Z', audience_mode: 'all', applies_to_new_members: true,
      file_name: 'termo.pdf', size_bytes: 8, page_count: 3, content_sha256: 'a'.repeat(64), replaces_id: '',
    }) });

    await createDraft({ title: 'Termo', audienceMode: 'selected', appliesToNewMembers: true, replacesId: ID }, file);
    expect(rpc.mock.calls[1][1].p).toMatchObject({ audience_mode: 'selected', applies_to_new_members: false, replaces_id: ID, due_at: '', description: '' });
  });

  it('updateDraft sem arquivo novo NÃO manda campos de arquivo (o caminho no bucket não muda)', async () => {
    rpc.mockResolvedValue({ data: { id: ID, storage_path: 'x/y.pdf', previous_storage_path: null }, error: null });
    await updateDraft(ID, { title: 'Novo título', audienceMode: 'all', appliesToNewMembers: false });
    const p = rpc.mock.calls[0][1].p;
    expect(p).not.toHaveProperty('content_sha256');
    expect(p).not.toHaveProperty('file_name');
    expect(p.title).toBe('Novo título');
  });

  it('updateDraft com arquivo novo manda os 4 campos e devolve o caminho antigo para limpar', async () => {
    rpc.mockResolvedValue({ data: { id: ID, storage_path: 'novo.pdf', previous_storage_path: 'antigo.pdf' }, error: null });
    const r = await updateDraft(ID, { title: 'T', audienceMode: 'all', appliesToNewMembers: false }, file);
    expect(r).toEqual({ storagePath: 'novo.pdf', previousStoragePath: 'antigo.pdf' });
    expect(rpc.mock.calls[0][1].p).toMatchObject({ file_name: 'termo.pdf', size_bytes: 8, page_count: 3, content_sha256: 'a'.repeat(64) });
  });

  it('apagar rascunho remove também o PDF do bucket (o caminho vem do banco)', async () => {
    rpc.mockResolvedValue({ data: `${ID}/abc.pdf`, error: null });
    await deleteDraft(ID);
    expect(rpc).toHaveBeenCalledWith('sig_delete_draft', { p_id: ID });
    expect(remove).toHaveBeenCalledWith([`${ID}/abc.pdf`]);
  });

  it('setRecipients devolve a contagem', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    expect(await setRecipients(ID, ['a', 'b'])).toBe(2);
    expect(rpc).toHaveBeenCalledWith('sig_set_recipients', { p_id: ID, p_profiles: ['a', 'b'] });
  });

  it('erro do banco propaga (a tela traduz), não vira sucesso silencioso', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'SIG_DOCUMENT_IMMUTABLE' } });
    await expect(updateDraft(ID, { title: 'T', audienceMode: 'all', appliesToNewMembers: false })).rejects.toMatchObject({ message: 'SIG_DOCUMENT_IMMUTABLE' });
  });
});

describe('publicar e acompanhar', () => {
  it('publishDocument traduz o resumo do banco', async () => {
    rpc.mockResolvedValue({ data: { id: ID, recipients: 26, queued: 25, skipped_no_phone: 1 }, error: null });
    expect(await publishDocument(ID)).toEqual({ id: ID, recipients: 26, queued: 25, skippedNoPhone: 1 });
    expect(rpc).toHaveBeenCalledWith('sig_publish', { p_id: ID });
  });

  it('as demais ações chamam a função certa com os parâmetros certos', async () => {
    rpc.mockResolvedValue({ data: { added: 2, queued: 1, skipped_no_phone: 1 }, error: null });
    expect(await addRecipients(ID, ['a', 'b'])).toEqual({ added: 2, queued: 1, skippedNoPhone: 1 });
    await removeRecipient(ID, 'p1');
    await updateDue(ID, null);
    await archiveDocument(ID, '  encerrado  ');
    await archiveDocument(ID);
    rpc.mockResolvedValueOnce({ data: 4, error: null });
    expect(await resendFailed(ID)).toBe(4);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['sig_add_recipients', 'sig_remove_recipient', 'sig_update_due', 'sig_archive', 'sig_archive', 'sig_resend_failed']);
    expect(rpc).toHaveBeenCalledWith('sig_remove_recipient', { p_id: ID, p_profile: 'p1' });
    expect(rpc).toHaveBeenCalledWith('sig_update_due', { p_id: ID, p_due: null });
    expect(rpc).toHaveBeenCalledWith('sig_archive', { p_id: ID, p_reason: 'encerrado' });
    expect(rpc).toHaveBeenCalledWith('sig_archive', { p_id: ID, p_reason: null });
  });

  it('verifyIntegrity devolve ok e problemas', async () => {
    rpc.mockResolvedValue({ data: { checked: '3', ok: false, problems: [{ seq: 2, problem: 'chain_broken' }] }, error: null });
    expect(await verifyIntegrity(ID)).toEqual({ checked: 3, ok: false, problems: [{ seq: 2, problem: 'chain_broken' }] });
  });

  it('a lista usa números mesmo quando o banco devolve count(*) como texto', async () => {
    tableResult.value = { data: [{ id: ID, title: 'T', recipients: '26', signed: '3', notifications_pending: '0', notifications_failed: '2', no_phone: '1', status: 'published' }], error: null };
    const [d] = await listAdminDocuments();
    expect([d.recipients, d.signed, d.notifications_failed, d.no_phone]).toEqual([26, 3, 2, 1]);
  });

  it('a lista de sócios ignora inativos e mantém quem tem is_active nulo', async () => {
    tableResult.value = { data: [
      { id: '1', name: 'Ana', phone: '85999', role: 'socio', is_active: true },
      { id: '2', name: 'Bia', phone: null, role: 'socio', is_active: false },
      { id: '3', name: 'Caio', phone: '85888', role: 'admin', is_active: null },
    ], error: null };
    expect((await listSignableMembers()).map((m) => m.id)).toEqual(['1', '3']);
  });
});

describe('drainNotifications: despachar a fila em voltas', () => {
  const sum = (over: Partial<DispatchSummary>): DispatchSummary => ({ configured: true, claimed: 10, sent: 10, failed: 0, reminders: 0, done: false, ...over });

  it('repete até a borda dizer "done" e soma o resultado', async () => {
    const dispatch = vi.fn()
      .mockResolvedValueOnce(sum({ sent: 10 }))
      .mockResolvedValueOnce(sum({ sent: 9, failed: 1 }))
      .mockResolvedValueOnce(sum({ claimed: 4, sent: 4, done: true }));
    const progress = vi.fn();
    const r = await drainNotifications({ dispatch, onProgress: progress });
    expect(r).toEqual({ sent: 23, failed: 1, rounds: 3, configured: true, finished: true });
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls[1][0]).toMatchObject({ sent: 19, failed: 1 });
  });

  it('WhatsApp não configurado: para na 1ª volta, sem insistir', async () => {
    const dispatch = vi.fn().mockResolvedValue(sum({ configured: false, claimed: 0, sent: 0, done: true }));
    const r = await drainNotifications({ dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ configured: false, sent: 0, finished: true });
  });

  it('volta sem nada reclamado e sem "done": para (fila só tem avisos para depois), sem marcar como terminada', async () => {
    const dispatch = vi.fn().mockResolvedValue(sum({ claimed: 0, sent: 0, done: false }));
    const r = await drainNotifications({ dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(r.finished).toBe(false);
  });

  it('nunca passa de maxRounds, mesmo que a fila não esvazie', async () => {
    const dispatch = vi.fn().mockResolvedValue(sum({}));
    const r = await drainNotifications({ dispatch, maxRounds: 3 });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ rounds: 3, sent: 30, finished: false });
  });

  it('erro numa volta propaga (a tela diz que o documento ficou publicado e os avisos na fila)', async () => {
    const dispatch = vi.fn().mockResolvedValueOnce(sum({})).mockRejectedValueOnce(new Error('network'));
    await expect(drainNotifications({ dispatch })).rejects.toThrow('network');
  });
});

describe('adminErrorMessage: frase para a pessoa, nunca a mensagem crua do banco', () => {
  it.each([
    ['SIG_DOCUMENT_IMMUTABLE', /nova versão/],
    ['SIG_FILE_MISSING', /Anexe o arquivo de novo/],
    ['SIG_NO_RECIPIENTS', /ao menos um sócio/],
    ['SIG_DUE_IN_PAST', /data futura/],
    ['SIG_ALREADY_SIGNED', /já assinou/],
    ['SIG_RECIPIENT_INVALID', /sócios ativos/],
  ])('%s', (code, expected) => {
    expect(adminErrorMessage({ message: `ERROR: ${code} (P0001)` })).toMatch(expected);
    expect(adminErrorMessage({ message: `ERROR: ${code} (P0001)` })).not.toContain('SIG_');
  });

  it('PDF recusado explica o motivo', () => {
    expect(adminErrorMessage(new PdfRejectedError('too_big'))).toMatch(/10 MB/);
    expect(adminErrorMessage(new PdfRejectedError('not_pdf'))).toMatch(/não é um PDF/);
  });

  it('permissão negada (42501) e falha de rede têm texto próprio; o resto cai no padrão sem vazar o erro', () => {
    expect(adminErrorMessage({ code: '42501', message: 'permission denied for table x' })).toMatch(/administradores/);
    expect(adminErrorMessage(new Error('Failed to fetch'))).toMatch(/conexão/);
    const generic = adminErrorMessage({ message: 'relation "sig_x" does not exist' });
    expect(generic).not.toContain('sig_x');
    expect(adminErrorMessage(null, 'padrão meu')).toBe('padrão meu');
  });
});
