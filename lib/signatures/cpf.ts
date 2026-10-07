// CPF declarado pelo sócio. A mesma regra do banco (`sig_private.cpf_valid`): o servidor sempre revalida;
// aqui só se avisa na hora da digitação.

export const cpfDigits = (value: string): string => (value ?? '').replace(/\D/g, '').slice(0, 11);

export function cpfValid(value: string): boolean {
  const d = (value ?? '').replace(/\D/g, '');
  if (!/^[0-9]{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

/** Máscara progressiva: `12345` → `123.45`, `12345678909` → `123.456.789-09`. */
export function formatCpf(value: string): string {
  const d = cpfDigits(value);
  const parts = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join('.');
  return d.length > 9 ? `${parts}-${d.slice(9)}` : parts;
}

/** Mostra o CPF já salvo sem expô-lo por inteiro na tela: `•••.456.789-••`. */
export function maskCpf(value: string): string {
  const d = cpfDigits(value);
  return d.length === 11 ? `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-••` : '';
}
