import { describe, expect, it } from 'vitest';
import { findOverlappingStudentRevenue, type RevenueCandidate } from '../../lib/finance/studentRevenueOverlap';

const base: RevenueCandidate = {
  id: 'r1', description: 'Mensalidades de Matheus e José', amountCents: 30000,
  date: '2026-11-16', categoryName: 'Aluno do Diego', canceled: false,
};

describe('findOverlappingStudentRevenue', () => {
  it('acha a receita solta com o nome do aluno, mesmo depois da data do Card', () => {
    const found = findOverlappingStudentRevenue({ studentName: 'Matheus', paymentDate: '2026-11-09', today: '2026-11-23' }, [base]);
    expect(found.map((r) => r.id)).toEqual(['r1']);
  });

  it('casa o primeiro nome sem acento e ignora o que vem depois da barra', () => {
    const found = findOverlappingStudentRevenue(
      { studentName: 'José/Irmão do Matheus', paymentDate: '2026-11-09', today: '2026-11-23' },
      [{ ...base, description: 'Pix do JOSE' , categoryName: 'Outras receitas' }],
    );
    expect(found).toHaveLength(1);
  });

  it('acha receita de categoria de aluno mesmo sem o nome', () => {
    const found = findOverlappingStudentRevenue({ studentName: 'Iago Ribeiro', paymentDate: '2026-11-20', today: '2026-11-20' },
      [{ ...base, description: 'Aula do mês', categoryName: 'Aula mensal' }]);
    expect(found).toHaveLength(1);
  });

  it('não avisa receita cancelada, de fora da janela de 45 dias ou de outro assunto', () => {
    const found = findOverlappingStudentRevenue({ studentName: 'Matheus', paymentDate: '2026-11-09', today: '2026-11-23' }, [
      { ...base, id: 'cancelada', canceled: true },
      { ...base, id: 'antiga', date: '2026-09-20' },
      { ...base, id: 'outra', description: 'Patrocínio da loja', categoryName: 'Cota de patrocínio' },
      { ...base, id: 'parte-do-nome', description: 'Matheusinho Day Card', categoryName: 'Day Card' },
    ]);
    expect(found).toEqual([]);
  });

  it('põe primeiro quem tem o nome do aluno e depois a mais recente', () => {
    const found = findOverlappingStudentRevenue({ studentName: 'Matheus', paymentDate: '2026-11-09', today: '2026-11-23' }, [
      { ...base, id: 'categoria', description: 'Aula', date: '2026-11-20' },
      { ...base, id: 'nome-antiga', date: '2026-11-01' },
      { ...base, id: 'nome-nova', date: '2026-11-16' },
    ]);
    expect(found.map((r) => r.id)).toEqual(['nome-nova', 'nome-antiga', 'categoria']);
  });
});
