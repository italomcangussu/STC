/** Origem contábil do movimento: nunca presumir que todo valor do caixa é fin_entries. */
import type { MovementRow } from './types';

export type CashCorrectionKind='entry'|'member'|'student'|'daycard'|'opening'|'history';

export function cashCorrectionKind(m: Pick<MovementRow,'source_type'>): CashCorrectionKind {
  switch(m.source_type){
    case 'entry_payment':return 'entry';
    case 'member_payment':return 'member';
    case 'student_payment':return 'student';
    case 'day_card':return 'daycard';
    case 'opening':return 'opening';
    default:return 'history';
  }
}

/** O servidor só aceita estas origens. Não oferecer exclusão em fontes desconhecidas. */
export const REMOVABLE_CASH_SOURCES = [
  'entry_payment','member_payment','member_reversal','student_payment','day_card','opening',
] as const;

export function canRemoveCashMovement(sourceType: string): boolean {
  return REMOVABLE_CASH_SOURCES.some(type => type === sourceType);
}
