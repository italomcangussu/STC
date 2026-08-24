/**
 * Carrega `html2canvas` e `jsPDF` só na hora de exportar.
 *
 * Juntas, as duas bibliotecas somam ~240 kB comprimidos — mais do que todo o
 * resto do código do app. Importadas no topo de `Championships.tsx`, que é
 * montado sem `lazy()`, elas entravam no primeiro carregamento de **todo
 * sócio**, para um recurso que só o admin usa e só quando clica em "Exportar".
 *
 * O `import()` dinâmico as tira do caminho crítico sem mudar nada do que a
 * função faz. O bundler resolve o resto: elas viram um chunk próprio, buscado
 * no primeiro clique e cacheado depois.
 *
 * **Não volte a importá-las no topo de um módulo.** Se precisar delas em uma
 * função nova, chame estes carregadores.
 */

export const loadHtml2Canvas = async () => (await import('html2canvas')).default;

export const loadJsPdf = async () => (await import('jspdf')).default;

/**
 * `modern-screenshot` para imagem, e não o `html2canvas` acima.
 *
 * O html2canvas 1.4.1 reimplementa o parser de CSS por conta própria e para em
 * `Attempting to parse an unsupported color function "oklab"` — e o Tailwind v4
 * emite `oklch`/`oklab` em praticamente toda cor do app, então ele não consegue
 * fotografar nenhuma tela nossa. O `modern-screenshot` serializa o DOM para SVG
 * e deixa o próprio navegador pintar, então entende qualquer CSS que o
 * navegador entenda — e embute as fontes, que o caminho de `foreignObject`
 * senão perderia.
 *
 * O `html2canvas` continua onde já estava (o PDF premium) para não trocar o
 * motor de um recurso que funciona sem necessidade.
 */
export const loadDomToPng = async () => (await import('modern-screenshot')).domToPng;

/** Quando a exportação precisa das duas, buscá-las em paralelo evita a espera em série. */
export async function loadExportTools() {
    const [html2canvas, jsPDF] = await Promise.all([loadHtml2Canvas(), loadJsPdf()]);
    return { html2canvas, jsPDF };
}
