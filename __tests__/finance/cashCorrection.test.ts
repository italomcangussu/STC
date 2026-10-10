import { describe, expect, it } from 'vitest';
import { cashCorrectionKind } from '../../lib/finance/cashCorrection';

describe('Correção do fluxo de caixa — identificar origem antes de anular', () => {
  it.each([
    ['entry_payment','entry'],
    ['member_payment','member'],
    ['student_payment','student'],
    ['day_card','daycard'],
    ['opening','opening'],
    ['member_reversal','history'],
    ['other','history'],
  ] as const)('%s encaminha para %s', (source_type, expected) => {
    expect(cashCorrectionKind({source_type})).toBe(expected);
  });

  it('nunca libera exclusão de um Day Card derivado como documento manual',()=>{
    expect(cashCorrectionKind({source_type:'day_card'})).not.toBe('entry');
  });
  it('não reverte estorno existente como se fosse pagamento novo',()=>{
    expect(cashCorrectionKind({source_type:'member_reversal'})).toBe('history');
  });
});
