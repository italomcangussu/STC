import { describe, expect, it } from 'vitest';
import { canParticipateInClass, getCardStatus } from '../lib/students/studentRules';

const regularStudent = {
  relationship: 'non-socio' as const,
  status: 'active' as const,
  planType: 'Card Mensal' as const,
  planStatus: 'active' as const,
  expirationDate: '2026-10-31',
};

describe('student participation rules', () => {
  it('allows a socio student without a monthly card', () => {
    expect(canParticipateInClass({ relationship: 'socio', status: 'active' }, '2026-10-05')).toBe(true);
  });

  it('allows a dependent without a payment', () => {
    expect(canParticipateInClass({ relationship: 'dependent', status: 'active' }, '2026-10-05')).toBe(true);
  });

  it('allows an active non-socio with a valid monthly card', () => {
    expect(canParticipateInClass(regularStudent, '2026-10-05')).toBe(true);
  });

  it('blocks an active non-socio with an expired monthly card', () => {
    expect(canParticipateInClass({ ...regularStudent, expirationDate: '2026-10-02' }, '2026-10-05')).toBe(false);
  });

  it('does not confuse a paused student with a card payment state', () => {
    expect(canParticipateInClass({ ...regularStudent, status: 'paused' }, '2026-10-05')).toBe(false);
  });

  it('reports card expiration independently of student status', () => {
    expect(getCardStatus({ ...regularStudent, status: 'active', expirationDate: '2026-10-02' }, '2026-10-05')).toBe('expired');
  });
});
