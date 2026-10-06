import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIENCES, FINANCE_STAGES, PROBLEM_LABEL, REASON_LABEL, TEMPLATES, TRIGGERS_BY_SOURCE, VARS_BY_SOURCE,
  describeProblem, describeReason, describeSchedule, draftProblems, renderExample, templateVars, unknownVars, EXAMPLE_VALUES,
  type AutomationDraft,
} from '@/lib/conversations/automationModel';
import { SOURCE_LABEL } from '@/lib/conversations/automationModel';
import type { AutomationSource } from '@/lib/conversations/api';

const SQL = readFileSync(resolve(__dirname, '../../../supabase/migrations/20261007100300_conversations_automations.sql'), 'utf8');

/** Corpo de `conv_private.automation_vars` no SQL → mapa origem → variáveis. */
function sqlVars(): Record<string, string[]> {
  const body = SQL.slice(SQL.indexOf('create function conv_private.automation_vars'), SQL.indexOf('create function conv_private.template_vars'));
  const out: Record<string, string[]> = {};
  for (const m of body.matchAll(/when '([a-z_]+)' then array\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
  return out;
}

describe('modelo de automações × migration', () => {
  it('as variáveis permitidas por origem são as mesmas do banco', () => {
    const banco = sqlVars();
    expect(Object.keys(banco).sort()).toEqual(Object.keys(VARS_BY_SOURCE).sort());
    for (const [origem, vars] of Object.entries(banco)) expect([...VARS_BY_SOURCE[origem as AutomationSource]].sort()).toEqual([...vars].sort());
  });

  it('as combinações origem × disparo são as da constraint conv_automation_combo', () => {
    const c = SQL.slice(SQL.indexOf('constraint conv_automation_combo'), SQL.indexOf('create table public.conv_automation_versions'));
    const combos = [...c.matchAll(/source in \(([^)]*)\) and trigger_type (?:in \(([^)]*)\)|= '([a-z]+)')/g)];
    expect(combos.length).toBe(3);
    const banco: Record<string, string[]> = {};
    for (const m of combos) {
      const origens = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
      const gatilhos = m[2] ? [...m[2].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : [m[3]];
      for (const o of origens) banco[o] = gatilhos;
    }
    for (const origem of Object.keys(SOURCE_LABEL) as AutomationSource[]) expect([...TRIGGERS_BY_SOURCE[origem]].sort()).toEqual([...banco[origem]].sort());
  });

  it('todo código de pendência emitido por automation_problems tem frase', () => {
    const fn = SQL.slice(SQL.indexOf('create function conv_private.automation_problems'), SQL.indexOf('create function conv_private.automation_materialize') > 0 ? undefined : undefined);
    const bloco = fn.slice(0, fn.indexOf('return v_p;'));
    const codigos = new Set([...bloco.matchAll(/array_append\(v_p, '([A-Z_]+)'::text\)/g)].map((m) => m[1]));
    expect(codigos.size).toBeGreaterThan(5);
    for (const c of codigos) expect(PROBLEM_LABEL[c], c).toBeTruthy();
  });

  it('todo motivo de exclusão devolvido pelos públicos tem frase', () => {
    const publicos = SQL.slice(SQL.indexOf('create function conv_private.aud_finance'), SQL.indexOf('create function conv_private.automation_problems'));
    const motivos = new Set([...publicos.matchAll(/'([A-Z][A-Z_]{4,})'/g)].map((m) => m[1]));
    expect(motivos.size).toBeGreaterThan(8);
    for (const m of motivos) expect(REASON_LABEL[m], m).toBeTruthy();
  });

  it('os públicos e estágios do construtor são os que o banco aceita', () => {
    for (const a of AUDIENCES) expect(SQL).toContain(`'${a.id}'`);
    for (const s of FINANCE_STAGES) expect(SQL).toContain(`'${s.id}'`);
  });
});

describe('modelos prontos', () => {
  it('cada modelo usa só variáveis da sua origem e uma combinação válida', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const t of TEMPLATES) {
      expect(unknownVars(t.draft.source, t.draft.message_body), t.id).toEqual([]);
      expect(TRIGGERS_BY_SOURCE[t.draft.source], t.id).toContain(t.draft.trigger_type);
      expect(t.draft.message_body.length, t.id).toBeLessThanOrEqual(1000);
    }
  });

  it('modelos prontos já saem completos, salvo quando pedem escolher o campeonato', () => {
    for (const t of TEMPLATES) {
      const pend = draftProblems(t.draft);
      if (t.draft.source === 'championship_notice') expect(pend).toEqual(['Escolha o campeonato.']);
      else expect(pend, t.id).toEqual([]);
    }
  });

  it('cobre mensalidade (início, vencimento, atraso), Card Mensal e campeonato (aviso, resultado, avanço)', () => {
    const origens = new Set(TEMPLATES.map((t) => t.draft.source));
    for (const o of ['finance_charge', 'card_mensal', 'championship_notice', 'championship_result', 'championship_advance', 'audience'] as const) expect(origens.has(o)).toBe(true);
    expect(TEMPLATES.filter((t) => t.draft.source === 'finance_charge').map((t) => t.draft.definition.stage).sort()).toEqual(['before_due', 'overdue', 'period_start']);
  });

  it('nenhum modelo promete encargos (só existem com a política confirmada)', () => {
    for (const t of TEMPLATES) expect(t.draft.message_body).not.toContain('{{encargos}}');
  });
});

describe('draftProblems', () => {
  const base = (): AutomationDraft => ({ ...TEMPLATES[0].draft, definition: { ...TEMPLATES[0].draft.definition }, schedule: { ...TEMPLATES[0].draft.schedule } });

  it('nome curto, mensagem vazia e variável inexistente', () => {
    expect(draftProblems({ ...base(), name: 'ab' })).toContain('Dê um nome com pelo menos 3 letras.');
    expect(draftProblems({ ...base(), message_body: '  ' })).toContain('Escreva a mensagem.');
    expect(draftProblems({ ...base(), message_body: 'Oi {{nome}} {{placar}}' })).toContain('A variável {{placar}} não existe para este tipo de automação.');
  });

  it('agendada exige horário e dias (ou datas)', () => {
    expect(draftProblems({ ...base(), schedule: { weekdays: [1] } })).toContain('Informe o horário de envio (HH:MM).');
    expect(draftProblems({ ...base(), schedule: { time: '25:00', weekdays: [1] } })).toContain('Informe o horário de envio (HH:MM).');
    expect(draftProblems({ ...base(), schedule: { time: '09:00' } })).toContain('Escolha os dias da semana ou datas específicas.');
    expect(draftProblems({ ...base(), schedule: { time: '09:00', dates: ['2026-10-20'] } })).toEqual([]);
  });

  it('manual e evento não pedem horário', () => {
    const manual = TEMPLATES.find((t) => t.id === 'aviso-publico')!.draft;
    expect(draftProblems(manual)).toEqual([]);
    const evento = TEMPLATES.find((t) => t.id === 'campeonato-resultado')!.draft;
    expect(draftProblems(evento)).toEqual([]);
  });

  it('origem × disparo inválidos são recusados', () => {
    expect(draftProblems({ ...base(), source: 'championship_result' })).toContain('Esta origem não aceita este tipo de disparo.');
  });

  it('aviso a participantes exige o campeonato', () => {
    const d: AutomationDraft = { ...TEMPLATES.find((t) => t.id === 'aviso-publico')!.draft, definition: { audience: 'championship_participants' } };
    expect(draftProblems(d)).toContain('Escolha o campeonato.');
    expect(draftProblems({ ...d, definition: { audience: 'championship_participants', championship_id: 'x' } })).toEqual([]);
  });
});

describe('textos', () => {
  it('describeProblem traduz códigos do banco e variável indisponível', () => {
    expect(describeProblem('MENSAGEM_VAZIA')).toBe('Escreva a mensagem.');
    expect(describeProblem('VARIAVEL_INDISPONIVEL:placar')).toContain('{{placar}}');
    expect(describeProblem('QUALQUER_COISA')).toBe('Há uma pendência na configuração.');
  });

  it('describeReason devolve o código quando não conhece (nunca esconde)', () => {
    expect(describeReason('OPT_OUT')).toBe('Pediu para não receber');
    expect(describeReason('NOVO_CODIGO')).toBe('NOVO_CODIGO');
    expect(describeReason(null)).toBe('');
  });

  it('describeSchedule', () => {
    expect(describeSchedule({ trigger_type: 'manual', schedule: {} })).toBe('Só quando você disparar');
    expect(describeSchedule({ trigger_type: 'scheduled', schedule: { time: '09:00', weekdays: [1, 3] } })).toBe('seg, qua às 09:00');
    expect(describeSchedule({ trigger_type: 'scheduled', schedule: { time: '09:00', dates: ['2026-10-20'] } })).toBe('Em 20/10 às 09:00');
    expect(describeSchedule({ trigger_type: 'scheduled', schedule: { time: '09:00', weekdays: [1], end_date: '2026-12-31' } })).toBe('seg às 09:00 · até 31/12/2026');
  });

  it('templateVars e renderExample só trocam variáveis conhecidas', () => {
    expect(templateVars('Oi {{nome}}, {{ valor }} e {{nome}}')).toEqual(['nome', 'valor']);
    expect(renderExample('Oi {{nome}} {{outra}}', EXAMPLE_VALUES)).toBe('Oi Maria {{outra}}');
  });
});
