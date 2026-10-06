/**
 * Busca por texto digitado (nome de sócio, aluno, atleta…).
 *
 * Quem digita no celular quase nunca acentua: "joao" tem que achar "João", e
 * "SOCIA" tem que achar "Sócia". Um espaço a mais no fim (o teclado do iPhone
 * coloca um ao aceitar a sugestão) também não pode esconder o resultado.
 */

/** Sem acento, sem maiúsculas, espaços repetidos viram um só e sem espaço nas pontas. */
export const normalizeSearch = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** `true` se algum dos campos contém o termo. Termo vazio casa com tudo. */
export const matchesSearch = (term: string, ...fields: Array<string | null | undefined>): boolean => {
  const t = normalizeSearch(term);
  if (!t) return true;
  return fields.some((f) => normalizeSearch(f).includes(t));
};
