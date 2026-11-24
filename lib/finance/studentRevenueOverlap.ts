/**
 * Card de aluno registrado em cima de uma receita solta do mesmo dinheiro.
 *
 * O caixa e a DRE somam os pagamentos de aluno (`student_payments`) e as receitas
 * (`fin_entries`). Quando o mesmo Pix entra como receita ("Mensalidades de Matheus e José")
 * e depois como Card pelo painel, o caixa fica com o valor em dobro (caso de 16/11 e 23/11).
 * Esta regra aponta as receitas que podem ser o mesmo dinheiro, para o painel perguntar.
 */
import { normalizeSearch } from '../searchText';
import { addDays, type IsoDate } from './dates';

/** Janela de busca: receitas dos últimos 45 dias antes do Card ou de hoje. */
export const OVERLAP_WINDOW_DAYS = 45;

/** Categorias de receita que só existem para aluno: "Aluno do Diego", "Aula mensal", "Card Mensal (alunos)"… */
const STUDENT_CATEGORY = /^aluno d[oa]\b|\baula (mensal|avulsa)\b|\bcard mensal\b/;

export interface RevenueCandidate {
  id: string;
  description: string;
  amountCents: number;
  /** Dia do dinheiro (recebimento) ou, sem ele, o vencimento. */
  date: IsoDate;
  categoryName: string | null;
  canceled: boolean;
}

export interface OverlapQuery {
  studentName: string;
  /** Data do pagamento do Card que está sendo registrado. */
  paymentDate: IsoDate;
  today: IsoDate;
}

/** Primeiro nome do aluno, sem o que vem depois de "/" ou "(" ("José/Irmão do Matheus" → "jose"). */
function firstName(studentName: string): string {
  const [first = ''] = normalizeSearch(studentName.split(/[/(]/)[0]).split(' ');
  return first.length >= 3 ? first : '';
}

function mentionsName(description: string, name: string): boolean {
  if (!name) return false;
  return normalizeSearch(description).split(/[^a-z0-9]+/).includes(name);
}

const isStudentCategory = (categoryName: string | null) => STUDENT_CATEGORY.test(normalizeSearch(categoryName));

/** Receitas ativas na janela que citam o aluno ou são de categoria de aluno; as que citam o nome vêm primeiro. */
export function findOverlappingStudentRevenue(query: OverlapQuery, revenues: RevenueCandidate[]): RevenueCandidate[] {
  const name = firstName(query.studentName);
  const earliest = query.paymentDate < query.today ? query.paymentDate : query.today;
  const from = addDays(earliest, -OVERLAP_WINDOW_DAYS);

  return revenues
    .filter((r) => !r.canceled && r.date >= from && r.date <= query.today)
    .map((r) => ({ revenue: r, byName: mentionsName(r.description, name) }))
    .filter(({ revenue, byName }) => byName || isStudentCategory(revenue.categoryName))
    .sort((a, b) => Number(b.byName) - Number(a.byName) || b.revenue.date.localeCompare(a.revenue.date))
    .map(({ revenue }) => revenue);
}
