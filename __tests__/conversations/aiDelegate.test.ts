// @vitest-environment node
// Assessor de professor: o João reconhece o assessor como o professor, mostra só os alunos dele e não entra em laço com outro robô.
import { describe, expect, it } from 'vitest';
import { delegateOverLimit, isCourtesyOnly } from '../../supabase/functions/_shared/aiAgent/delegate';
import { actingFor, financialContextText, requesterText } from '../../supabase/functions/_shared/aiAgent/prompts';
import { groupLessons, lessonDuration, lessonsProposalMessage, parseLessons } from '../../supabase/functions/_shared/aiAgent/lessonsBatch';

const professor = { id: 'P1', name: 'Diego Memória', is_admin: false, is_member: true, professor_id: 'PR1' };
const acting_for = { kind: 'professor_assistant', principal_profile_id: 'P1', principal_name: 'Diego Memória', professor_id: 'PR1' };
const students = [
  { name: 'Matheus Lima', plan_type: 'Card Mensal', card_status: 'active', valid_until: '2026-11-05', professor: 'Diego Memória' },
  { name: 'Outro Aluno', plan_type: 'Card Mensal', card_status: 'expired', valid_until: '2026-09-01', professor: 'Outro Professor' },
];
const pendencies = [{ id: 'X', member_id: 'P1', member_name: 'Diego Memória', description: 'Mensalidade', status: 'open', due_date: '2026-10-10' }];
const ctxOf = (extra: Record<string, unknown>, body: string) => ({
  is_group: false, transcript: [{ direction: 'inbound', body }],
  requester: { profile: professor, ...extra }, financial_context: { students, member_pendencies: pendencies },
});

describe('assessor do professor', () => {
  it('o requester fala como o professor e deixa claro que não é administrador', () => {
    const ctx = ctxOf({ acting_for }, 'oi');
    expect(actingFor(ctx)).toEqual(acting_for);
    const t = requesterText(ctx);
    expect(t).toContain('ASSESSOR do professor Diego Memória');
    expect(t).toContain('Professor: sim');
    expect(t).toContain('Administrador: não');
  });

  it('sem delegação o texto do requester é o de sempre', () => {
    const ctx = ctxOf({}, 'oi');
    expect(actingFor(ctx)).toBeNull();
    expect(requesterText(ctx)).not.toContain('ASSESSOR');
  });

  it('professor e assessor veem a validade dos alunos DELE, nunca dos de outro professor', () => {
    for (const extra of [{}, { acting_for }]) {
      const t = financialContextText(ctxOf(extra, 'qual o vencimento da mensalidade do Matheus?'));
      expect(t).toContain('Matheus Lima');
      expect(t).toContain('05/11/2026');
      expect(t).not.toContain('Outro Aluno');
    }
    const geral = financialContextText(ctxOf({ acting_for }, 'e o Outro Aluno, vence quando a mensalidade?'));
    expect(geral).not.toContain('Outro Aluno |');
  });

  it('sócio que não é professor continua sem ver alunos no privado', () => {
    const t = financialContextText({ ...ctxOf({}, 'vencimento do Matheus?'), requester: { profile: { ...professor, professor_id: null } } });
    expect(t).toContain('(não exposto no privado)');
    expect(t).not.toContain('Matheus Lima');
  });

  it('o assessor não vê as pendências pessoais do professor; o próprio professor vê', () => {
    expect(financialContextText(ctxOf({ acting_for }, 'pendencia'))).not.toContain('Mensalidade | OPEN');
    expect(financialContextText(ctxOf({}, 'pendencia'))).toContain('Mensalidade | OPEN');
  });
});

describe('trava entre robôs', () => {
  it('cortesia pura não merece resposta; pedido ou pergunta sim', () => {
    for (const t of ['Obrigado!', 'Perfeito, obrigado.', 'ok 👍', 'Valeu, João!', 'Combinado. Até mais!']) expect(isCourtesyOnly(t), t).toBe(true);
    for (const t of ['Obrigado! Pode marcar aula amanhã às 7h?', 'Marca aula do Matheus sexta 18h', 'Tudo bem?', '']) expect(isCourtesyOnly(t), t).toBe(false);
  });

  it('muitas respostas da IA em 10 minutos indicam laço', () => {
    const at = (min: number) => new Date(Date.UTC(2026, 9, 16, 13, min)).toISOString();
    const troca = (n: number, inicio: number) => Array.from({ length: n }, (_, i) => [
      { direction: 'inbound', origin: 'customer', created_at: at(inicio + i) },
      { direction: 'outbound', origin: 'ai', created_at: at(inicio + i) },
    ]).flat();
    expect(delegateOverLimit(troca(7, 0))).toBe(false);
    expect(delegateOverLimit(troca(8, 0))).toBe(true);
    expect(delegateOverLimit([...troca(8, 0), ...troca(1, 30)])).toBe(false);   // as antigas saíram da janela
  });
});

describe('aulas em lote: regras puras', () => {
  it('alunos no mesmo dia e horário viram uma aula só; item sem data ou início é descartado', () => {
    const l = parseLessons([
      { date: '2026-10-19', start: '19:30', end: '20:00', student_names: ['José'] },
      { date: '2026-10-19', start: '19:30', end: '20:00', student_names: ['Vinícius', 'José'] },
      { date: '19/10', start: '19:30', student_names: ['X'] },
      { date: '2026-10-20', start: '7h', student_names: ['Y'] },
    ]) ?? [];
    expect(l).toHaveLength(2);
    expect(groupLessons(l)).toEqual([{ date: '2026-10-19', start: '19:30', end: '20:00', student_names: ['José', 'Vinícius'] }]);
    expect(lessonDuration({ date: '2026-10-19', start: '19:30', end: '19:45', student_names: [] })).toBe(15);
    expect(lessonDuration({ date: '2026-10-19', start: '19:30', end: null, student_names: [] })).toBe(30);
  });

  it('o resumo diz em linguagem simples por que cada aula não entra', () => {
    const t = lessonsProposalMessage({ accepted: [{ date: '2026-10-19', start: '20:00', end: '20:30', label: 'José' }],
      rejected: [{ date: '2026-10-19', start: '19:45', label: 'Matheus', code: 'INVALID_START' }] }, [], '2026-10-16');
    expect(t).toContain('Posso marcar 1 aula');
    expect(t).toContain('Matheus: a aula começa em hora cheia ou meia hora');
    expect(t).not.toContain('INVALID_START');
  });
});
