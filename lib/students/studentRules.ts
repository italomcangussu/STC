export type StudentRelationship = 'socio' | 'non-socio' | 'dependent';
export type StudentStatus = 'active' | 'paused' | 'ended';
export type StudentLevel =
  | 'Iniciante'
  | 'Iniciante Avançado'
  | 'Intermediário'
  | 'Intermediário Avançado'
  | 'Avançado';
export type StudentPlanType = 'Day Card' | 'Card Mensal' | 'Dependente' | 'Day Card Experimental';
export type StudentCardStatus = 'not-required' | 'valid' | 'expired' | 'inactive';

export const STUDENT_LEVELS: StudentLevel[] = [
  'Iniciante',
  'Iniciante Avançado',
  'Intermediário',
  'Intermediário Avançado',
  'Avançado',
];

export interface StudentAccessData {
  relationship: StudentRelationship;
  status: StudentStatus;
  planType?: StudentPlanType;
  planStatus?: 'active' | 'inactive';
  expirationDate?: string | null;
}

export function getCardStatus(student: StudentAccessData, onDate: string): StudentCardStatus {
  if (student.relationship === 'socio' || student.relationship === 'dependent') return 'not-required';
  if (student.planStatus !== 'active') return 'inactive';
  if (student.planType === 'Card Mensal') {
    return student.expirationDate && student.expirationDate >= onDate ? 'valid' : 'expired';
  }
  return 'valid';
}

export function canParticipateInClass(student: StudentAccessData, onDate: string): boolean {
  if (student.status !== 'active') return false;
  const cardStatus = getCardStatus(student, onDate);
  return cardStatus === 'not-required' || cardStatus === 'valid';
}
