import { describe, expect, it, vi } from 'vitest';
import { adminProposalMessage } from '../../supabase/functions/_shared/aiAgent/adminMessages';
import { parseSlots } from '../../supabase/functions/_shared/aiAgent/answerParse';
import { tryMembershipAutoPay } from '../../supabase/functions/_shared/aiAgent/receiptForward';
import { receiptReceivedMessage } from '../../supabase/functions/_shared/aiAgent/studentCard';

const despesa = { entry_kind: 'expense', description: 'Material hidráulico', amount_cents: 30500, category_name: 'Manutenção predial',
  account_name: 'Cora', entry_status: 'paid', paid_on: '2026-10-10' };

describe('João: categoria do lançamento', () => {
  it('diz quando a categoria é sugestão dele e que dá para trocar', () => {
    expect(adminProposalMessage('fin_entry_create', { ...despesa, category_how: 'historico' }))
      .toContain('categoria Manutenção predial (sugestão minha, é a que usamos em lançamentos parecidos; se for outra, é só dizer)');
    expect(adminProposalMessage('fin_entry_create', { ...despesa, category_how: 'palavra' })).toContain('(sugestão minha pela descrição;');
  });
  it('categoria dita pelo administrador sai sem comentário', () => {
    expect(adminProposalMessage('fin_entry_create', { ...despesa, category_how: 'nome' })).toContain('categoria Manutenção predial, conta Cora');
  });
  it('categoria nova mostra o grupo onde nasce', () => {
    expect(adminProposalMessage('fin_entry_create', { ...despesa, category_name: 'Hidráulica', category_new: true, category_parent_name: 'Estrutura' }))
      .toContain('categoria Hidráulica (nova, no grupo Estrutura)');
  });
  it('o modelo pode pedir categoria nova e o 1º mês proporcional', () => {
    expect(parseSlots({ category_new: true, first_amount: '200' })).toEqual({ category_new: true, first_amount: 200 });
    expect(parseSlots({ category_new: 'sim', first_amount: 0 })).toEqual({ category_new: false, first_amount: null });
  });
});

describe('João: sócio novo com 1º mês proporcional', () => {
  const socio = { name: 'Ronaldo Rezende', phone: '88999837196', amount_cents: 40000, month: '2026-10-01', paid_on: '2026-10-21',
    account_name: 'Cora', amount_read: true };
  it('mostra o valor pago agora e a mensalidade cheia do mês seguinte', () => {
    const t = adminProposalMessage('fin_member_create', { ...socio, first_amount_cents: 20000 });
    expect(t).toContain('com mensalidade de R$ 400,00');
    expect(t).toContain('com o comprovante que você mandou (R$ 200,00, pago em 21/10/2026, conta Cora)');
    expect(t).toContain('10/2026 é proporcional (R$ 200,00; o resto vira desconto) e a partir do mês que vem a cobrança é de R$ 400,00.');
  });
  it('sem proporcional, a mensagem é a de sempre', () => {
    expect(adminProposalMessage('fin_member_create', socio)).not.toMatch(/proporcional/);
  });
});

describe('João: comprovante que se resolve sozinho', () => {
  it('pendência paga com o valor devido: o sócio e o financeiro ficam sabendo', async () => {
    const db = vi.fn().mockResolvedValue({ data: { applied: true, charge_type: 'member_pendency', description: 'Day Card de convidado do dia 14/10',
      amount_cents: 5000, admin_conversation_id: 'conv-h', admin_name: 'Henrique', sender_name: 'Lucas Rodrigues' } });
    const r = await tryMembershipAutoPay(db, 'st');
    expect(r?.messages[0]).toBe('Recebi! Sua pendência "Day Card de convidado do dia 14/10" (R$ 50,00) está registrada como paga. Obrigado!');
    expect(r?.forward?.text).toContain('a pendência "Day Card de convidado do dia 14/10" de Lucas Rodrigues (R$ 50,00)');
  });
  it('mensalidade continua com o texto do mês', async () => {
    const db = vi.fn().mockResolvedValue({ data: { applied: true, charge_type: 'membership', month: '2026-10-01', amount_cents: 32000 } });
    expect((await tryMembershipAutoPay(db, 'st'))?.messages[0]).toBe('Recebi! Sua mensalidade de 10/2026 (R$ 320,00) está registrada como paga. Obrigado!');
  });
  it('comprovante de despesa já lançada: avisa que anexou', () => {
    const t = receiptReceivedMessage({ found: true, status: 'staged', ocr_status: 'ok', amount_cents: 40000, paid_on: '2026-10-18',
      payee: 'JOSE WELINGTON BENTO', payee_ok: false, attached_entry: { description: 'Limpeza do espaço ao redor da quadra', paid_on: '2026-10-18' } });
    expect(t).toBe('Recebi o comprovante (R$ 400,00, de 18/10/2026, para JOSE WELINGTON BENTO) e anexei à despesa "Limpeza do espaço ao redor da quadra" de 18/10/2026, que estava sem comprovante. Se era de outra coisa, me avisa.');
  });
});
