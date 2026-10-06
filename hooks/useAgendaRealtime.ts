import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

/** Tabelas que mudam o que a Agenda mostra. Precisam estar na publicação `supabase_realtime`. */
export const AGENDA_REALTIME_TABLES = ['reservations', 'matches', 'challenges'] as const;

/** Junta uma rajada de eventos (ex.: criar reserva + entrar nela) em uma única releitura. */
export const AGENDA_REALTIME_DEBOUNCE_MS = 250;

/**
 * Mantém a Agenda em tempo real: qualquer mudança nas tabelas acima, e também a volta
 * da aba/PWA ao primeiro plano, a volta da rede e a reconexão do canal, disparam `onChange`.
 *
 * `onChange` deve ser estável (useCallback), senão o canal é recriado a cada render.
 */
export function useAgendaRealtime(onChange: () => void) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let jaConectou = false;

    const agendar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        onChange();
      }, AGENDA_REALTIME_DEBOUNCE_MS);
    };

    let channel = supabase.channel('agenda-changes');
    for (const table of AGENDA_REALTIME_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, agendar);
    }
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        // Reconexão: eventos perdidos enquanto o canal esteve fora só voltam por releitura.
        if (jaConectou) agendar();
        jaConectou = true;
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        logger.error('agenda_realtime_failed', { error: err?.message || status });
      }
    });

    // Celular com a tela apagada suspende o websocket; ao voltar, relê.
    const aoVoltarAoPrimeiroPlano = () => {
      if (document.visibilityState === 'visible') agendar();
    };
    document.addEventListener('visibilitychange', aoVoltarAoPrimeiroPlano);
    window.addEventListener('online', agendar);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', aoVoltarAoPrimeiroPlano);
      window.removeEventListener('online', agendar);
      supabase.removeChannel(channel);
    };
  }, [onChange]);
}
