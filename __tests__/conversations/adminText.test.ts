import { describe, expect, it } from 'vitest';
import { plural, skippedNote, slotBR, whenBR } from '../../supabase/functions/_shared/aiAgent/adminText';
import { adminProposalMessage, adminSuccessMessage } from '../../supabase/functions/_shared/aiAgent/adminMessages';

describe('textos do assessor: formato único', () => {
  it('plural por extenso, sem "(s)"', () => {
    expect(plural(1, 'pendência em aberto', 'pendências em aberto')).toBe('1 pendência em aberto');
    expect(plural(3, 'pendência em aberto', 'pendências em aberto')).toBe('3 pendências em aberto');
    expect(skippedNote(0)).toBe('');
    expect(skippedNote(1)).toBe('1 fica de fora por falta de telefone válido ou por ter pedido para não receber');
  });

  it('dia e horário sempre "dd/mm às hh:mm" e faixa "das … às …"', () => {
    expect(whenBR('2026-10-23T12:00:00Z')).toBe('23/10 às 09:00');
    expect(slotBR('2026-10-20', '19:00', '20:00')).toBe('20/10/2026, das 19:00 às 20:00');
  });

  it('"Confirma?" vem na mesma linha, ou na de baixo depois de citação ou lista', () => {
    expect(adminProposalMessage('adm_announcement_deactivate', { title: 'Chuva' })).toBe('Vou tirar do ar o aviso «Chuva». Confirma?');
    expect(adminProposalMessage('adm_message_send', { member_name: 'Beto', phone: '88999991234', body: 'oi' }))
      .toBe('Vou chamar Beto no WhatsApp (88999991234) e mandar esta mensagem:\n«oi»\nConfirma?');
    expect(adminProposalMessage('fin_pendency_send', { member_name: 'Beto', open_count: 1, member_total_due_cents: 5000 }))
      .toBe('Vou mandar agora a cobrança para Beto: 1 pendência em aberto, total R$ 50,00. Confirma?');
  });

  it('cadastro não chuta gênero e resultado de geração fala em plural certo', () => {
    expect(adminSuccessMessage('adm_dependent_create', { dependent_name: 'Ana', relationship: 'filha', member_name: 'Beto' }))
      .toBe('Pronto: cadastro de Ana feito como filha de Beto.');
    expect(adminSuccessMessage('fin_charges_generate', { result: { created: 1, existing: 2, missing_price: 1 } }))
      .toBe('Pronto: 1 cobrança nova gerada; 2 já existiam; 1 mês sem preço ficou de fora.');
  });
});
