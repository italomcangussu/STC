import React, { useEffect, useRef, useState } from 'react';
import { criarChaoSaibro, EVENTO_RAJADA } from '../../lib/chaoSaibro';

function temaEscuro(): boolean {
    return typeof document !== 'undefined' && document.documentElement.dataset.tema === 'escuro';
}

/** Acompanha `<html data-tema>`: o chão só existe no tema escuro. */
function useTemaEscuro(): boolean {
    const [escuro, setEscuro] = useState(temaEscuro);
    useEffect(() => {
        const obs = new MutationObserver(() => setEscuro(temaEscuro()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
        return () => obs.disconnect();
    }, []);
    return escuro;
}

/**
 * O chão do app no tema escuro: saibro à noite, com o pó se mexendo atrás
 * dos cards. Fica atrás de tudo, não recebe toque nem foco, e some para
 * leitores de tela. `rolagem` é a área que rola, para os grãos reagirem.
 */
export const ChaoSaibro: React.FC<{ rolagem: React.RefObject<HTMLElement | null> }> = ({ rolagem }) => {
    const escuro = useTemaEscuro();
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!escuro || !canvas) return;
        const chao = criarChaoSaibro(canvas);
        if (!chao) return;
        const area = rolagem.current;

        const aoRolar = () => chao.rolar(area?.scrollTop ?? 0);
        const aoTocar = (e: PointerEvent) => {
            const r = canvas.getBoundingClientRect();
            chao.tocar(e.clientX - r.left, e.clientY - r.top);
        };
        const aoSoprar = (e: Event) => chao.soprar((e as CustomEvent<{ dir: 1 | -1 }>).detail?.dir === 1 ? 1 : -1);
        const medidor = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => chao.redimensionar()) : null;

        area?.addEventListener('scroll', aoRolar, { passive: true });
        // design-ok gesto-sem-cancelar: não é arrasto; só lê o ponto do toque para marcar o chão
        window.addEventListener('pointerdown', aoTocar, { passive: true });
        window.addEventListener(EVENTO_RAJADA, aoSoprar);
        medidor?.observe(canvas);
        return () => {
            area?.removeEventListener('scroll', aoRolar);
            window.removeEventListener('pointerdown', aoTocar);
            window.removeEventListener(EVENTO_RAJADA, aoSoprar);
            medidor?.disconnect();
            chao.destruir();
        };
    }, [escuro, rolagem]);

    if (!escuro) return null;
    return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
};
