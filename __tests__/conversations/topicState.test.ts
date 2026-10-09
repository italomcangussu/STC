// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { openTopics, restoreConversationMemory, topicForIntent, trackConversationTopic } from '../../supabase/functions/_shared/aiAgent/topicState';
import { q, world } from './sql/harness';

describe('João: sessões são técnicas, assuntos são persistentes', () => {
  it('compacta apenas tarefas concluídas, conservando tarefas abertas de outros domínios', () => {
    let memory = trackConversationTopic({}, {
      intent: 'admin_financeiro', slots: { description: 'Doação de brinquedos', amount: 30 },
      summary: 'Lançar doação de R$ 30', awaiting: true, close: false, action: 'ask',
      lastQuestion: 'Qual a categoria?',
    });
    expect(openTopics(memory)).toHaveLength(1);
    expect(openTopics(memory)[0]).toMatchObject({ status: 'awaiting_data', last_question: 'Qual a categoria?' });

    memory = trackConversationTopic(memory, {
      intent: 'reservar', mode: 'new', slots: { date: '2026-10-11', start: '16:00' },
      summary: 'Reservar quadra domingo', awaiting: true, close: false, action: 'proposed',
    });
    expect(openTopics(memory)).toHaveLength(2);
    expect(topicForIntent(memory, 'admin_financeiro', 'resume')?.slots).toMatchObject({ amount: 30 });

    memory = trackConversationTopic(memory, {
      intent: 'reservar', slots: { date: '2026-10-11', start: '16:00' },
      summary: 'Reserva confirmada', awaiting: false, close: true, action: 'confirmed',
    });
    expect(openTopics(memory)).toHaveLength(1);
    expect(openTopics(memory)[0].intent).toBe('admin_financeiro');
    expect(memory.topics?.find((t) => t.intent === 'reservar')).toMatchObject({
      status: 'completed', slots: {}, last_question: null,
    });
  });

  it('sessão nova recebe dados pendentes, mas não reabre assuntos já concluídos', () => {
    const prior = trackConversationTopic({}, {
      intent: 'admin_financeiro', slots: { amount: 30, category_name: 'Outras receitas' },
      summary: 'Doação ação das crianças', awaiting: true, close: false, action: 'ask',
      lastQuestion: 'Confirma a categoria?',
    });
    const restored = restoreConversationMemory({}, prior);
    expect(restored.intent).toBe('admin_financeiro');
    expect(restored.slots).toMatchObject({ amount: 30, category_name: 'Outras receitas' });
    expect(restored.topics?.[0].last_question).toBe('Confirma a categoria?');
    const done = trackConversationTopic(prior, {
      intent: 'admin_financeiro', slots: { amount: 30 }, summary: 'Lançamento feito',
      awaiting: false, close: false, action: 'admin_confirmed',
    });
    const empty = restoreConversationMemory({}, done);
    expect(openTopics(empty)).toHaveLength(0);
    expect(empty.slots).toBeUndefined();
  });

  it('a troca para novo assunto igual não reaproveita automaticamente os valores do assunto anterior', () => {
    const prior = trackConversationTopic({}, {
      intent: 'admin_financeiro', slots: { amount: 30, description: 'Doação crianças' },
      summary: 'Doação crianças', awaiting: true, close: false, action: 'ask',
    });
    expect(topicForIntent(prior, 'admin_financeiro', 'new')).toBeNull();
    const next = trackConversationTopic(prior, {
      intent: 'admin_financeiro', mode: 'new', slots: { amount: 10, description: 'Patrocínio' },
      summary: 'Patrocínio', awaiting: true, close: false, action: 'ask',
    });
    expect(openTopics(next)).toHaveLength(2);
    expect(openTopics(next).map((t) => t.slots.amount).sort()).toEqual([10, 30]);
  });
});

describe('proteção transacional no PostgreSQL', () => {
  it('recusa nunca pode virar autorização por classificador semântico permissivo', async () => {
    const w = await world();
    const results = await q<{ phrase: string; accepted: boolean }>(w.db, `
      SELECT phrase, conv_private.is_semantic_acceptance(phrase, false) AS accepted
      FROM (VALUES ('negativo'),('não, pode lançar'),('talvez'),('nunca'),
        ('sim'),('isso'),('exatamente'),('pode lançar'),('fechado')) t(phrase)
    `);
    const result = Object.fromEntries(results.map((r) => [r.phrase, r.accepted]));
    expect(result).toMatchObject({
      negativo: false, 'não, pode lançar': false, talvez: false, nunca: false,
      sim: true, isso: true, exatamente: true, 'pode lançar': true, fechado: true,
    });
  }, 90000);
});
