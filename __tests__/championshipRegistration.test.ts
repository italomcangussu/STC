/**
 * `lib/championship/registration.ts` e `setupValues.ts` eram os dois únicos
 * furos em `lib/championship/` — 0% num diretório que no resto está entre 82% e
 * 100%. São o caminho de inscrição do Criador: o que sai daqui vira nome na
 * tela, cabeça de chave no sorteio e linha em `championship_registrations`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }));

import {
    fetchActiveStudents,
    fetchClassRegistrations,
    registerAluno,
} from '../lib/championship/registration';
import { CHAMPIONSHIP_CLASSES, emptySetup } from '../lib/championship/setupValues';
import { DEFAULT_SCORING } from '../lib/championship/creation';

/** Encadeamento do PostgREST terminando em `then`. */
const stubLeitura = (resultado: { data?: unknown; error?: unknown }) => {
    const consulta: any = {
        select: () => consulta,
        eq: () => consulta,
        order: () => Promise.resolve(resultado),
        then: (r: (v: any) => void) => Promise.resolve(resultado).then(r),
    };
    supabaseMock.from.mockReturnValue(consulta);
    return consulta;
};

const stubInsert = (resultado: { data?: unknown; error?: unknown }) => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve(resultado) }) }));
    supabaseMock.from.mockReturnValue({ insert });
    return insert;
};

/** Linha crua como o PostgREST devolve, com os embeds de perfil e aluno. */
const linha = (over: Record<string, unknown> = {}) => ({
    id: 'reg1',
    participant_type: 'socio',
    user_id: 'u1',
    guest_name: null,
    cabeca_de_chave: false,
    user: { name: 'Ana Souza' },
    student: null,
    ...over,
});

beforeEach(() => supabaseMock.from.mockReset());

describe('fetchActiveStudents', () => {
    it('devolve os alunos ativos', async () => {
        stubLeitura({ data: [{ id: 's1', name: 'Beto' }], error: null });
        expect(await fetchActiveStudents()).toEqual([{ id: 's1', name: 'Beto' }]);
    });

    it('trata ausência de aluno como lista vazia, não como erro', async () => {
        stubLeitura({ data: null, error: null });
        expect(await fetchActiveStudents()).toEqual([]);
    });

    it('propaga a falha em vez de devolver lista vazia — vazio mente aqui', async () => {
        stubLeitura({ data: null, error: { message: 'permission denied' } });
        await expect(fetchActiveStudents()).rejects.toThrow(/permission denied/);
    });
});

describe('fetchClassRegistrations — de onde vem o nome na tela', () => {
    it('usa o nome do perfil para sócio', async () => {
        stubLeitura({ data: [linha()], error: null });
        expect((await fetchClassRegistrations('c1', '4ª'))[0].name).toBe('Ana Souza');
    });

    it('usa o nome digitado para convidado', async () => {
        stubLeitura({
            data: [linha({ participant_type: 'guest', user: null, guest_name: 'Beto Lima' })],
            error: null,
        });
        expect((await fetchClassRegistrations('c1', '4ª'))[0].name).toBe('Beto Lima');
    });

    it('usa o cadastro do aluno para aluno', async () => {
        stubLeitura({
            data: [linha({ participant_type: 'aluno', user: null, student: { name: 'Carla' } })],
            error: null,
        });
        expect((await fetchClassRegistrations('c1', '4ª'))[0].name).toBe('Carla');
    });

    it('cai num rótulo genérico quando o vínculo veio quebrado, em vez de mostrar vazio', async () => {
        stubLeitura({
            data: [
                linha({ id: 'a', participant_type: 'socio', user: null }),
                linha({ id: 'b', participant_type: 'aluno', user: null, student: null }),
                linha({ id: 'c', participant_type: 'guest', user: null, guest_name: null }),
            ],
            error: null,
        });

        expect((await fetchClassRegistrations('c1', '4ª')).map(r => r.name))
            .toEqual(['Sócio', 'Aluno', 'Convidado']);
    });

    it('traz o user_id, que a semeadura por ranking precisa, e null para quem não tem', async () => {
        stubLeitura({
            data: [linha(), linha({ id: 'b', participant_type: 'guest', user_id: null, user: null })],
            error: null,
        });

        expect((await fetchClassRegistrations('c1', '4ª')).map(r => r.userId)).toEqual(['u1', null]);
    });

    it('trata cabeça de chave ausente como não-cabeça', async () => {
        stubLeitura({
            data: [linha({ cabeca_de_chave: null }), linha({ id: 'b', cabeca_de_chave: true })],
            error: null,
        });

        expect((await fetchClassRegistrations('c1', '4ª')).map(r => r.isSeed)).toEqual([false, true]);
    });

    it('devolve lista vazia quando a classe não tem inscrito', async () => {
        stubLeitura({ data: null, error: null });
        expect(await fetchClassRegistrations('c1', '4ª')).toEqual([]);
    });

    it('propaga a falha da consulta', async () => {
        stubLeitura({ data: null, error: { message: 'relation does not exist' } });
        await expect(fetchClassRegistrations('c1', '4ª')).rejects.toThrow(/relation does not exist/);
    });
});

describe('registerAluno', () => {
    it('grava o aluno na classe escolhida e devolve o id da inscrição', async () => {
        const insert = stubInsert({ data: { id: 'reg9' }, error: null });

        const id = await registerAluno({ championshipId: 'c1', studentId: 's1', classe: '5ª Classe' });

        expect(id).toBe('reg9');
        expect(insert).toHaveBeenCalledWith({
            championship_id: 'c1',
            participant_type: 'aluno',
            student_id: 's1',
            class: '5ª Classe',
        });
    });

    it('falha alto quando o banco recusa', async () => {
        stubInsert({ data: null, error: { message: 'violates check constraint' } });

        await expect(registerAluno({ championshipId: 'c1', studentId: 's1', classe: '5ª' }))
            .rejects.toThrow(/violates check constraint/);
    });

    it('falha alto quando o insert volta sem linha — sem id, ninguém foi inscrito', async () => {
        stubInsert({ data: null, error: null });

        await expect(registerAluno({ championshipId: 'c1', studentId: 's1', classe: '5ª' }))
            .rejects.toThrow(/Erro ao inscrever aluno/);
    });
});

describe('setupValues', () => {
    it('começa o Criador em branco, sem classe marcada', () => {
        const inicial = emptySetup();

        expect(inicial.name).toBe('');
        expect(inicial.classes).toEqual([]);
        expect(inicial.seriesId).toBeNull();
    });

    it('já traz a pontuação padrão preenchida', () => {
        expect(emptySetup().scoring).toEqual(DEFAULT_SCORING);
    });

    it('copia a pontuação padrão, não a referencia — mexer num campeonato não muda o padrão', () => {
        const a = emptySetup();
        a.scoring.ptsVictory = 99;

        expect(emptySetup().scoring.ptsVictory).toBe(DEFAULT_SCORING.ptsVictory);
    });

    it('cobre as seis classes do clube, em ordem', () => {
        expect(CHAMPIONSHIP_CLASSES).toEqual([
            '1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe',
        ]);
    });
});
