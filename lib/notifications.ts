/**
 * Sistema de Notificações Centralizado para STC Play
 *
 * Integra toast notifications (sonner) com logging estruturado
 *
 * Uso:
 * import { notify } from './lib/notifications';
 * notify.success('Reserva criada com sucesso!');
 * notify.error('Erro ao criar reserva', { description: 'Horário já ocupado' });
 */

import { toast } from 'sonner';
import { errorMessage, logger } from './logger';
import { humanizeError } from './humanErrors';

interface NotificationOptions {
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  cancel?: {
    label: string;
    onClick: () => void;
  };
}

interface NotificationContext {
  [key: string]: any;
}

class NotificationService {
  /**
   * Notificação de sucesso
   */
  success(message: string, options?: NotificationOptions, logContext?: NotificationContext): void {
    logger.info('notification_success', { message, ...logContext });

    toast.success(message, {
      description: options?.description,
      duration: options?.duration || 4000,
      action: options?.action,
      cancel: options?.cancel,
    });
  }

  /**
   * Notificação de erro
   */
  error(message: string, options?: NotificationOptions, logContext?: NotificationContext): void {
    logger.error('notification_error', { message, ...logContext });

    toast.error(message, {
      description: options?.description,
      duration: options?.duration || 5000,
      action: options?.action,
      cancel: options?.cancel,
    });
  }

  /**
   * Erro vindo de uma exceção — o caminho padrão de todo `catch` que fala com
   * o usuário.
   *
   * Faz as duas coisas que precisam acontecer juntas e costumavam ficar
   * separadas: **loga o erro cru** (para o suporte) e **mostra o humano**
   * (para quem está na tela). Passar `event` no contexto nomeia o log com o
   * evento de domínio, em vez do genérico.
   *
   * @param fallback O que falhou, na voz do usuário — 'Não foi possível salvar
   *                 o placar.'. Só aparece quando o erro não é reconhecido,
   *                 mas é o que salva a mensagem de virar jargão.
   */
  failure(
    error: unknown,
    fallback: string,
    logContext?: NotificationContext & { event?: string }
  ): void {
    const { event = 'notification_failure', ...context } = logContext ?? {};
    const human = humanizeError(error, fallback);

    logger.error(event, { ...context, error: errorMessage(error) });

    toast.error(human.message, {
      description: human.hint,
      duration: 5000,
    });
  }

  /**
   * Notificação de aviso
   */
  warning(message: string, options?: NotificationOptions, logContext?: NotificationContext): void {
    logger.warn('notification_warning', { message, ...logContext });

    toast.warning(message, {
      description: options?.description,
      duration: options?.duration || 4000,
      action: options?.action,
      cancel: options?.cancel,
    });
  }

  /**
   * Notificação informativa
   */
  info(message: string, options?: NotificationOptions, logContext?: NotificationContext): void {
    logger.info('notification_info', { message, ...logContext });

    toast.info(message, {
      description: options?.description,
      duration: options?.duration || 3000,
      action: options?.action,
      cancel: options?.cancel,
    });
  }

}

// Singleton instance
export const notify = new NotificationService();
