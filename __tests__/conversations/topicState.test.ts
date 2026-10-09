// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  activeTopic, bringsNewData, openTopics, recordTopicTurn, restoreTopics, selectTopic, topicIdFromRef, topicsPromptText,
  type TopicMemory, type TopicTurn,
} from '../../supabase/functions/_shared/aiAgent/topicState';

let seq = 0;
const ids = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
let clock = Date.parse('2026-10-08T21:00:00Z');
const tick = () => new Date((clock += 60_000)).toISOString();

/** Um turno: escolhe o assunto como o turn.ts faz e registra o resultado. */
function turn(memory: TopicMemory, t: Omit<TopicTurn, 'topic' | 'now' | 'newId'> & { mode?: 'continue' | 'new' | 'resume'; ref?: string }) {
  const topic = selectTopic(memory, t.intent, t.mode, topicIdFromRef(memory, t.ref));
  return recordTopicTurn(memory, { ...t, topic, slots: { ...(topic?.slots ?? {}), ...t.slots }, now: tick(), newId: ids });
}

const doacao = { fin_action: 'receita', description: 'Doação para presentes, pipoca e picolés das crianças', amount: 30 };

describe('assunto: ciclo de vida e compactação', () => {
  it('concluir uma tarefa compacta só ela (fatos + resultado) e devolve o foco à pendente', () => {
    let m = turn({}, { intent: 'admin_financeiro', slots: doacao, summary: 'Doação de R$ 30', awaiting: true, close: false, action: 'ask', lastQuestion: 'Em qual categoria?' });
    m = turn(m, { intent: 'reservar', mode: 'new', slots: { date: '2026-10-11', start: '16:00' }, summary: 'Quadra domingo 16h', awaiting: true, close: false, action: 'proposed' });
    expect(openTopics(m).map((t) => [t.intent, t.status])).toEqual([['admin_financeiro', 'suspended'], ['reservar', 'awaiting_confirmation']]);

    m = turn(m, { intent: 'reservar', slots: {}, summary: 'Reserva confirmada', awaiting: false, close: true, action: 'confirmed' });
    const reserva = m.topics!.find((t) => t.intent === 'reservar')!;
    expect(reserva).toMatchObject({ status: 'completed', outcome: 'confirmed', slots: { date: '2026-10-11', start: '16:00' }, last_question: null });
    expect(reserva.decisions).toContain('concluído pelo sistema (confirmed)');
    expect(activeTopic(m)).toMatchObject({ intent: 'admin_financeiro', slots: doacao, last_question: 'Em qual categoria?' });
    expect(m.slots).toEqual(doacao);
  });

  it('cancelar uma das tarefas não toca na outra; nada cancelado volta a ser pendente', () => {
    let m = turn({}, { intent: 'admin_financeiro', slots: doacao, awaiting: true, close: false, action: 'ask' });
    m = turn(m, { intent: 'admin_financeiro', mode: 'new', slots: { fin_action: 'receita', description: 'Patrocínio', amount: 500 }, awaiting: true, close: false, action: 'ask' });
    m = turn(m, { intent: 'admin_financeiro', ref: 't1', mode: 'resume', slots: {}, awaiting: false, close: true, declined: true, action: null });
    expect(openTopics(m).map((t) => t.slots.amount)).toEqual([500]);
    expect(m.topics!.find((t) => t.slots.amount === 30)).toMatchObject({ status: 'canceled', close_reason: 'a pessoa desistiu', outcome: 'canceled' });
  });

  it('duas receitas do mesmo administrador não se misturam; "resume" volta à certa sem pedir os dados de novo', () => {
    let m = turn({}, { intent: 'admin_financeiro', slots: doacao, awaiting: true, close: false, action: 'ask', lastQuestion: 'Categoria?' });
    m = turn(m, { intent: 'admin_financeiro', mode: 'new', slots: { fin_action: 'receita', description: 'Patrocínio', amount: 500 }, awaiting: true, close: false, action: 'ask' });
    expect(activeTopic(m)!.slots.amount).toBe(500);
    const volta = selectTopic(m, 'admin_financeiro', 'resume');
    expect(volta!.slots).toEqual(doacao);
    expect(selectTopic(m, 'admin_financeiro', 'resume', topicIdFromRef(m, 't2'))!.slots.amount).toBe(500);
  });

  it('correção de valor fica registrada como decisão; a nova proposta substitui a de outro assunto', () => {
    let m = turn({}, { intent: 'admin_financeiro', slots: doacao, awaiting: true, close: false, action: 'proposed_admin' });
    m = turn(m, { intent: 'admin_financeiro', slots: { amount: 35 }, awaiting: true, close: false, action: 'proposed_admin' });
    expect(activeTopic(m)!.decisions).toEqual(['proposta apresentada', 'corrigiu amount: 30 → 35']);
    m = turn(m, { intent: 'admin_acao', slots: { adm_action: 'aviso' }, awaiting: true, close: false, action: 'proposed_admin' });
    expect(openTopics(m).map((t) => [t.intent, t.status, t.next_step])).toEqual([
      ['admin_financeiro', 'suspended', 'reapresentar a proposta e pedir nova confirmação'],
      ['admin_acao', 'awaiting_confirmation', 'aguardando a confirmação da proposta'],
    ]);
  });

  it('reserva → "quem está nesse jogo?" (entrar) continua o mesmo assunto; reserva → cancelar é outro', () => {
    let m = turn({}, { intent: 'reservar', slots: { date: '2026-10-11', start: '18:00' }, awaiting: true, close: false, action: 'ask' });
    expect(selectTopic(m, 'entrar')?.id).toBe(activeTopic(m)!.id);
    expect(selectTopic(m, 'cancelar')).toBeNull();
    m = turn(m, { intent: 'admin_financeiro', slots: doacao, awaiting: true, close: false, action: 'ask' });
    expect(selectTopic(m, 'reservar')?.slots).toMatchObject({ start: '18:00' });
  });

  it('resposta curta só "traz dado" quando muda algo do assunto (duração do modelo não conta)', () => {
    expect(bringsNewData({ category_name: 'Outras receitas' }, doacao)).toBe(true);
    expect(bringsNewData({ amount: 30, duration: 60, participant_names: [] }, doacao)).toBe(false);
  });
});

describe('assunto: entre sessões técnicas', () => {
  const pendente = () => turn({}, { intent: 'admin_financeiro', slots: { ...doacao, category_name: 'Outras receitas' }, summary: 'Doação crianças', awaiting: true, close: false, action: 'proposed_admin', lastQuestion: 'Confirma?' });

  it('sessão nova recebe o assunto do banco com todos os dados, mas sem a autorização da proposta antiga', () => {
    const antes = pendente();
    const durable = antes.topics!.map((t) => ({ ...t, proposal_id: 'proposta-velha' }));
    const m = restoreTopics({} as TopicMemory, { durable, openProposalId: null, today: '2026-10-12' });
    expect(m.intent).toBe('admin_financeiro');
    expect(m.slots).toMatchObject({ amount: 30, category_name: 'Outras receitas' });
    expect(activeTopic(m)).toMatchObject({ status: 'suspended', proposal_id: null, next_step: 'reapresentar a proposta e pedir nova confirmação' });
  });

  it('na mesma sessão, com a proposta dele aberta, continua aguardando confirmação', () => {
    const antes = pendente();
    const durable = antes.topics!.map((t) => ({ ...t, proposal_id: 'p1' }));
    expect(activeTopic(restoreTopics(antes, { durable, openProposalId: 'p1', today: '2026-10-08' }))!.status).toBe('awaiting_confirmation');
    expect(activeTopic(restoreTopics(antes, { durable, openProposalId: 'p2', today: '2026-10-08' }))!.status).toBe('suspended');
  });

  it('o mais novo vence por assunto; encerrado na sessão não é reaberto por cópia velha do banco', () => {
    const antes = pendente();
    const t = antes.topics![0];
    const fechado = { ...t, status: 'completed' as const, slots: {}, updated_at: '2026-10-08T23:00:00Z' };
    const m = restoreTopics({ ...antes, topics: [fechado] }, { durable: [{ ...t, updated_at: '2026-10-08T23:30:00Z' }], today: '2026-10-08' });
    expect(openTopics(m)).toHaveLength(0);
  });

  it('pedido de quadra com data passada é arquivado (regra explícita); pendência financeira antiga continua', () => {
    const quadra = turn({}, { intent: 'reservar', slots: { date: '2026-10-01', start: '18:00' }, awaiting: true, close: false, action: 'ask' });
    const fin = pendente();
    const m = restoreTopics({} as TopicMemory, { durable: [...quadra.topics!, ...fin.topics!], today: '2026-10-20' });
    expect(openTopics(m).map((t) => t.intent)).toEqual(['admin_financeiro']);
    expect(m.topics!.find((t) => t.intent === 'reservar')).toMatchObject({ status: 'archived', close_reason: 'a data do pedido já passou' });
  });
});

describe('assunto: conversas longas', () => {
  it.each([12, 30, 50, 100])('%i turnos de conversa no meio não descartam a tarefa aberta nem seus dados', (turnos) => {
    let m = turn({}, { intent: 'admin_financeiro', slots: doacao, summary: 'Doação crianças', awaiting: true, close: false, action: 'ask', lastQuestion: 'A categoria é Outras receitas?' });
    const id = activeTopic(m)!.id;
    for (let i = 0; i < turnos; i++) {
      // Consultas, conversa e reservas concluídas no meio.
      m = recordTopicTurn(m, { topic: null, intent: i % 3 ? 'consultar' : 'outro', slots: {}, awaiting: false, close: false, now: tick() });
      if (i % 10 === 0) {
        m = turn(m, { intent: 'reservar', mode: 'new', slots: { date: '2026-10-20', start: '07:00' }, awaiting: true, close: false, action: 'proposed' });
        m = turn(m, { intent: 'reservar', slots: {}, awaiting: false, close: true, action: 'confirmed' });
      }
    }
    expect(m.topics!.length).toBeLessThanOrEqual(7);
    const volta = selectTopic(m, 'admin_financeiro', 'resume');
    expect(volta).toMatchObject({ id, slots: doacao, last_question: 'A categoria é Outras receitas?' });
    expect(topicsPromptText(m)).toContain('"amount":30');
  });

  it('o prompt mostra pendências completas com referência e encerrados em uma linha', () => {
    let m = turn({}, { intent: 'admin_financeiro', slots: doacao, summary: 'Doação crianças', awaiting: true, close: false, action: 'ask', lastQuestion: 'Categoria?' });
    m = turn(m, { intent: 'reservar', mode: 'new', slots: { date: '2026-10-11' }, summary: 'Quadra domingo', awaiting: false, close: true, action: 'confirmed' });
    const text = topicsPromptText(m, [{ id: 'x', intent: 'admin_acao', status: 'completed', summary: 'Aviso enviado' }]);
    expect(text).toMatch(/- t1 \(ATIVO\) \[admin_financeiro · suspenso\] Doação crianças\n {2}dados: .*"amount":30.*\n {2}sua última pergunta: "Categoria\?"/);
    expect(text).toContain('[reservar · concluído] Quadra domingo');
    expect(text).toContain('[admin_acao · concluído] Aviso enviado');
  });
});
