import { useEffect, useState } from 'react';
import { myPendingCount } from './documents';

/** Avisa o menu (e a lista) que algo mudou: assinou, abriu a aba, etc. */
export const SIGNATURES_CHANGED_EVENT = 'stc:signatures-changed';

export function notifySignaturesChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SIGNATURES_CHANGED_EVENT));
}

const REFRESH_MS = 5 * 60 * 1000;

/**
 * Quantos documentos o sócio ainda deve assinar (o selo do menu). O selo é um auxílio: se a consulta
 * falhar (sem rede, sem permissão), ele só continua com o último valor, sem erro na tela.
 */
export function usePendingSignatures(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) { setCount(0); return undefined; }
    let alive = true;
    const refresh = async () => {
      try {
        const n = await myPendingCount();
        if (alive) setCount(n);
      } catch { /* selo auxiliar */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    window.addEventListener(SIGNATURES_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => {
      alive = false;
      window.removeEventListener(SIGNATURES_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [enabled]);

  return count;
}
