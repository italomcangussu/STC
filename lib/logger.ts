/**
 * Sistema de Logs Estruturado para STC Play
 *
 * Uso:
 * import { logger } from './lib/logger';
 * logger.error('reservation_failed', { userId, courtId, error });
 * logger.info('reservation_created', { reservationId, userId });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: any;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  context?: LogContext;
  message?: string;
}

class Logger {
  private isDevelopment = import.meta.env.VITE_ENV === 'development' || import.meta.env.DEV;

  private formatLog(entry: LogEntry): string {
    return JSON.stringify(entry, null, this.isDevelopment ? 2 : 0);
  }

  private log(level: LogLevel, event: string, context?: LogContext, message?: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      context,
      message,
    };

    // Em desenvolvimento, log formatado no console
    if (this.isDevelopment) {
      const emoji = {
        debug: '🔍',
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌',
      }[level];

      console.group(`${emoji} [${level.toUpperCase()}] ${event}`);
      if (message) console.log('Message:', message);
      if (context) console.log('Context:', context);
      console.log('Time:', entry.timestamp);
      console.groupEnd();
    } else {
      // Em produção, log JSON estruturado
      console.log(this.formatLog(entry));
    }

    // Em produção, enviar para serviço de logging (Sentry, LogRocket, etc.)
    if (!this.isDevelopment) {
      this.sendToLoggingService(entry);
    }
  }

  private sendToLoggingService(entry: LogEntry): void {
    // TODO: Integrar com Sentry, LogRocket, ou outro serviço
    // Exemplo com Sentry:
    // if (entry.level === 'error') {
    //   Sentry.captureException(new Error(entry.event), {
    //     extra: entry.context
    //   });
    // }
  }

  /**
   * Log de debug - apenas em desenvolvimento
   */
  debug(event: string, context?: LogContext, message?: string): void {
    if (this.isDevelopment) {
      this.log('debug', event, context, message);
    }
  }

  /**
   * Log informativo
   */
  info(event: string, context?: LogContext, message?: string): void {
    this.log('info', event, context, message);
  }

  /**
   * Log de aviso
   */
  warn(event: string, context?: LogContext, message?: string): void {
    this.log('warn', event, context, message);
  }

  /**
   * Log de erro - sempre registrado
   */
  error(event: string, context?: LogContext, message?: string): void {
    this.log('error', event, context, message);
  }

  /**
   * Wrapper para capturar exceções
   */
  captureException(error: Error, context?: LogContext): void {
    this.error('exception_caught', {
      ...context,
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    });
  }
}

// Singleton instance
export const logger = new Logger();

/**
 * HOC para adicionar error boundary com logging
 */
export function withErrorLogging<T extends (...args: any[]) => any>(
  fn: T,
  eventName: string
): T {
  return ((...args: Parameters<T>): ReturnType<T> => {
    try {
      return fn(...args);
    } catch (error) {
      logger.error(eventName, {
        args,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }) as T;
}

/**
 * Hook para logging de performance
 */
export function logPerformance(label: string): () => void {
  const start = performance.now();

  return () => {
    const duration = performance.now() - start;
    logger.debug('performance_measurement', {
      label,
      duration: `${duration.toFixed(2)}ms`,
    });
  };
}
