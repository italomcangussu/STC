// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { completeCurrentStep, nextActionStep, parsePlan, planClosing, planIntro } from '../../supabase/functions/_shared/aiAgent/adminPlan';

const catalog = { fin: ['receita', 'lancar'], adm: ['aviso'] };

describe('plano do assessor', () => {
  it('só ação do catálogo vira execução; ação inventada ou ausente vira passo de painel', () => {
    const plan = parsePlan({ goal: 'arrumar o mês', steps: [
      { label: 'Lançar receita', fin_action: 'receita', slots: { amount: 10 } },
      { label: 'Apagar o histórico', fin_action: 'apagar_tudo' },
      { label: 'Ajustar o banner', how: 'Configurações › Site' },
      { label: '' },
    ] }, catalog)!;
    expect(plan.steps.map((s) => [s.kind, s.intent ?? null])).toEqual([['acao', 'admin_financeiro'], ['manual', null], ['manual', null]]);
    expect(plan.steps[0].slots).toEqual({ amount: 10, fin_action: 'receita' });
    expect(plan.steps[1].how).toBe('pelo painel do clube');
  });

  it('plano vazio ou sem objetivo é ignorado', () => {
    expect(parsePlan({ goal: 'x', steps: [] }, catalog)).toBeNull();
    expect(parsePlan({ steps: [{ label: 'a', fin_action: 'receita' }] }, catalog)).toBeNull();
    expect(parsePlan('lixo', catalog)).toBeNull();
  });

  it('avança passo a passo e fecha lembrando o que fica no painel', () => {
    let plan = parsePlan({ goal: 'g', steps: [{ label: 'A', fin_action: 'lancar' }, { label: 'B', how: 'Painel X' }, { label: 'C', adm_action: 'aviso' }] }, catalog)!;
    expect(planIntro(plan)).toBe('Entendi: g. Vou fazer assim:\n1. A (faço por aqui)\n2. B (no painel: Painel X)\n3. C (faço por aqui)');
    expect(nextActionStep(plan)).toBe(0);
    plan = completeCurrentStep({ ...plan, cursor: 0 });
    expect(nextActionStep(plan)).toBe(2);
    plan = completeCurrentStep({ ...plan, cursor: 2 });
    expect(nextActionStep(plan)).toBeNull();
    expect(planClosing(plan)).toBe('O que dava para fazer por aqui está feito. Falta no painel: 2. B (Painel X).');
  });
});
