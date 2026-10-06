import { describe, it, expect } from 'vitest';
import { ADMIN_GROUPS, ALL_SECTIONS, searchSections, groupOf, isAdminTabId } from '../components/admin/adminNav';

describe('adminNav', () => {
    it('cobre as 15 seções sem duplicar', () => {
        expect(ALL_SECTIONS).toHaveLength(15);
        expect(new Set(ALL_SECTIONS.map(s => s.id)).size).toBe(15);
    });
    it('busca ignora acentos e caixa', () => {
        expect(searchSections('Mensalidade').map(s => s.id)).toEqual(['financeiro']);
        expect(searchSections('SÓCIO').map(s => s.id)).toContain('socios');
        expect(searchSections('')).toEqual([]);
    });
    it('encontra o grupo da seção', () => {
        expect(groupOf('alunos').id).toBe('pessoas');
        expect(ADMIN_GROUPS.length).toBe(5);
    });
    it('valida ids', () => {
        expect(isAdminTabId('reservas')).toBe(true);
        expect(isAdminTabId('x')).toBe(false);
    });
});
