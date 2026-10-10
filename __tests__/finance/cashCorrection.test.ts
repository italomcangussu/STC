import { describe, expect, it } from 'vitest';
import { canRemoveCashMovement, cashCorrectionKind } from '../../lib/finance/cashCorrection';

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

  it.each(['entry_payment','member_payment','member_reversal','student_payment','day_card','opening'])(
    'permite a exclusão administrativa de %s', source => {
      expect(canRemoveCashMovement(source)).toBe(true);
    }
  );
  it('bloqueia origens financeiras desconhecidas',()=>{
    expect(canRemoveCashMovement('other')).toBe(false);
  });
  it('permite excluir o estorno antigo pelo modal mesmo sendo histórico',()=>{
    expect(cashCorrectionKind({source_type:'member_reversal'})).toBe('history');
    expect(canRemoveCashMovement('member_reversal')).toBe(true);
  });

  it('nunca libera exclusão de um Day Card derivado como documento manual',()=>{
    expect(cashCorrectionKind({source_type:'day_card'})).not.toBe('entry');
  });
  it('não reverte estorno existente como se fosse pagamento novo',()=>{
    expect(cashCorrectionKind({source_type:'member_reversal'})).toBe('history');
  });
});
