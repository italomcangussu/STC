// Dados do aparelho que acompanham o pedido do código (vão para o dossiê da assinatura).
//
// São INFORMADOS pelo aparelho: servem de indício junto com o IP e o user-agent que o servidor vê, não de
// prova isolada. O banco aceita só objeto pequeno (até 2000 caracteres). Inclui o resultado do pedido de
// localização, para o comprovante dizer se o GPS foi permitido, negado ou indisponível.

import type { LocationStatus } from './location';

const cut = (v: unknown, n = 80): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);

export function collectDevice(location: LocationStatus): Record<string, string> {
  const out: Record<string, string | undefined> = { location };
  try { out.timezone = cut(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* sem Intl */ }
  if (typeof navigator !== 'undefined') {
    out.language = cut(navigator.language, 20);
    out.platform = cut((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform, 40);
  }
  if (typeof window !== 'undefined') {
    if (window.screen) out.screen = `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`;
    try { out.mode = window.matchMedia?.('(display-mode: standalone)').matches ? 'pwa' : 'browser'; } catch { /* sem matchMedia */ }
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Record<string, string>;
}
