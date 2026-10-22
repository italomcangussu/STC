import { describe, expect, it } from 'vitest';
import { adminProposalMessage, adminSuccessMessage } from '../../supabase/functions/_shared/aiAgent/adminMessages';
import { parseSlots } from '../../supabase/functions/_shared/aiAgent/answerParse';

const base = { name: 'José', plan: 'Card Mensal', card_tier: 'kids', price_cents: 10000 };

describe('João: cadastrar aluno mensalista', () => {
  it('proposta com pagamento mostra o comprovante e o que sobra para outro aluno', () => {
    const s = { ...base, name: 'Matheus', card_tier: 'regular', price_cents: 20000, paid: true, amount_cents: 20000, paid_on: '2026-10-14',
      new_valid_until: '2026-11-14', receipt: { intent_id: 'r', amount_cents: 30000, remaining_cents: 30000 } };
    expect(adminProposalMessage('adm_student_create', s)).toBe('Vou cadastrar Matheus como mensalista (R$ 200,00/mês) e registrar o pagamento de R$ 200,00 em 14/10/2026, usando o comprovante de R$ 300,00 (sobram R$ 100,00 para outro aluno). Card válido até 14/11/2026. Confirma?');
  });
  it('Mensalista Kids sem pagamento fica inativo até pagar', () => {
    expect(adminProposalMessage('adm_student_create', base)).toBe('Vou cadastrar José como Mensalista Kids (R$ 100,00/mês). O Card fica inativo até o pagamento. Confirma?');
    expect(adminSuccessMessage('adm_student_create', base)).toBe('Pronto: cadastro de José feito como Mensalista Kids.');
  });
  it('o parser aceita os campos do aluno novo', () => {
    const slots = parseSlots({ adm_action: 'aluno_criar', student_name: 'José', student_plan: 'kids', paid: true, amount: 100 });
    expect(slots).toMatchObject({ adm_action: 'aluno_criar', student_name: 'José', student_plan: 'kids', paid: true });
  });
});
