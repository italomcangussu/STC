import { useEffect, useState } from 'react';
import { resolveKeyboardViewport } from '../../lib/conversations/keyboardViewport';

/** Abaixo de `md` a conversa aberta vira tela cheia, como nos apps de mensagem. */
export const CHAT_OVERLAY_QUERY = '(max-width: 767px)';

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
 * Conversa em tela cheia no celular.
 *
 * Marca o <html> (`data-chat-overlay`) e acompanha a área visível (`visualViewport`): com o teclado
 * aberto o iOS não encolhe a janela, só a área visível — um `fixed; inset: 0` deixaria o campo de
 * resposta atrás do teclado. A casca (`.conv-shell.is-chat-overlay`, em index.css) ocupa exatamente
 * a área visível (`--chat-vv-height` / `--chat-vv-offset-top`), e a página por trás fica TRAVADA
 * (`position: fixed` no body) para o iOS não rolar nem deslocar o documento sob o teclado.
 */
export function useChatOverlay(open: boolean) {
  const mobile = useMediaQuery(CHAT_OVERLAY_QUERY);
  const ativo = open && mobile;

  // Trava a página por trás enquanto a conversa cobre a tela, preservando a rolagem para quando voltar.
  useEffect(() => {
    if (!ativo) return;
    const body = document.body;
    if (getComputedStyle(body).position === 'fixed') return; // a página já se trava sozinha (/conversas)
    const y = window.scrollY;
    const anterior = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width, overflow: body.style.overflow };
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      body.style.position = anterior.position;
      body.style.top = anterior.top;
      body.style.left = anterior.left;
      body.style.right = anterior.right;
      body.style.width = anterior.width;
      body.style.overflow = anterior.overflow;
      window.scrollTo(0, y);
    };
  }, [ativo]);

  useEffect(() => {
    if (!ativo) return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    let quadro = 0;
    const manterTopo = () => { if (window.scrollY !== 0) window.scrollTo(0, 0); };

    const medir = () => {
      quadro = 0;
      manterTopo();
      const m = resolveKeyboardViewport({
        innerHeight: window.innerHeight,
        visualViewportHeight: vv?.height,
        visualViewportOffsetTop: vv?.offsetTop,
        editableFocused: campoEditavelEmFoco(),
      });
      root.style.setProperty('--chat-vv-height', `${m.height}px`);
      root.style.setProperty('--chat-vv-offset-top', `${m.offsetTop}px`);
      if (m.keyboardOpen) root.dataset.keyboard = 'open';
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
      if (el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable)) {
        manterTopo();
        agendar();
        remedir();
      }
    };
    const aoDesfocar = () => {
      // pwa-design-debug Fix #2: a perda de foco de edição é o gatilho seguro de fechamento do teclado
      delete root.dataset.keyboard;
      root.style.setProperty('--chat-vv-offset-top', '0px');
      agendar();
      remedir();
    };

    root.dataset.chatOverlay = 'open';
    medir();
    vv?.addEventListener('resize', agendar);
    vv?.addEventListener('scroll', agendar);
    window.addEventListener('resize', agendar);
    window.addEventListener('orientationchange', remedir);
    window.addEventListener('scroll', manterTopo, { passive: true });
    window.addEventListener('focusin', aoFocar, { passive: true });
    window.addEventListener('focusout', aoDesfocar, { passive: true });

    return () => {
      if (quadro) cancelAnimationFrame(quadro);
      timers.forEach((id) => clearTimeout(id));
      vv?.removeEventListener('resize', agendar);
      vv?.removeEventListener('scroll', agendar);
      window.removeEventListener('resize', agendar);
      window.removeEventListener('orientationchange', remedir);
      window.removeEventListener('scroll', manterTopo);
      window.removeEventListener('focusin', aoFocar);
      window.removeEventListener('focusout', aoDesfocar);
      delete root.dataset.chatOverlay;
      delete root.dataset.keyboard;
      root.style.removeProperty('--chat-vv-height');
      root.style.removeProperty('--chat-vv-offset-top');
    };
  }, [ativo]);

  return ativo;
}
