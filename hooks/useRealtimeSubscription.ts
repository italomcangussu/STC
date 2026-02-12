/**
 * Hook customizado para gerenciar Realtime Subscriptions com cleanup automático
 *
 * Uso:
 * useRealtimeSubscription('matches', '*', (payload) => {
 *   // handle update
 * });
 */

import { useEffect } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface UseRealtimeSubscriptionOptions {
  table: string;
  event: RealtimeEvent;
  callback: (payload: any) => void;
  filter?: string; // e.g., "id=eq.123"
  enabled?: boolean;
}

function attachPostgresChanges(
  channel: RealtimeChannel,
  event: RealtimeEvent,
  table: string,
  filter: string | undefined,
  callback: (payload: any) => void
) {
  const baseFilter = {
    schema: 'public',
    table,
    ...(filter ? { filter } : {}),
  };

  switch (event) {
    case '*':
      return channel.on('postgres_changes', { ...baseFilter, event: '*' }, callback);
    case 'INSERT':
      return channel.on('postgres_changes', { ...baseFilter, event: 'INSERT' }, callback);
    case 'UPDATE':
      return channel.on('postgres_changes', { ...baseFilter, event: 'UPDATE' }, callback);
    case 'DELETE':
      return channel.on('postgres_changes', { ...baseFilter, event: 'DELETE' }, callback);
    default:
      return channel.on('postgres_changes', { ...baseFilter, event: '*' }, callback);
  }
}

/**
 * Hook para subscription com cleanup automático
 */
export function useRealtimeSubscription({
  table,
  event,
  callback,
  filter,
  enabled = true,
}: UseRealtimeSubscriptionOptions) {
  useEffect(() => {
    if (!enabled) return;

    let channel: RealtimeChannel;

    const setupSubscription = async () => {
      try {
        const channelName = `${table}-${event}-${Date.now()}`;

        channel = supabase.channel(channelName);

        // Configurar subscription com filtro opcional
        channel = attachPostgresChanges(channel, event, table, filter, callback);

        // Subscribe
        channel.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            logger.debug('realtime_subscription_started', { table, event, filter });
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            logger.error('realtime_subscription_failed', {
              table,
              event,
              error: err?.message || status,
            });
          }
        });
      } catch (error) {
        logger.error('realtime_subscription_setup_failed', {
          table,
          event,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    setupSubscription();

    // Cleanup: unsubscribe quando componente desmontar
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        logger.debug('realtime_subscription_cleaned_up', { table, event });
      }
    };
  }, [table, event, filter, enabled, callback]);
}

/**
 * Hook para múltiplas subscriptions
 */
export function useRealtimeSubscriptions(
  subscriptions: Omit<UseRealtimeSubscriptionOptions, 'enabled'>[],
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;

    const channels: RealtimeChannel[] = [];

    const setupSubscriptions = async () => {
      for (const sub of subscriptions) {
        try {
          const channelName = `${sub.table}-${sub.event}-${Date.now()}`;
          let channel = supabase.channel(channelName);

          channel = attachPostgresChanges(channel, sub.event, sub.table, sub.filter, sub.callback);

          channel.subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
              channels.push(channel);
              logger.debug('realtime_subscription_started', {
                table: sub.table,
                event: sub.event,
              });
              return;
            }

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              logger.error('realtime_subscription_failed', {
                table: sub.table,
                event: sub.event,
                error: err?.message || status,
              });
            }
          });
        } catch (error) {
          logger.error('realtime_subscription_setup_failed', {
            table: sub.table,
            event: sub.event,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    setupSubscriptions();

    // Cleanup: remove todos os channels
    return () => {
      channels.forEach((channel) => {
        supabase.removeChannel(channel);
      });
      logger.debug('realtime_subscriptions_cleaned_up', { count: channels.length });
    };
  }, [subscriptions, enabled]);
}

/**
 * Exemplo de uso em componente:
 *
 * function MyComponent() {
 *   const [matches, setMatches] = useState([]);
 *
 *   // Single subscription
 *   useRealtimeSubscription({
 *     table: 'matches',
 *     event: 'UPDATE',
 *     callback: (payload) => {
 *       setMatches(prev => prev.map(m =>
 *         m.id === payload.new.id ? payload.new : m
 *       ));
 *     }
 *   });
 *
 *   // Multiple subscriptions
 *   useRealtimeSubscriptions([
 *     {
 *       table: 'matches',
 *       event: 'INSERT',
 *       callback: (payload) => setMatches(prev => [...prev, payload.new])
 *     },
 *     {
 *       table: 'challenges',
 *       event: '*',
 *       callback: (payload) => console.log('Challenge updated', payload)
 *     }
 *   ]);
 * }
 */
