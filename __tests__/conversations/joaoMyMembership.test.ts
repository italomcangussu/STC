// @vitest-environment node
// Caso Bruno (04/11): "Qual o pix da mensalidade?" → "Valor?" e o João respondeu "Ainda não registrei nada".
// O prompt agora traz a mensalidade de quem fala (só no privado), com o valor a pagar.
import { describe, expect, it } from 'vitest';
import { financialContextText } from '../../supabase/functions/_shared/aiAgent/prompts';
import { myMembershipText } from '../../supabase/functions/_shared/aiAgent/promptAdmin';

const aberta = { competence_month: '2026-11-01', due_date: '2026-11-10', status: 'open', total_due_cents: 32000, offset_cents: 0, to_pay_cents: 32000 };

describe('mensalidade de quem fala no prompt do João', () => {
  it('privado: mostra a mensalidade em aberto com valor e vencimento', () => {
    const t = financialContextText({ my_membership: [aberta] });
    expect(t).toContain('MENSALIDADE DE QUEM FALA');
    expect(t).toMatch(/11\/2026: EM ABERTO \| vence 10\/11\/2026 \| valor a pagar R\$\s?320,00/);
  });

  it('com abatimento: diz o valor já abatido', () => {
    const t = myMembershipText({ my_membership: [{ ...aberta, offset_cents: 5000, to_pay_cents: 27000 }] });
    expect(t).toMatch(/R\$\s?270,00 \(já com o abatimento de R\$\s?50,00\)/);
  });

  it('paga: diz que está paga', () => {
    expect(myMembershipText({ my_membership: [{ ...aberta, status: 'paid', to_pay_cents: 0 }] })).toContain('11/2026: PAGA');
  });

  it('grupo ou sem dados: nada', () => {
    expect(myMembershipText({ is_group: true, my_membership: [aberta] })).toBe('');
    expect(myMembershipText({})).toBe('');
  });
});
