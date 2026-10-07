import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

/** Junta uma rajada de eventos em uma única releitura. */
export const LIVE_REFRESH_DEBOUNCE_MS = 400;

let seq = 0;

/**
 * Tempo real barato para telas que releem seus dados: qualquer mudança nas `tables`
 * (precisam estar na publicação `supabase_realtime`) dispara `onChange`, com debounce.
 *
 * - Não usa o conteúdo do evento, então não precisa de REPLICA IDENTITY FULL.
 * - Aba oculta não relê: o evento fica marcado e a releitura acontece ao voltar ao primeiro plano.
 * - Reconexão do canal e volta da rede também releem (eventos perdidos só voltam assim).
 * - `onChange` pode mudar a cada render: o canal só é recriado se `tables`/`enabled` mudarem.
 */
export function useLiveRefresh(
  tables: readonly string[],
  onChange: () => void,
  options: { enabled?: boolean; debounceMs?: number } = {},
) {
  const { enabled = true, debounceMs = LIVE_REFRESH_DEBOUNCE_MS } = options;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const key = tables.join(',');

  useEffect(() => {
    if (!enabled || !key) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendente = false;
    let jaConectou = false;

    const disparar = () => {
      timer = undefined;
      if (document.visibilityState !== 'visible') { pendente = true; return; }
      pendente = false;
      onChangeRef.current();
    };
    const agendar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(disparar, debounceMs);
    };

    let channel = supabase.channel(`live-refresh-${++seq}-${key.replace(/,/g, '-')}`);
    for (const table of key.split(',')) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, agendar);
    }
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        if (jaConectou) agendar();
        jaConectou = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        logger.error('live_refresh_failed', { tables: key, error: err?.message || status });
      }
    });

    const aoVoltar = () => { if (document.visibilityState === 'visible' && pendente) agendar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', agendar);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', agendar);
      void supabase.removeChannel(channel);
    };
  }, [key, enabled, debounceMs]);
}
