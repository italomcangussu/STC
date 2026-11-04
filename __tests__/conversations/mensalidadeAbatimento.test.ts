// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { adminProposalMessage } from '../../supabase/functions/_shared/aiAgent/adminMessages';
import { renderAdminRead } from '../../supabase/functions/_shared/aiAgent/adminReads';
import { tryMembershipAutoPay } from '../../supabase/functions/_shared/aiAgent/receiptForward';

const abatido = { offset_cents: 17100, offset_items: 'Custo agente de IA 23,00, Custo aplicativo 148,00' };

describe('João: mensalidade com despesas do clube abatidas', () => {
  it('baixa automática explica que o Pix menor quita a mensalidade cheia', async () => {
    const db = vi.fn().mockResolvedValue({ data: { applied: true, charge_type: 'membership', month: '2026-11-01', amount_cents: 22900,
      admin_conversation_id: 'c1', admin_name: 'Henrique', sender_name: 'Ítalo Cangussú', ...abatido } });
    const r = await tryMembershipAutoPay(db, 'st');
    expect(r?.messages[0]).toBe('Recebi! Sua mensalidade de 11/2026 (R$ 229,00) está registrada como paga. Com R$ 171,00 abatidos (Custo agente de IA 23,00, Custo aplicativo 148,00), a mensalidade fica quitada em R$ 400,00 e essas despesas ficam pagas. Obrigado!');
    expect(r?.forward?.text).toContain('a mensalidade fica quitada em R$ 400,00');
  });

  it('sem abatimento o texto não muda', async () => {
    const db = vi.fn().mockResolvedValue({ data: { applied: true, charge_type: 'membership', month: '2026-10-01', amount_cents: 32000, offset_cents: 0 } });
    expect((await tryMembershipAutoPay(db, 'st'))?.messages[0]).toBe('Recebi! Sua mensalidade de 10/2026 (R$ 320,00) está registrada como paga. Obrigado!');
  });

  it('ficha do sócio mostra o que é abatido todo mês', () => {
    const t = renderAdminRead('socio_ficha', { name: 'Ítalo Cangussú', role: 'admin', active: true, since: '2025-12-28', open_cents: 40000,
      offsets: [{ description: 'Custo aplicativo', amount_cents: 14800 }, { description: 'Custo agente de IA', amount_cents: 2300 }] });
    expect(t).toContain('- Abatido da mensalidade todo mês: Custo aplicativo R$ 148,00 + Custo agente de IA R$ 23,00 = R$ 171,00. O Pix dele vem com esse desconto e quita a mensalidade.');
    expect(renderAdminRead('socio_ficha', { name: 'Outro', active: true, since: '2026-01-01' })).not.toContain('Abatido');
  });

  it('proposta de aprovação pelo WhatsApp avisa o abatimento', () => {
    const t = adminProposalMessage('fin_receipt_approve', { member_name: 'Ítalo Cangussú', sent_on: '2026-11-04', amount_cents: 22900, paid_on: '2026-11-04',
      method: 'pix', account_name: 'Cora', allocations: [{ description: 'Mensalidade', due_date: '2026-11-05', amount_cents: 22900 }], ...abatido });
    expect(t).toContain('Com R$ 171,00 abatidos (Custo agente de IA 23,00, Custo aplicativo 148,00), a mensalidade fica quitada e essas despesas ficam pagas.');
  });
});
