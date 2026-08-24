import { loadDomToPng } from './exportTools';

/**
 * Exportação da Tabela de Confrontos como imagem.
 *
 * O quadro na tela é uma janela com rolagem e zoom: o que aparece nunca é a
 * chave inteira. Exportar capturando o que está visível daria um recorte. Por
 * isso a captura acontece numa cópia montada fora da tela, em tamanho real e
 * com todas as classes — que também é a única forma de exportar mais de uma
 * classe de uma vez, já que só uma cabe na tela por vez.
 */

const ORDINAIS: Record<string, string> = { 'ª': 'a', 'º': 'o' };

/** Nome de arquivo previsível: sem acento, sem ordinal, sem espaço. */
export function buildBracketImageName(championshipName: string, className: string): string {
    const slug = (raw: string) =>
        raw
            .replace(/[ªº]/g, ch => ORDINAIS[ch] ?? ch)
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

    const partes = [slug(championshipName), slug(className)].filter(Boolean);
    return `${partes.join('-')}.png`;
}

type ShareCapableNavigator = Pick<Navigator, 'share' | 'canShare'>;

/**
 * Se o diálogo do sistema aceita estes arquivos.
 *
 * `canShare` precisa ser perguntado com os arquivos em mãos: um navegador pode
 * ter Web Share para texto e recusar imagem, e aí `share()` rejeitaria depois
 * de o usuário já ter esperado a captura.
 */
export function canShareFiles(files: File[], nav: ShareCapableNavigator): boolean {
    if (files.length === 0) return false;
    if (typeof nav?.share !== 'function' || typeof nav?.canShare !== 'function') return false;
    try {
        return nav.canShare({ files });
    } catch {
        return false;
    }
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

export interface ShareDeps {
    nav?: ShareCapableNavigator;
    saveFile?: (file: File) => void;
    /** Intervalo entre downloads. Zero nos testes; o padrão vale no navegador. */
    spacingMs?: number;
}

/** Tempo até soltar o blob. Longo de propósito — ver o comentário abaixo. */
const REVOKE_DELAY_MS = 60_000;

/** Espaço entre um download e o próximo, para o navegador não tratá-los como rajada. */
const DEFAULT_SPACING_MS = 350;

/**
 * Download comum, para quem não tem diálogo de compartilhamento.
 *
 * A URL **não** é revogada no mesmo tick do clique. Revogar ali cancela o
 * download antes de o navegador terminar de ler o blob — com duas classes
 * seguidas, a segunda imagem era justamente a que se perdia, e o export
 * parecia exportar só uma.
 */
export function saveFileToDisk(file: File): void {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Entrega as imagens: diálogo do sistema no celular, download no resto.
 *
 * Fechar o diálogo é escolha do usuário e não vira download surpresa — só uma
 * falha de verdade cai para o arquivo.
 */
export async function shareOrDownload(
    files: File[],
    meta: { title: string; text?: string },
    deps: ShareDeps = {}
): Promise<ShareOutcome> {
    if (files.length === 0) {
        throw new Error('Nenhuma imagem foi gerada para exportar.');
    }

    const nav = deps.nav ?? (typeof navigator !== 'undefined' ? navigator : ({} as ShareCapableNavigator));
    const saveFile = deps.saveFile ?? saveFileToDisk;
    const spacingMs = deps.spacingMs ?? DEFAULT_SPACING_MS;

    if (canShareFiles(files, nav)) {
        try {
            await nav.share!({ files, title: meta.title, text: meta.text });
            return 'shared';
        } catch (error: any) {
            if (error?.name === 'AbortError') return 'cancelled';
            // Qualquer outra falha ainda deve entregar as imagens.
        }
    }

    // Um de cada vez, com folga entre eles: disparados na mesma rajada, o
    // navegador entrega o primeiro e descarta os demais em silêncio.
    for (let i = 0; i < files.length; i++) {
        if (i > 0 && spacingMs > 0) {
            await new Promise<void>(resolve => setTimeout(resolve, spacingMs));
        }
        saveFile(files[i]);
    }
    return 'downloaded';
}

// ── Captura ──────────────────────────────────────────────────────────────────

/**
 * Hospedeiro fora da tela para a cópia em tamanho real.
 *
 * Fora da tela pela posição, e não por `display: none` ou `visibility`: sem
 * caixa de layout a captura devolve um retângulo vazio.
 */
export function createExportHost(): HTMLDivElement {
    const host = document.createElement('div');
    host.setAttribute('data-bracket-export-host', '');
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '-20000px';
    host.style.zIndex = '-1';
    host.style.pointerEvents = 'none';
    host.style.background = '#061320';
    document.body.appendChild(host);
    return host;
}

/** Resolve depois de `ms`, aconteça o que acontecer com a promessa. */
function comLimite(promise: Promise<unknown>, ms: number): Promise<void> {
    return Promise.race([
        promise.then(() => undefined, () => undefined),
        new Promise<void>(resolve => setTimeout(resolve, ms)),
    ]);
}

/**
 * Dois quadros mais as fontes: o suficiente para o React pintar antes da foto.
 *
 * Os dois limites de tempo não são zelo excessivo. `requestAnimationFrame` não
 * dispara com a aba oculta — trocar de app no meio da captura deixava o botão
 * em "Gerando…" para sempre. E `document.fonts.ready` pode ficar pendurado
 * quando algo continua carregando fontes por baixo. Passado o limite, a foto
 * sai como estiver, que é infinitamente melhor do que não sair.
 */
export async function waitForPaint(timeoutMs = 600): Promise<void> {
    await comLimite(
        new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        timeoutMs
    );

    if (typeof document !== 'undefined' && document.fonts?.ready) {
        await comLimite(document.fonts.ready, timeoutMs);
    }
}

export async function captureNodeToPng(node: HTMLElement, fileName: string): Promise<File> {
    const domToPng = await loadDomToPng();

    const dataUrl = await domToPng(node, {
        scale: 2,
        backgroundColor: '#061320',
        width: node.scrollWidth,
        height: node.scrollHeight,
        // As fontes precisam viajar dentro do SVG: sem isso o texto sai na
        // fonte de fallback, com métrica diferente, e o quadro desalinha.
        font: {},
    });

    const blob = await (await fetch(dataUrl)).blob();
    if (!blob || blob.size === 0) throw new Error('Não foi possível gerar a imagem da chave.');

    return new File([blob], fileName, { type: 'image/png' });
}
