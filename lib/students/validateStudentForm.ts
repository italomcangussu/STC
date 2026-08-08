import type { HumanError } from '../humanErrors';

/**
 * Campos que o cadastro de aluno exige, em qualquer uma das duas telas que o
 * fazem — `AdminStudents` (admin) e `ProfessorProfile` (professor).
 *
 * As duas mantinham a mesma sequência de `if`s com as mesmas mensagens, e já
 * tinham divergido: só a do admin cobrava professor responsável. Regra
 * duplicada é regra que envelhece em ritmos diferentes.
 */
export interface StudentFormDraft {
    name?: string | null;
    studentType?: string | null;
    responsibleSocioId?: string | null;
    relationshipType?: string | null;
    professorId?: string | null;
}

export interface StudentFormRules {
    /** Só cobra professor onde há professor a escolher — o próprio já é o dono. */
    requireProfessor?: boolean;
}

/**
 * Devolve o primeiro problema encontrado, ou `null` quando está tudo certo.
 *
 * Um erro por vez, e não a lista inteira: o formulário é curto, e apontar o
 * próximo passo é mais útil do que despejar tudo o que falta.
 */
export function validateStudentForm(
    form: StudentFormDraft,
    rules: StudentFormRules = {}
): HumanError | null {
    if (!form.name?.trim()) {
        return {
            message: 'O aluno precisa de um nome.',
            hint: 'Preencha o campo Nome para continuar.',
        };
    }

    if (form.studentType === 'dependent') {
        if (!form.responsibleSocioId) {
            return {
                message: 'Falta o sócio responsável.',
                hint: 'Todo dependente é vinculado a um sócio. Escolha qual.',
            };
        }
        if (!form.relationshipType) {
            return {
                message: 'Falta o tipo de vínculo.',
                hint: 'Informe se é filho, cônjuge ou outro parentesco.',
            };
        }
        return null;
    }

    if (rules.requireProfessor && !form.professorId) {
        return {
            message: 'Falta o professor responsável.',
            hint: 'Escolha quem vai acompanhar este aluno.',
        };
    }

    return null;
}
