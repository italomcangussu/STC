import { supabase } from '../supabase';

export interface StudentOption {
    id: string;
    name: string;
}

export async function fetchActiveStudents(): Promise<StudentOption[]> {
    const { data, error } = await supabase
        .from('non_socio_students')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

    if (error) throw new Error(`Erro ao buscar alunos: ${error.message}`);
    return (data ?? []) as StudentOption[];
}

export interface ClassRegistration {
    registrationId: string;
    name: string;
    participantType: 'socio' | 'guest' | 'aluno';
    userId: string | null;
    isSeed: boolean;
}

/**
 * Inscritos de uma classe, em qualquer classe e com qualquer tipo de participante.
 * A versão do Resenha (fetchRegistrations) é tipada em ResenhaClass e não
 * devolve user_id, que a semeadura por ranking precisa.
 */
export async function fetchClassRegistrations(
    championshipId: string,
    classe: string
): Promise<ClassRegistration[]> {
    const { data, error } = await supabase
        .from('championship_registrations')
        .select('id, participant_type, user_id, guest_name, cabeca_de_chave, user:profiles(name), student:non_socio_students(name)')
        .eq('championship_id', championshipId)
        .eq('class', classe);

    if (error) throw new Error(`Erro ao buscar inscrições: ${error.message}`);

    return (data ?? []).map((r: any) => {
        const name = r.participant_type === 'socio'
            ? (r.user?.name ?? 'Sócio')
            : r.participant_type === 'aluno'
                ? (r.student?.name ?? 'Aluno')
                : (r.guest_name ?? 'Convidado');

        return {
            registrationId: r.id,
            name,
            participantType: r.participant_type,
            userId: r.user_id ?? null,
            isSeed: r.cabeca_de_chave ?? false,
        };
    });
}

/**
 * Inscreve um aluno. A classe vem do seletor do passo de inscrições:
 * non_socio_students não guarda categoria de tênis (decisão D7 da spec).
 */
export async function registerAluno(params: {
    championshipId: string;
    studentId: string;
    classe: string;
}): Promise<string> {
    const { data, error } = await supabase
        .from('championship_registrations')
        .insert({
            championship_id: params.championshipId,
            participant_type: 'aluno',
            student_id: params.studentId,
            class: params.classe,
        })
        .select('id')
        .single();

    if (error || !data) throw new Error(`Erro ao inscrever aluno: ${error?.message}`);
    return data.id;
}
