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
import type { ReactNode } from 'react';
import { logger } from './logger';

interface NotificationOptions {
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  cancel?: {
    label: string;
    onClick?: () => void;
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

  /**
   * Toast de loading com promise
   */
  async promise<T>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: any) => string);
    },
    logEvent: string,
    logContext?: NotificationContext
  ): Promise<T> {
    logger.info(`${logEvent}_started`, logContext);

    toast.promise(promise, {
      loading: messages.loading,
      success: (data) => {
        logger.info(`${logEvent}_success`, { ...logContext, data });
        return typeof messages.success === 'function' ? messages.success(data) : messages.success;
      },
      error: (error) => {
        logger.error(`${logEvent}_failed`, { ...logContext, error: error.message || String(error) });
        return typeof messages.error === 'function' ? messages.error(error) : messages.error;
      },
    });

    return promise;
  }

  /**
   * Toast customizado
   */
  custom(component: ReactNode, options?: { duration?: number }): void {
    toast.custom(component, {
      duration: options?.duration || 4000,
    });
  }

  /**
   * Fechar todos os toasts
   */
  dismiss(id?: string | number): void {
    toast.dismiss(id);
  }

  /**
   * Notificação de confirmação
   */
  confirm(
    message: string,
    onConfirm: () => void | Promise<void>,
    options?: {
      description?: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }
  ): void {
    toast.warning(message, {
      description: options?.description,
      duration: 10000, // Tempo maior para dar tempo de decidir
      action: {
        label: options?.confirmLabel || 'Confirmar',
        onClick: async () => {
          try {
            await onConfirm();
            this.success('Ação confirmada');
          } catch (error) {
            this.error('Erro ao executar ação', {
              description: error instanceof Error ? error.message : 'Erro desconhecido',
            });
          }
        },
      },
      cancel: {
        label: options?.cancelLabel || 'Cancelar',
      },
    });
  }
}

// Singleton instance
export const notify = new NotificationService();

/**
 * Wrapper para operações assíncronas com notificação automática
 */
export async function withNotification<T>(
  operation: () => Promise<T>,
  config: {
    loadingMessage: string;
    successMessage: string | ((data: T) => string);
    errorMessage: string | ((error: any) => string);
    logEvent: string;
    logContext?: NotificationContext;
  }
): Promise<T> {
  return notify.promise(
    operation(),
    {
      loading: config.loadingMessage,
      success: config.successMessage,
      error: config.errorMessage,
    },
    config.logEvent,
    config.logContext
  );
}
