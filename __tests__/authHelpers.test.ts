/**
 * Testes para authHelpers.ts - Geração de credenciais
 */

import { describe, it, expect } from 'vitest';
import { generateEmailFromPhone, generatePasswordFromPhone } from '../lib/authHelpers';

describe('Auth Helpers', () => {
  describe('generateEmailFromPhone', () => {
    it('gera email corretamente de telefone limpo', () => {
      expect(generateEmailFromPhone('88999887766')).toBe('88999887766@reserva.com');
    });

    it('limpa caracteres especiais do telefone', () => {
      expect(generateEmailFromPhone('(88) 99988-7766')).toBe('88999887766@reserva.com');
      expect(generateEmailFromPhone('+55 88 99988-7766')).toBe('5588999887766@reserva.com');
    });
  });

  describe('generatePasswordFromPhone', () => {
    it('gera senha determinística corretamente', () => {
      expect(generatePasswordFromPhone('88999887766')).toBe('sct889998877662024');
    });

    it('limpa caracteres especiais antes de gerar senha', () => {
      expect(generatePasswordFromPhone('(88) 99988-7766')).toBe('sct889998877662024');
      expect(generatePasswordFromPhone('+55 88 99988-7766')).toBe('sct55889998877662024');
    });

    it('gera mesma senha para mesmo telefone (determinístico)', () => {
      const phone = '88999887766';
      const password1 = generatePasswordFromPhone(phone);
      const password2 = generatePasswordFromPhone(phone);
      expect(password1).toBe(password2);
    });

    it('gera senhas diferentes para telefones diferentes', () => {
      const password1 = generatePasswordFromPhone('88999887766');
      const password2 = generatePasswordFromPhone('88999887755');
      expect(password1).not.toBe(password2);
    });
  });
});
