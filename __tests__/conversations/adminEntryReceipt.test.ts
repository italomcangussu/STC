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
  it('comprovante de conta já pendente: propõe a baixa nela, não despesa nova (Henrique, 05/11)', () => {
    const s = { ...despesa, description: 'Pagamento do aluguel', amount_cents: 324200, paid_on: '2026-11-05', receipt_id: 'r1',
      settles_entry_id: 'e1', settles_description: 'Aluguel do Espaço', settles_due_date: '2026-11-05' };
    const prop = adminProposalMessage('fin_entry_create', s);
    expect(prop).toContain('já estava lançada como pendente: Aluguel do Espaço (venc. 05/11/2026), R$ 3.242,00');
    expect(prop).toContain('Vou dar baixa nela');
    expect(prop).toContain('sem lançar despesa nova');
    expect(prop).not.toContain('Vou lançar a despesa');
    expect(adminSuccessMessage('fin_entry_create', s)).toBe('Pronto: baixa dada em Aluguel do Espaço, R$ 3.242,00, comprovante anexado.');
  });
});
