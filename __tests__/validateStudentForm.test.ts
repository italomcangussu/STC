import { describe, expect, it } from 'vitest';
import { validateStudentForm } from '../lib/students/validateStudentForm';

const regular = { name: 'Ana', studentType: 'regular', professorId: 'p1' };
const dependente = {
    name: 'Ana', studentType: 'dependent', responsibleSocioId: 's1', relationshipType: 'filho',
};

describe('validateStudentForm', () => {
    it('aprova um aluno regular completo', () => {
        expect(validateStudentForm(regular, { requireProfessor: true })).toBeNull();
    });

    it('aprova um dependente completo', () => {
        expect(validateStudentForm(dependente)).toBeNull();
    });

    it('cobra o nome antes de tudo', () => {
        expect(validateStudentForm({ ...regular, name: '' })?.message).toMatch(/nome/i);
    });

    it('não aceita nome só de espaços', () => {
        expect(validateStudentForm({ ...regular, name: '   ' })).not.toBeNull();
    });

    it('cobra o sócio responsável do dependente', () => {
        const erro = validateStudentForm({ ...dependente, responsibleSocioId: '' });
        expect(erro?.message).toMatch(/sócio responsável/i);
    });

    it('cobra o tipo de vínculo do dependente', () => {
        const erro = validateStudentForm({ ...dependente, relationshipType: '' });
        expect(erro?.message).toMatch(/vínculo/i);
    });

    it('não cobra professor de dependente — quem responde por ele é o sócio', () => {
        expect(validateStudentForm(dependente, { requireProfessor: true })).toBeNull();
    });

    it('cobra professor do aluno regular quando a tela pede', () => {
        const erro = validateStudentForm({ ...regular, professorId: '' }, { requireProfessor: true });
        expect(erro?.message).toMatch(/professor/i);
    });

    it('dispensa professor quando a tela não pede — o professor logado já é o dono', () => {
        expect(validateStudentForm({ ...regular, professorId: '' })).toBeNull();
    });

    it('sempre explica o que fazer, não só o que falta', () => {
        const erros = [
            validateStudentForm({}),
            validateStudentForm({ name: 'Ana', studentType: 'dependent' }),
            validateStudentForm({ name: 'Ana', studentType: 'dependent', responsibleSocioId: 's1' }),
            validateStudentForm({ name: 'Ana' }, { requireProfessor: true }),
        ];
        for (const erro of erros) {
            expect(erro?.hint, `sem hint: ${erro?.message}`).toBeTruthy();
        }
    });
});
