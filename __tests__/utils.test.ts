/**
 * Testes para utils.ts - Validação de regras de tênis
 */

import { describe, it, expect } from 'vitest';
import {
  isValidSet,
  getSetWinner,
  getMatchWinner,
  countSetsWon,
  needsThirdSet,
} from '../utils';

describe('Tennis Scoring Utils', () => {
  describe('isValidSet', () => {
    it('valida sets normais (6-0 até 6-4)', () => {
      expect(isValidSet(6, 0)).toBe(true);
      expect(isValidSet(6, 1)).toBe(true);
      expect(isValidSet(6, 2)).toBe(true);
      expect(isValidSet(6, 3)).toBe(true);
      expect(isValidSet(6, 4)).toBe(true);
    });

    it('valida set 7-5', () => {
      expect(isValidSet(7, 5)).toBe(true);
      expect(isValidSet(5, 7)).toBe(true);
    });

    it('valida tiebreak 7-6', () => {
      expect(isValidSet(7, 6)).toBe(true);
      expect(isValidSet(6, 7)).toBe(true);
    });

    it('rejeita sets inválidos', () => {
      expect(isValidSet(6, 5)).toBe(false); // Precisa 7-5 ou 6-4
      expect(isValidSet(7, 4)).toBe(false); // 7-4 não existe
      expect(isValidSet(8, 6)).toBe(false); // 8-6 não existe
      expect(isValidSet(5, 3)).toBe(false); // Jogo incompleto
    });
  });

  describe('getSetWinner', () => {
    it('determina vencedor do set corretamente', () => {
      expect(getSetWinner(6, 0)).toBe('A');
      expect(getSetWinner(0, 6)).toBe('B');
      expect(getSetWinner(7, 5)).toBe('A');
      expect(getSetWinner(5, 7)).toBe('B');
      expect(getSetWinner(7, 6)).toBe('A');
      expect(getSetWinner(6, 7)).toBe('B');
    });

    it('retorna null para sets inválidos', () => {
      expect(getSetWinner(6, 5)).toBe(null);
      expect(getSetWinner(5, 3)).toBe(null);
    });
  });

  describe('getMatchWinner', () => {
    it('determina vencedor com 2-0 em sets', () => {
      expect(getMatchWinner([6, 6], [0, 0])).toBe('A');
      expect(getMatchWinner([0, 0], [6, 6])).toBe('B');
    });

    it('determina vencedor com 2-1 em sets', () => {
      expect(getMatchWinner([6, 4, 6], [4, 6, 2])).toBe('A');
      expect(getMatchWinner([4, 6, 2], [6, 4, 6])).toBe('B');
    });

    it('retorna null quando partida não terminou', () => {
      expect(getMatchWinner([6], [4])).toBe(null); // Apenas 1 set
      expect(getMatchWinner([6, 4], [4, 6])).toBe(null); // 1-1, precisa 3º set
    });
  });

  describe('countSetsWon', () => {
    it('conta sets corretamente', () => {
      const result1 = countSetsWon([6, 6], [0, 0]);
      expect(result1.setsA).toBe(2);
      expect(result1.setsB).toBe(0);

      const result2 = countSetsWon([6, 4, 6], [4, 6, 2]);
      expect(result2.setsA).toBe(2);
      expect(result2.setsB).toBe(1);

      const result3 = countSetsWon([6, 4], [4, 6]);
      expect(result3.setsA).toBe(1);
      expect(result3.setsB).toBe(1);
    });
  });

  describe('needsThirdSet', () => {
    it('detecta quando precisa de terceiro set', () => {
      expect(needsThirdSet([6, 4], [4, 6])).toBe(true);
      expect(needsThirdSet([7, 4], [5, 6])).toBe(true);
    });

    it('detecta quando não precisa de terceiro set', () => {
      expect(needsThirdSet([6, 6], [0, 0])).toBe(false); // 2-0
      expect(needsThirdSet([6], [0])).toBe(false); // Apenas 1 set jogado
    });
  });
});
