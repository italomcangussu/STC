import { useEffect, useState } from 'react';

/** Abaixo de `md` a conversa aberta vira tela cheia, como nos apps de mensagem. */
export const CHAT_OVERLAY_QUERY = '(max-width: 767px)';

/** Diferença mínima entre a janela e a área visível para contar como teclado (barras do navegador mexem 60–90px). */
const TECLADO_MIN = 120;
/** O iOS assenta a geometria ~300ms depois da animação do teclado. */
const REMEDIR_MS = [120, 280, 480];

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, [query]);
  return match;
}

function campoEditavelEmFoco(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * Conversa em tela cheia no celular (portado do North Jato).
 *
 * Marca o <html> (`data-chat-overlay`) e acompanha a área visível (`visualViewport`): com o teclado
 * aberto o iOS não encolhe a janela, só a área visível — um `fixed; inset: 0` deixaria o campo de
 * resposta atrás do teclado. A casca (`.conv-shell.is-chat-overlay`, em index.css) ocupa exatamente
 * a área visível (`--chat-vv-height`).
 */
export function useChatOverlay(open: boolean) {
  const mobile = useMediaQuery(CHAT_OVERLAY_QUERY);
  const ativo = open && mobile;

  // Trava a rolagem da página por trás enquanto a conversa cobre a tela.
  useEffect(() => {
    if (!ativo) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = anterior; };
  }, [ativo]);

  useEffect(() => {
    if (!ativo) return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    let quadro = 0;
    const manterTopo = () => { if (window.scrollY !== 0) window.scrollTo(0, 0); };
    let base = window.innerHeight;

    const medir = () => {
      quadro = 0;
      manterTopo();
      const altura = vv?.height ?? window.innerHeight;
      if (!campoEditavelEmFoco()) base = Math.max(window.innerHeight, altura);
      base = Math.max(base, window.innerHeight);
      root.style.setProperty('--chat-vv-height', `${altura}px`);
      // Teclado só existe com um campo em foco: a perda de foco libera mesmo se o iOS não devolver a área visível na hora.
      if (campoEditavelEmFoco() && base - altura > TECLADO_MIN) root.dataset.keyboard = 'open';
      else delete root.dataset.keyboard;
    };
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(medir); };

    const timers = new Set<number>();
    const remedir = () => REMEDIR_MS.forEach((ms) => {
      const id = window.setTimeout(() => { timers.delete(id); agendar(); }, ms);
      timers.add(id);
    });
    const aoFocar = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        window.scrollTo(0, 0);
        setTimeout(manterTopo, 20); setTimeout(manterTopo, 80); setTimeout(manterTopo, 250);
        remedir();
      }
    };

    root.dataset.chatOverlay = 'open';
    medir();
    vv?.addEventListener('resize', agendar);
    vv?.addEventListener('scroll', agendar);
    window.addEventListener('resize', agendar);
    window.addEventListener('scroll', manterTopo, { passive: true });
    window.addEventListener('focusin', aoFocar, { passive: true });
    window.addEventListener('focusout', remedir, { passive: true });

    return () => {
      if (quadro) cancelAnimationFrame(quadro);
      timers.forEach((id) => clearTimeout(id));
      vv?.removeEventListener('resize', agendar);
      vv?.removeEventListener('scroll', agendar);
      window.removeEventListener('resize', agendar);
      window.removeEventListener('scroll', manterTopo);
      window.removeEventListener('focusin', aoFocar);
      window.removeEventListener('focusout', remedir);
      delete root.dataset.chatOverlay;
      delete root.dataset.keyboard;
      root.style.removeProperty('--chat-vv-height');
    };
  }, [ativo]);

  return ativo;
}
