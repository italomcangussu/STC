import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newRequestId } from '../../lib/finance/financeApi';
import { todayInFortaleza, type IsoDate } from '../../lib/finance/dates';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/** Carrega dados e descarta respostas atrasadas (mudou o filtro enquanto a anterior voltava). */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    loadRef.current().then(
      (d) => { if (mine === seq.current) { setData(d); setLoading(false); } },
      (e) => { if (mine === seq.current) { setError(e); setLoading(false); } },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

/**
 * Chave de idempotência de uma operação: nasce com o formulário e é reaproveitada
 * se o usuário tocar duas vezes ou repetir depois de uma falha de rede. `renew`
 * só depois de sucesso (ou ao abrir um formulário novo).
 */
export function useRequestKey() {
  const [key, setKey] = useState(newRequestId);
  return { key, renew: () => setKey(newRequestId()) };
}

/** "Hoje" do clube (Fortaleza), estável durante a vida do componente. */
export function useToday(): IsoDate {
  return useMemo(() => todayInFortaleza(), []);
}

/** Dispara um download no navegador. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
