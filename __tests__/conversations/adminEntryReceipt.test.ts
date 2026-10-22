import { describe, expect, it } from 'vitest';
import { adminProposalMessage, adminSuccessMessage } from '../../supabase/functions/_shared/aiAgent/adminMessages';

const despesa = { entry_kind: 'expense', description: 'Mão de obra do bombeiro', amount_cents: 15000, category_name: 'Outras despesas',
  account_name: 'Cora', entry_status: 'paid', paid_on: '2026-10-13' };

describe('João: comprovante anexado ao lançamento', () => {
  it('avisa na proposta e no "pronto" quando o comprovante vai junto', () => {
    const s = { ...despesa, receipt_id: 'r1', receipt_file: 'bombeiro.pdf' };
    expect(adminProposalMessage('fin_entry_create', s)).toMatch(/com o comprovante que você mandou anexado\. Confirma\?$/);
    expect(adminSuccessMessage('fin_entry_create', s)).toBe('Pronto: despesa lançada: Mão de obra do bombeiro, R$ 150,00, comprovante anexado.');
  });
  it('sem comprovante que bata o valor, a mensagem é a de sempre', () => {
    expect(adminProposalMessage('fin_entry_create', despesa)).not.toMatch(/comprovante/);
    expect(adminSuccessMessage('fin_entry_create', despesa)).toBe('Pronto: despesa lançada: Mão de obra do bombeiro, R$ 150,00.');
  });
});
