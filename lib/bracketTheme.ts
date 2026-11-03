export type TemaDaChave = 'noite' | 'saibro';

/**
 * Classes que jogam no saibro ganham o tema de chão de saibro.
 *
 * O banco não guarda em que superfície cada classe joga; enquanto não guardar,
 * a lista mora aqui. Contrato em .fabuloso/design/direcoes/chave.md.
 */
const CLASSES_NO_SAIBRO = new Set(['4ª Classe']);

export function temaDaClasse(classe: string): TemaDaChave {
    return CLASSES_NO_SAIBRO.has(classe.trim()) ? 'saibro' : 'noite';
}
