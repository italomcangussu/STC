/**
 * Testes para humanErrors.ts — tradução de erro técnico em mensagem acionável.
 */

import { describe, it, expect } from 'vitest';
import { CHAMPIONSHIP_ERRORS, humanizeError } from '../lib/humanErrors';

describe('humanizeError', () => {
    describe('códigos do Postgres', () => {
        it('traduz violação de unicidade (23505)', () => {
            const result = humanizeError({ code: '23505', message: 'duplicate key value violates unique constraint' });
            expect(result.message).toBe('Este registro já existe.');
            expect(result.hint).toBeTruthy();
        });

        it('traduz violação de chave estrangeira (23503)', () => {
            expect(humanizeError({ code: '23503', message: 'FK violation' }).message)
                .toBe('Este item depende de outro que não existe mais.');
        });

        it('traduz bloqueio de RLS (42501) sem culpar o usuário', () => {
            const result = humanizeError({ code: '42501', message: 'permission denied for table matches' });
            expect(result.message).toBe('Você não tem permissão para esta ação.');
            // A dica precisa oferecer uma saída, não só constatar o bloqueio.
            expect(result.hint).toContain('administrador');
        });

        it('aceita código numérico', () => {
            expect(humanizeError({ code: 23505, message: 'x' }).message).toBe('Este registro já existe.');
        });
    });

    describe('códigos do PostgREST', () => {
        it('traduz registro não encontrado (PGRST116)', () => {
            expect(humanizeError({ code: 'PGRST116', message: 'no rows' }).message)
                .toBe('Registro não encontrado.');
        });

        it('traduz sessão expirada (PGRST301)', () => {
            expect(humanizeError({ code: 'PGRST301', message: 'JWT expired' }).message)
                .toBe('Sua sessão expirou.');
        });
    });

    describe('falha de rede', () => {
        it('reconhece o TypeError do fetch', () => {
            const result = humanizeError(new TypeError('Failed to fetch'));
            expect(result.message).toBe('Sem conexão com o servidor.');
            // Tranquilizar sobre o estado dos dados evita o clique repetido.
            expect(result.hint).toContain('nada foi salvo');
        });

        it('reconhece variações de mensagem de rede', () => {
            expect(humanizeError(new Error('NetworkError when attempting to fetch')).message)
                .toBe('Sem conexão com o servidor.');
            expect(humanizeError(new Error('Load failed')).message)
                .toBe('Sem conexão com o servidor.');
            expect(humanizeError(new Error('The operation was aborted')).message)
                .toBe('Sem conexão com o servidor.');
        });

        it('rede tem precedência sobre código, porque o código não chegou a ser gerado', () => {
            const result = humanizeError({ code: '23505', message: 'Failed to fetch' });
            expect(result.message).toBe('Sem conexão com o servidor.');
        });
    });

    describe('erro desconhecido', () => {
        it('usa o fallback como título e o texto cru como pista', () => {
            const result = humanizeError(new Error('constraint xyz_fkey blew up'), 'Não foi possível salvar o placar.');
            expect(result.message).toBe('Não foi possível salvar o placar.');
            expect(result.hint).toBe('constraint xyz_fkey blew up');
        });

        it('usa o fallback padrão quando nenhum é passado', () => {
            expect(humanizeError(new Error('???')).message).toBe('Não foi possível concluir a operação.');
        });

        it('ignora código desconhecido e cai no fallback', () => {
            const result = humanizeError({ code: '99999', message: 'algo estranho' }, 'Falhou.');
            expect(result.message).toBe('Falhou.');
            expect(result.hint).toBe('algo estranho');
        });

        it('não vira dica com lixo quando não há texto útil', () => {
            expect(humanizeError(null, 'Falhou.').hint).toBeUndefined();
            expect(humanizeError(undefined, 'Falhou.').hint).toBeUndefined();
            expect(humanizeError({ message: '   ' }, 'Falhou.').hint).toBeUndefined();
        });

        it('aceita string crua', () => {
            expect(humanizeError('deu ruim', 'Falhou.').hint).toBe('deu ruim');
        });
    });
});

describe('CHAMPIONSHIP_ERRORS', () => {
    it('toda mensagem termina com pontuação e toda entrada tem dica acionável', () => {
        for (const [chave, erro] of Object.entries(CHAMPIONSHIP_ERRORS)) {
            expect(erro.message.length, `${chave}: mensagem vazia`).toBeGreaterThan(0);
            expect(erro.message, `${chave}: mensagem sem pontuação final`).toMatch(/[.!?]$/);
            expect(erro.hint, `${chave}: sem dica de correção`).toBeTruthy();
        }
    });

    it('explica por que empate não vale no mata-mata, em vez de só proibir', () => {
        expect(CHAMPIONSHIP_ERRORS.empateNoMataMata.hint).toContain('próxima fase');
    });
});
