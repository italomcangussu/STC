import { describe, expect, it } from 'vitest';
import { temaDaClasse } from '../lib/bracketTheme';

describe('temaDaClasse', () => {
    it('dá o tema saibro à 4ª Classe, que joga no saibro', () => {
        expect(temaDaClasse('4ª Classe')).toBe('saibro');
        expect(temaDaClasse(' 4ª Classe ')).toBe('saibro');
    });

    it('dá o tema noite às demais classes', () => {
        expect(temaDaClasse('5ª Classe')).toBe('noite');
        expect(temaDaClasse('Feminino')).toBe('noite');
    });
});
