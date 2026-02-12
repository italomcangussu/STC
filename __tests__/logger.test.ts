/**
 * Testes para logger.ts - Sistema de logs estruturado
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, withErrorLogging } from '../lib/logger';

describe('Logger', () => {
  // Mock console methods
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'group').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  });

  describe('log levels', () => {
    it('registra mensagem de erro', () => {
      logger.error('test_error', { userId: '123' }, 'Test error message');
      expect(console.group).toHaveBeenCalled();
    });

    it('registra mensagem de info', () => {
      logger.info('test_info', { action: 'test' });
      expect(console.group).toHaveBeenCalled();
    });

    it('registra mensagem de warning', () => {
      logger.warn('test_warning', { level: 'medium' });
      expect(console.group).toHaveBeenCalled();
    });
  });

  describe('captureException', () => {
    it('captura exceção com contexto', () => {
      const error = new Error('Test error');
      logger.captureException(error, { userId: '123' });
      expect(console.group).toHaveBeenCalled();
    });
  });

  describe('withErrorLogging', () => {
    it('executa função normalmente quando não há erro', () => {
      const fn = withErrorLogging((a: number, b: number) => a + b, 'test_addition');
      const result = fn(2, 3);
      expect(result).toBe(5);
    });

    it('captura erro e re-throw', () => {
      const fn = withErrorLogging(() => {
        throw new Error('Test error');
      }, 'test_error');

      expect(() => fn()).toThrow('Test error');
      expect(console.group).toHaveBeenCalled();
    });
  });
});
