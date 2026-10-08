import { describe, expect, it, vi } from 'vitest';
import { fetchAllRows, MAX_PAGES, SUPABASE_PAGE_SIZE } from './fetchAllRows';

const numbered = (total: number) => Array.from({ length: total }, (_, index) => ({ id: index }));

// Imita o servidor: nunca devolve mais que o limite da API, mesmo pedindo mais.
const cappedServer = (rows: { id: number }[], serverCap = SUPABASE_PAGE_SIZE) =>
    vi.fn(async (from: number, to: number) => ({
        data: rows.slice(from, Math.min(to + 1, from + serverCap)),
        error: null,
    }));

describe('fetchAllRows', () => {
    it('devolve a tabela inteira quando ela passa do limite de 1000 linhas da API (caso das aulas sumidas)', async () => {
        const table = numbered(1004);

        const { data, error } = await fetchAllRows(cappedServer(table));

        expect(error).toBeNull();
        expect(data).toHaveLength(1004);
        expect(data?.at(-1)).toEqual({ id: 1003 });
    });

    it('faz uma única consulta quando tudo cabe numa página', async () => {
        const fetchPage = cappedServer(numbered(12));

        const { data } = await fetchAllRows(fetchPage);

        expect(data).toHaveLength(12);
        expect(fetchPage).toHaveBeenCalledTimes(1);
        expect(fetchPage).toHaveBeenCalledWith(0, SUPABASE_PAGE_SIZE - 1);
    });

    it('pede as faixas em sequência, sem pular nem repetir linha', async () => {
        const fetchPage = cappedServer(numbered(5));

        const { data } = await fetchAllRows(fetchPage, { pageSize: 2 });

        expect(fetchPage.mock.calls).toEqual([[0, 1], [2, 3], [4, 5]]);
        expect(data?.map(row => row.id)).toEqual([0, 1, 2, 3, 4]);
    });

    it('confirma o fim com uma página vazia quando o total é múltiplo do tamanho da página', async () => {
        const fetchPage = cappedServer(numbered(4));

        const { data } = await fetchAllRows(fetchPage, { pageSize: 2 });

        expect(data).toHaveLength(4);
        expect(fetchPage).toHaveBeenCalledTimes(3);
    });

    it('devolve lista vazia para tabela vazia', async () => {
        const { data, error } = await fetchAllRows(cappedServer([]));

        expect(error).toBeNull();
        expect(data).toEqual([]);
    });

    it('trata data nula como página vazia', async () => {
        const { data, error } = await fetchAllRows(async () => ({ data: null, error: null }));

        expect(error).toBeNull();
        expect(data).toEqual([]);
    });

    it('para e devolve o erro de uma página, sem entregar dados parciais', async () => {
        const failure = { message: 'timeout' };
        const fetchPage = vi.fn()
            .mockResolvedValueOnce({ data: [{ id: 0 }, { id: 1 }], error: null })
            .mockResolvedValueOnce({ data: null, error: failure });

        const result = await fetchAllRows(fetchPage, { pageSize: 2 });

        expect(result).toEqual({ data: null, error: failure });
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it('interrompe uma consulta que nunca termina em vez de repetir para sempre', async () => {
        const fetchPage = vi.fn(async () => ({ data: [{ id: 0 }], error: null }));

        const { data, error } = await fetchAllRows(fetchPage, { pageSize: 1 });

        expect(data).toBeNull();
        expect(error?.message).toContain('interrompida');
        expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES);
    });

    describe('com maxRows (pedido de "até N linhas")', () => {
        it('junta várias páginas e para exatamente no teto, sem pedir linha a mais', async () => {
            const fetchPage = cappedServer(numbered(5000));

            const { data } = await fetchAllRows(fetchPage, { maxRows: 2500 });

            expect(data).toHaveLength(2500);
            expect(fetchPage.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2499]]);
        });

        it('com teto menor que a página, faz uma única consulta do tamanho do teto', async () => {
            const fetchPage = cappedServer(numbered(5000));

            const { data } = await fetchAllRows(fetchPage, { maxRows: 300 });

            expect(data).toHaveLength(300);
            expect(fetchPage.mock.calls).toEqual([[0, 299]]);
        });

        it('se a tabela tem menos linhas que o teto, devolve só o que existe', async () => {
            const { data } = await fetchAllRows(cappedServer(numbered(1200)), { maxRows: 5000 });

            expect(data).toHaveLength(1200);
        });

        it('não consulta nada quando o teto é zero', async () => {
            const fetchPage = cappedServer(numbered(10));

            const { data } = await fetchAllRows(fetchPage, { maxRows: 0 });

            expect(data).toEqual([]);
            expect(fetchPage).not.toHaveBeenCalled();
        });
    });
});
