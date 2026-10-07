import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const maybeSingle = vi.hoisted(() => vi.fn());
const eq = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
const storageFrom = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc, from, storage: { from: storageFrom } } }));

import {
  DocumentFileError, documentErrorMessage, downloadDocumentFile, getMyCpf, listMyDocuments, logJourneyEvent, myPendingCount, saveMyCpf, SIG_BUCKET,
} from '../../../lib/signatures/documents';

const DOC = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

beforeEach(() => {
  [rpc, maybeSingle, eq, select, from, download, storageFrom].forEach((f) => f.mockReset());
  eq.mockReturnValue({ maybeSingle });
  select.mockReturnValue({ eq });
  from.mockReturnValue({ select });
  storageFrom.mockReturnValue({ download });
});

describe('lado do sócio: tudo por funções do banco', () => {
  it('lista os documentos do sócio (nulo vira lista vazia)', async () => {
    rpc.mockResolvedValueOnce({ data: [{ document_id: DOC }], error: null });
    expect(await listMyDocuments()).toEqual([{ document_id: DOC }]);
    expect(rpc).toHaveBeenCalledWith('sig_my_documents', {});

    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await listMyDocuments()).toEqual([]);
  });

  it('propaga o erro do banco (a tela o traduz)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'SIG_FORBIDDEN', code: '42501' } });
    await expect(listMyDocuments()).rejects.toMatchObject({ message: 'SIG_FORBIDDEN' });
  });

  it('conta pendentes como número', async () => {
    rpc.mockResolvedValueOnce({ data: 3, error: null });
    expect(await myPendingCount()).toBe(3);
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await myPendingCount()).toBe(0);
  });

  it('lê o CPF filtrando pelo próprio id (o administrador enxerga as linhas de todos)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { cpf: '52998224725' }, error: null });
    expect(await getMyCpf('u1')).toBe('52998224725');
    expect(from).toHaveBeenCalledWith('sig_member_identities');
    expect(eq).toHaveBeenCalledWith('profile_id', 'u1');

    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await getMyCpf('u1')).toBeNull();
  });

  it('salva o CPF e registra eventos da leitura com o formato que a função do banco espera', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveMyCpf('52998224725');
    expect(rpc).toHaveBeenLastCalledWith('sig_save_my_cpf', { p_cpf: '52998224725' });

    await logJourneyEvent(DOC, 'read_completed', { pages_seen: 4, pages_total: 4 });
    expect(rpc).toHaveBeenLastCalledWith('sig_log_event', { p_document: DOC, p_kind: 'read_completed', p_meta: { pages_seen: 4, pages_total: 4 } });
    await logJourneyEvent(DOC, 'viewed');
    expect(rpc).toHaveBeenLastCalledWith('sig_log_event', { p_document: DOC, p_kind: 'viewed', p_meta: {} });
  });
});

describe('PDF do bucket privado', () => {
  it('baixa do bucket sig-docs e devolve os bytes', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7').buffer;
    download.mockResolvedValueOnce({ data: { arrayBuffer: async () => bytes }, error: null });
    expect(await downloadDocumentFile(`${DOC}/abc.pdf`)).toBe(bytes);
    expect(storageFrom).toHaveBeenCalledWith(SIG_BUCKET);
    expect(download).toHaveBeenCalledWith(`${DOC}/abc.pdf`);
  });

  it('sem permissão ou sem arquivo: erro próprio, sem vazar a mensagem do storage', async () => {
    download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } });
    await expect(downloadDocumentFile('x')).rejects.toBeInstanceOf(DocumentFileError);
  });
});

describe('mensagens para a pessoa', () => {
  it.each([
    ['SIG_CPF_INVALID', /CPF inválido/],
    ['SIG_CPF_LOCKED', /não pode mais ser alterado/],
    ['SIG_READ_INCOMPLETE', /faltam páginas/],
    ['SIG_READ_NOT_STARTED', /comece a leitura/],
    ['SIG_READ_REQUIRED', /até o fim/],
    ['SIG_NOT_PUBLISHED', /não está mais aberto/],
    ['SIG_ALREADY_SIGNED', /já assinou/],
    ['SIG_NOT_FOUND', /não está disponível/],
    ['SIG_FORBIDDEN', /sócios ativos/],
    ['SIG_FILE_UNAVAILABLE', /baixar o documento/],
  ])('%s → frase em português', (code, expected) => {
    expect(documentErrorMessage({ message: `${code}: detalhe interno` })).toMatch(expected);
  });

  it('42501 (sem permissão) e rede têm frase própria; o resto cai no padrão sem expor o texto cru', () => {
    expect(documentErrorMessage({ code: '42501', message: 'permission denied' })).toMatch(/sócios ativos/);
    expect(documentErrorMessage(new Error('Failed to fetch'))).toMatch(/falar com o servidor/);
    const generic = documentErrorMessage({ message: 'relation "x" does not exist' });
    expect(generic).not.toContain('relation');
    expect(documentErrorMessage(null, 'padrão')).toBe('padrão');
  });
});
