/**
 * Plano do assessor para pedidos que o João nunca fez como uma ação só, mas que o clube faz pelas funções que já
 * existem. O modelo decompõe o pedido; aqui o plano é validado contra o catálogo: passo com ação conhecida vira
 * execução pelo mesmo caminho de sempre (proposta + aceite natural + banco); o resto vira roteiro de painel.
 * Nada aqui executa: só descreve e escolhe o próximo passo.
 */
export type PlanStep = {
  label: string;
  kind: 'acao' | 'manual';
  intent?: 'admin_financeiro' | 'admin_acao';
  /** Dados do passo, no formato dos slots do turno (fin_action ou adm_action incluído). */
  slots?: Record<string, unknown>;
  /** Passo manual: onde e como fazer no painel. */
  how?: string | null;
  status: 'pendente' | 'feito';
};

export type AdminPlan = { goal: string; steps: PlanStep[]; cursor: number | null };

const MAX_STEPS = 8;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Valida o plano do modelo. Ação fora do catálogo nunca vira execução: vira passo manual. */
export function parsePlan(raw: unknown, catalog: { fin: readonly string[]; adm: readonly string[] }): AdminPlan | null {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const goal = text(o?.goal, 200)?.replace(/[.\s]+$/, '') ?? null;
  if (!o || !goal || !Array.isArray(o.steps)) return null;
  const steps = o.steps.slice(0, MAX_STEPS).map((s): PlanStep | null => {
    const r = s && typeof s === 'object' ? s as Record<string, unknown> : {};
    const label = text(r.label, 160);
    if (!label) return null;
    const slots = r.slots && typeof r.slots === 'object' && !Array.isArray(r.slots) ? { ...r.slots as Record<string, unknown> } : {};
    if (typeof r.fin_action === 'string' && catalog.fin.includes(r.fin_action)) {
      return { label, kind: 'acao', intent: 'admin_financeiro', slots: { ...slots, fin_action: r.fin_action }, status: 'pendente' };
    }
    if (typeof r.adm_action === 'string' && catalog.adm.includes(r.adm_action)) {
      return { label, kind: 'acao', intent: 'admin_acao', slots: { ...slots, adm_action: r.adm_action }, status: 'pendente' };
    }
    return { label, kind: 'manual', how: text(r.how, 240) ?? 'pelo painel do clube', status: 'pendente' };
  }).filter((s): s is PlanStep => s !== null);
  return steps.length ? { goal, steps, cursor: null } : null;
}

/** Próximo passo que o João executa (índice), ou null se só restam passos de painel. */
export function nextActionStep(plan: AdminPlan): number | null {
  const i = plan.steps.findIndex((s) => s.kind === 'acao' && s.status === 'pendente');
  return i >= 0 ? i : null;
}

/** Marca o passo em andamento como feito. */
export function completeCurrentStep(plan: AdminPlan): AdminPlan {
  if (plan.cursor === null) return plan;
  return { ...plan, cursor: null, steps: plan.steps.map((s, i) => (i === plan.cursor ? { ...s, status: 'feito' as const } : s)) };
}

export function planIntro(plan: AdminPlan): string {
  const lines = plan.steps.map((s, i) => `${i + 1}. ${s.label}${s.kind === 'acao' ? ' (faço por aqui)' : ` (no painel: ${s.how})`}`);
  return `Entendi: ${plan.goal}. Vou fazer assim:\n${lines.join('\n')}`;
}

export function stepHeading(plan: AdminPlan, index: number): string {
  return `Passo ${index + 1}: ${plan.steps[index].label}.`;
}

/** Fechamento: o que ficou para o painel, se algo ficou. */
export function planClosing(plan: AdminPlan): string {
  const manual = plan.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'manual');
  if (!manual.length) return 'Plano concluído.';
  return `O que dava para fazer por aqui está feito. Falta no painel: ${manual.map(({ s, i }) => `${i + 1}. ${s.label} (${s.how})`).join('; ')}.`;
}
