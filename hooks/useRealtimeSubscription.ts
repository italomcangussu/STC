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
        if (filter) {
          channel = channel.on(
            'postgres_changes',
            {
              event: event,
              schema: 'public',
              table: table,
              filter: filter,
            },
            callback
          );
        } else {
          channel = channel.on(
            'postgres_changes',
            {
              event: event,
              schema: 'public',
              table: table,
            },
            callback
          );
        }

        // Subscribe
        const { error } = await channel.subscribe();

        if (error) {
          logger.error('realtime_subscription_failed', {
            table,
            event,
            error: error.message,
          });
        } else {
          logger.debug('realtime_subscription_started', { table, event, filter });
        }
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

          if (sub.filter) {
            channel = channel.on(
              'postgres_changes',
              {
                event: sub.event,
                schema: 'public',
                table: sub.table,
                filter: sub.filter,
              },
              sub.callback
            );
          } else {
            channel = channel.on(
              'postgres_changes',
              {
                event: sub.event,
                schema: 'public',
                table: sub.table,
              },
              sub.callback
            );
          }

          const { error } = await channel.subscribe();

          if (error) {
            logger.error('realtime_subscription_failed', {
              table: sub.table,
              event: sub.event,
              error: error.message,
            });
          } else {
            channels.push(channel);
            logger.debug('realtime_subscription_started', {
              table: sub.table,
              event: sub.event,
            });
          }
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
