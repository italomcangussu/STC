/**
 * Movimento do sistema "Quadra" (.fabuloso/design/sistema.md · Movimento).
 *
 * Seis movimentos e nenhum outro: toque, entrada, folha, troca de tela,
 * mudança de valor e reordenar. Aqui ficam os dois que precisam de JS.
 */
import { flushSync } from 'react-dom';

export const reduzMovimento = (): boolean =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type DocComTransicao = Document & { startViewTransition?: (cb: () => void) => unknown };

/**
 * Troca de tela com a View Transitions API (Safari 18+, Chrome 111+): o
 * conteúdo cruza em 200 ms. Sem suporte ou com movimento reduzido, a troca é
 * seca, como sempre foi. `atualizar` roda síncrono dentro da transição.
 */
export function trocarTela(atualizar: () => void): void {
    const doc = typeof document !== 'undefined' ? (document as DocComTransicao) : null;
    if (!doc?.startViewTransition || reduzMovimento()) {
        atualizar();
        return;
    }
    doc.startViewTransition(() => flushSync(atualizar));
}

/**
 * Reordenar (FLIP): mede onde cada filho estava, deixa o React mover e anima
 * do lugar antigo ao novo só com `transform`. Usado no ranking, para a linha
 * de quem venceu **subir** até a posição nova em vez de aparecer lá.
 *
 *   const antes = medirPosicoes(lista);   // antes de mudar o estado
 *   …setState…
 *   useLayoutEffect(() => animarReordem(lista, antes), [dados]);
 *
 * Os filhos precisam de `data-flip-key` estável. Com movimento reduzido, a
 * linha que mudou só acende (`valor-mudou`), sem deslocar.
 */
export function medirPosicoes(container: HTMLElement | null): Map<string, number> {
    const mapa = new Map<string, number>();
    container?.querySelectorAll<HTMLElement>('[data-flip-key]').forEach(el => {
        mapa.set(el.dataset.flipKey!, el.getBoundingClientRect().top);
    });
    return mapa;
}

export function animarReordem(container: HTMLElement | null, antes: Map<string, number>): void {
    if (!container || antes.size === 0) return;
    const reduz = reduzMovimento();
    container.querySelectorAll<HTMLElement>('[data-flip-key]').forEach(el => {
        const topoAntigo = antes.get(el.dataset.flipKey!);
        if (topoAntigo == null) return;
        const dy = topoAntigo - el.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        destacar(el);
        if (reduz || typeof el.animate !== 'function') return;
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
            duration: 400,
            easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
        });
    });
}

/** Mudança de valor: a linha acende `acao-suave` por 1,2 s e apaga. */
export function destacar(el: HTMLElement): void {
    el.classList.remove('valor-mudou');
    void el.offsetWidth; // reinicia a animação se já estava acesa
    el.classList.add('valor-mudou');
    el.addEventListener('animationend', () => el.classList.remove('valor-mudou'), { once: true });
}
