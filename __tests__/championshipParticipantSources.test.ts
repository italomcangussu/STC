import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import {
    DEFAULT_SOURCES,
    deriveSources,
    fetchParticipantSources,
    saveParticipantSources,
} from '../lib/championship/participantSources';

const stubSelect = (result: { data?: unknown; error?: unknown }) => {
    supabaseMock.from.mockReturnValue({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }),
    });
};

const stubUpdate = (result: { error: unknown }) => {
    const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve(result) });
    supabaseMock.from.mockReturnValue({ update });
    return update;
};

const regs = (...types: string[]) => types.map(participantType => ({ participantType }));

describe('championship/participantSources', () => {
    beforeEach(() => supabaseMock.from.mockReset());

    describe('deriveSources', () => {
        it('não liga nada quando só há sócios', () => {
            expect(deriveSources(regs('socio', 'socio'))).toEqual(DEFAULT_SOURCES);
        });

        it('liga convidados quando há um convidado inscrito', () => {
            expect(deriveSources(regs('socio', 'guest')).allowGuests).toBe(true);
        });

        it('liga alunos quando há um aluno inscrito', () => {
            expect(deriveSources(regs('aluno')).allowStudents).toBe(true);
        });

        it('nunca desliga o que veio gravado — a escolha do admin vem antes da evidência', () => {
            const base = { allowGuests: true, allowStudents: true };
            expect(deriveSources(regs('socio'), base)).toEqual(base);
        });
    });

    describe('fetchParticipantSources', () => {
        it('lê o que está gravado', async () => {
            stubSelect({ data: { allow_guests: true, allow_students: false }, error: null });

            expect(await fetchParticipantSources('c1'))
                .toEqual({ allowGuests: true, allowStudents: false });
        });

        it('trata linha ausente como default, sem quebrar', async () => {
            stubSelect({ data: null, error: null });
            expect(await fetchParticipantSources('c1')).toEqual(DEFAULT_SOURCES);
        });

        it('cai para o default quando a migration ainda não foi aplicada', async () => {
            stubSelect({ error: { code: '42703', message: 'column does not exist' } });
            expect(await fetchParticipantSources('c1')).toEqual(DEFAULT_SOURCES);
        });

        it('propaga erro que não seja coluna faltando — RLS não pode passar despercebido', async () => {
            stubSelect({ error: { code: '42501', message: 'permission denied' } });
            await expect(fetchParticipantSources('c1')).rejects.toMatchObject({ code: '42501' });
        });
    });

    describe('saveParticipantSources', () => {
        it('grava só o toggle que mudou', async () => {
            const update = stubUpdate({ error: null });

            await saveParticipantSources('c1', { allowGuests: true });

            expect(update).toHaveBeenCalledWith({ allow_guests: true });
        });

        it('não chama o banco quando não há nada para gravar', async () => {
            await saveParticipantSources('c1', {});
            expect(supabaseMock.from).not.toHaveBeenCalled();
        });

        it('engole silenciosamente a coluna faltando — é problema de deploy, não do admin', async () => {
            stubUpdate({ error: { code: 'PGRST204', message: 'unknown column' } });
            await expect(saveParticipantSources('c1', { allowStudents: true })).resolves.toBeUndefined();
        });

        it('propaga qualquer outro erro', async () => {
            stubUpdate({ error: { code: '42501', message: 'permission denied' } });
            await expect(saveParticipantSources('c1', { allowStudents: true }))
                .rejects.toMatchObject({ code: '42501' });
        });
    });
});
