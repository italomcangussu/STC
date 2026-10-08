// A API do Supabase devolve no máximo 1000 linhas por consulta e não avisa quando corta.
// Toda leitura "da tabela inteira" precisa passar por aqui, senão as últimas linhas somem da tela
// assim que a tabela passa desse tamanho (foi o que escondeu as aulas recém-criadas da Agenda).

export const SUPABASE_PAGE_SIZE = 1000;
export const MAX_PAGES = 200;

interface PageResult<T> {
    data: T[] | null;
    error: { message: string } | null;
}

// Recebe a faixa [from, to] (inclusive) e devolve a consulta já com `.range(from, to)`.
// A consulta precisa de ordem estável (termine o `.order(...)` por `id`), ou páginas se repetem ou pulam linhas.
type PageFetcher<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

export async function fetchAllRows<T>(
    fetchPage: PageFetcher<T>,
    pageSize: number = SUPABASE_PAGE_SIZE,
): Promise<PageResult<T>> {
    const rows: T[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const from = page * pageSize;
        const { data, error } = await fetchPage(from, from + pageSize - 1);
        if (error) return { data: null, error };

        const batch = data ?? [];
        rows.push(...batch);
        if (batch.length < pageSize) return { data: rows, error: null };
    }

    return { data: null, error: { message: `Leitura interrompida após ${MAX_PAGES} páginas.` } };
}
