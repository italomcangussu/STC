/**
 * Telefones de Conversas. No banco o número fica em dígitos com DDI (`5588999990000`);
 * grupo não tem telefone: o destino é o `…@g.us`.
 */
export const onlyDigits = (v: string): string => (v ?? '').replace(/\D/g, '');

/** `(88) 99999-0000` enquanto digita (DDD + número, sem DDI). */
export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Como mostrar o destino de uma conversa: telefone BR formatado, ou o texto como veio (grupo, LID). */
export function formatWhatsAppDisplay(destination: string | null | undefined): string {
  const v = (destination ?? '').trim();
  if (!v) return '';
  if (v.includes('@')) return 'Grupo';
  const d = onlyDigits(v);
  const local = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
  if (local.length === 10 || local.length === 11) return maskPhone(local);
  return d ? `+${d}` : v;
}
