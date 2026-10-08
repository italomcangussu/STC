// A API do Supabase devolve no máximo 1000 linhas por consulta e não avisa quando corta.
// Toda leitura "da tabela inteira" precisa passar por aqui, senão as últimas linhas somem da tela
// assim que a tabela passa desse tamanho (foi o que escondeu as aulas recém-criadas da Agenda).

export const SUPABASE_PAGE_SIZE = 1000;
export const MAX_PAGES = 200;

interface PageResult<T, E> {
    data: T[] | null;
    error: E | null;
}

// Recebe a faixa [from, to] (inclusive) e devolve a consulta já com `.range(from, to)`.
// A consulta precisa de ordem estável (termine o `.order(...)` por `id`), ou páginas se repetem ou pulam linhas.
type PageFetcher<T, E> = (from: number, to: number) => PromiseLike<PageResult<T, E>>;

interface FetchAllOptions {
    pageSize?: number;
    // Para de pedir quando juntar tanto; para telas que querem "até N" e não a tabela inteira.
    maxRows?: number;
}

interface FetchAllError {
    message: string;
}

// A leitura acaba quando a página veio curta (a tabela acabou) ou quando o teto pedido foi alcançado.
// `requestedUpTo` é quantas linhas, no total, as páginas pedidas até aqui deveriam ter entregado.
const isLastPage = (collected: number, requestedUpTo: number, maxRows: number): boolean =>
    collected < requestedUpTo || collected >= maxRows;

export async function fetchAllRows<T, E extends FetchAllError = FetchAllError>(
    fetchPage: PageFetcher<T, E>,
    { pageSize = SUPABASE_PAGE_SIZE, maxRows = Infinity }: FetchAllOptions = {},
): Promise<PageResult<T, E | FetchAllError>> {
    if (maxRows <= 0) return { data: [], error: null };

    const rows: T[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const from = page * pageSize;
        const to = Math.min(from + pageSize, maxRows) - 1;
        const { data, error } = await fetchPage(from, to);
        if (error) return { data: null, error };

        rows.push(...(data ?? []));
        if (isLastPage(rows.length, to + 1, maxRows)) return { data: rows.slice(0, maxRows), error: null };
    }

    return { data: null, error: { message: `Leitura interrompida após ${MAX_PAGES} páginas.` } };
}
