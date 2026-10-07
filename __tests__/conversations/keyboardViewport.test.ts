import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveKeyboardViewport } from '../../lib/conversations/keyboardViewport';

describe('resolveKeyboardViewport', () => {
  it('sem campo em foco, a casca ocupa a janela cheia mesmo que o iOS devolva a área visível encolhida', () => {
    expect(resolveKeyboardViewport({ innerHeight: 852, visualViewportHeight: 520, visualViewportOffsetTop: 120, editableFocused: false }))
      .toEqual({ height: 852, offsetTop: 0, keyboardOpen: false });
  });

  it('com o teclado aberto, a casca vira a área visível acima dele', () => {
    expect(resolveKeyboardViewport({ innerHeight: 852, visualViewportHeight: 510, visualViewportOffsetTop: 0, editableFocused: true }))
      .toEqual({ height: 510, offsetTop: 0, keyboardOpen: true });
  });

  it('acompanha o deslocamento quando o iOS empurra a página para cima', () => {
    expect(resolveKeyboardViewport({ innerHeight: 852, visualViewportHeight: 520, visualViewportOffsetTop: 90, editableFocused: true }))
      .toMatchObject({ height: 520, offsetTop: 90, keyboardOpen: true });
  });

  it('barra do navegador que some (≈80px) não conta como teclado', () => {
    expect(resolveKeyboardViewport({ innerHeight: 800, visualViewportHeight: 730, visualViewportOffsetTop: 0, editableFocused: true }).keyboardOpen).toBe(false);
  });

  it('sem visualViewport usa a janela', () => {
    expect(resolveKeyboardViewport({ innerHeight: 700, editableFocused: true })).toEqual({ height: 700, offsetTop: 0, keyboardOpen: false });
  });
});

describe('regressão de CSS do mensageiro', () => {
  const css = readFileSync('index.css', 'utf8');

  it('a altura fixa da página dedicada não vale para a conversa em tela cheia', () => {
    expect(css).toMatch(/\.conv-shell\.is-standalone:not\(\.is-chat-overlay\)\s*\{[^}]*height: 100% !important/);
    expect(css).not.toMatch(/\.conv-shell\.is-standalone\s*\{[^}]*height:/);
  });

  it('a barra superior acompanha o deslocamento da área visível', () => {
    expect(css).toMatch(/\.conv-top-bar-floating\s*\{[^}]*translateY\(var\(--chat-vv-offset-top/);
  });
});
