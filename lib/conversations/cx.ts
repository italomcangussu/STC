/** Junta classes ignorando valores falsos: `cx('a', cond && 'b')`. */
export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');
