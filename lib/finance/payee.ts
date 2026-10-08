/**
 * Conferência do favorecido de um comprovante. Espelha `fin_private.payee_matches` e
 * `fin_private.cnpj_matches` (a baixa automática decide no SQL; aqui é a mesma regra para a tela e os testes).
 */

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** O nome esperado do clube aparece, em palavras inteiras, dentro do nome lido (nunca o contrário). */
export function payeeNameMatches(read: string | null | undefined, expected: string[]): boolean {
  const got = ` ${norm(read ?? '')} `;
  return expected.some((e) => {
    const n = norm(e);
    return n.length >= 3 && got.includes(` ${n} `);
  });
}

/** CNPJ lido (dígitos e `*` nos mascarados, 14 posições) confere com a chave Pix do clube. */
export function payeeCnpjMatches(read: string | null | undefined, pixKey: string | null | undefined): boolean {
  const r = (read ?? '').replace(/[^0-9*]/g, '');
  const k = (pixKey ?? '').replace(/\D/g, '');
  if (r.length !== 14 || k.length !== 14) return false;
  if (r.replace(/\*/g, '').length < 8) return false;
  for (let i = 0; i < 14; i++) if (r[i] !== '*' && r[i] !== k[i]) return false;
  return true;
}
