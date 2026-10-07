/**
 * Geometria da área visível com o teclado do iOS (pwa-design-debug, Fix #2).
 *
 * O iOS não encolhe a janela (layout viewport) quando o teclado abre: ele encolhe — e às vezes
 * desloca — a área visível (`visualViewport`). A casca da conversa precisa ocupar exatamente esse
 * retângulo. O foco num campo de edição é a trava de LIBERAÇÃO: no iOS 26 o `offsetTop` pode não
 * zerar depois que o teclado fecha, então perder o foco sempre solta a casca.
 */

export type KeyboardViewportInput = {
  /** `window.innerHeight` (janela cheia, sem teclado). */
  innerHeight: number;
  visualViewportHeight?: number | null;
  visualViewportOffsetTop?: number | null;
  /** Há um campo de edição com foco (`input`, `textarea`, `contenteditable`)? */
  editableFocused: boolean;
};

export type KeyboardViewportMetrics = {
  /** Altura que a casca deve ter: a área visível com o teclado aberto, a janela cheia sem ele. */
  height: number;
  /** Topo da área visível (a casca é empurrada até aí quando o iOS desloca a página). */
  offsetTop: number;
  keyboardOpen: boolean;
};

/** Barras do navegador que somem ao rolar mexem 60–90px; o teclado tira 250+. */
export const KEYBOARD_MIN_OCCLUSION = 120;
export const KEYBOARD_MIN_PAN = 40;

export function resolveKeyboardViewport(input: KeyboardViewportInput): KeyboardViewportMetrics {
  const inner = Math.max(0, Math.round(input.innerHeight));
  const vvHeight = Math.max(0, Math.round(input.visualViewportHeight ?? inner));
  const vvTop = Math.max(0, Math.round(input.visualViewportOffsetTop ?? 0));

  const occlusion = Math.max(0, inner - vvHeight);
  const geometry = occlusion > KEYBOARD_MIN_OCCLUSION || vvTop > KEYBOARD_MIN_PAN;
  const keyboardOpen = input.editableFocused && geometry;

  return keyboardOpen
    ? { height: vvHeight, offsetTop: vvTop, keyboardOpen: true }
    : { height: inner, offsetTop: 0, keyboardOpen: false };
}
