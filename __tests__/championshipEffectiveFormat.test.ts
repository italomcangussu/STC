import { describe, expect, it } from 'vitest';
import {
    classesWithFormat,
    resolveClassFormat,
} from '../lib/championship/effectiveFormat';

const multi = {
    format: 'mata-mata',
    format_config: {
        '4ª Classe': { format: 'mata-mata', seeded: true, qualifying: null, mainDrawStartPhase: 'round_of_16' },
        '5ª Classe': { format: 'grupo-mata-mata', homeAndAway: false, groupCount: 4, membersPerGroup: 4, qualifiersPerGroup: 2, bestThirdPlaces: 0, seeded: true },
    },
};

const legado = { format: 'grupo-mata-mata', format_config: null };

describe('championship/effectiveFormat', () => {
    describe('resolveClassFormat', () => {
        it('devolve o formato da classe pedida', () => {
            expect(resolveClassFormat(multi, '5ª Classe')).toBe('grupo-mata-mata');
            expect(resolveClassFormat(multi, '4ª Classe')).toBe('mata-mata');
        });

        it('cai na coluna format em campeonato do modelo antigo', () => {
            expect(resolveClassFormat(legado, '5ª Classe')).toBe('grupo-mata-mata');
        });

        it('cai na coluna format quando a classe não está no mapa', () => {
            expect(resolveClassFormat(multi, '6ª Classe')).toBe('mata-mata');
        });

        it('cai na coluna format quando a classe é nula ou "Todas"', () => {
            expect(resolveClassFormat(multi, null)).toBe('mata-mata');
            expect(resolveClassFormat(multi, 'Todas')).toBe('mata-mata');
        });

        it('tolera campeonato sem formato nenhum', () => {
            expect(resolveClassFormat({ format: null, format_config: null }, '4ª Classe')).toBe('mata-mata');
        });

        it('ignora format_config que não seja um mapa por classe', () => {
            const antigo = { format: 'pontos-corridos', format_config: { format: 'mata-mata', seeded: true } };
            expect(resolveClassFormat(antigo, '4ª Classe')).toBe('pontos-corridos');
        });
    });

    describe('classesWithFormat', () => {
        it('lista as classes configuradas', () => {
            expect(classesWithFormat(multi)).toEqual(['4ª Classe', '5ª Classe']);
        });

        it('devolve vazio no modelo antigo', () => {
            expect(classesWithFormat(legado)).toEqual([]);
        });

        it('diz se o campeonato mistura formatos', () => {
            expect(classesWithFormat(multi).length).toBe(2);
            expect(new Set(classesWithFormat(multi).map(c => resolveClassFormat(multi, c))).size).toBe(2);
        });
    });
});
