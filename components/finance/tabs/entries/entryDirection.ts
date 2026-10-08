/**
 * Direção de um lançamento manual: o que SAI (ou só se move) fica em Pagar; o
 * que ENTRA fica em Receber. Uma tabela só (`fin_entries`), duas telas.
 *
 * `member_refund` (devolução a sócio) é saída criada por outro fluxo: aparece
 * na lista de Pagar, mas não se cria por aqui.
 */
import type { EntryKind, FinEntry } from '../../../../lib/finance/types';

export type EntryDirection = 'pay' | 'receive';

export interface DirectionConfig {
  /** Tipos que aparecem na lista e no filtro de tipo. */
  listKinds: EntryKind[];
  /** Tipos oferecidos no "novo lançamento"; o primeiro é o pré-selecionado. */
  createKinds: EntryKind[];
  title: string;
  subtitle: string;
  /** Rótulo do botão no cabeçalho do Card (curto: divide a linha no celular). */
  newLabel: string;
  /** Rótulo do botão no estado vazio. */
  emptyAction: string;
  emptyTitle: string;
  emptyHint: string;
  sheetTitle: string;
  sheetSubtitle: string;
  /** Prefixo do totalizador, ex.: "Despesas em aberto nesta lista". */
  openTotalLabel: string;
  /** Tipo cujo saldo em aberto entra no totalizador. */
  totalKind: EntryKind;
  paidFilterLabel: string;
  reportId: string;
  reportTitle: string;
}

export const DIRECTIONS: Record<EntryDirection, DirectionConfig> = {
  pay: {
    listKinds: ['expense', 'withdrawal', 'transfer', 'member_refund'],
    createKinds: ['expense', 'withdrawal', 'transfer'],
    title: 'Contas a pagar',
    subtitle: 'Despesas, retiradas e transferências entre contas.',
    newLabel: 'Novo',
    emptyAction: 'Novo lançamento',
    emptyTitle: 'Nenhuma conta a pagar com esses filtros',
    emptyHint: 'Registre uma despesa, retirada ou transferência.',
    sheetTitle: 'Novo lançamento',
    sheetSubtitle: 'Despesa, retirada ou transferência',
    openTotalLabel: 'Despesas em aberto nesta lista',
    totalKind: 'expense',
    paidFilterLabel: 'Pagas',
    reportId: 'contas-a-pagar',
    reportTitle: 'Contas a pagar',
  },
  receive: {
    listKinds: ['revenue', 'contribution'],
    createKinds: ['revenue', 'contribution'],
    title: 'Outras receitas',
    subtitle: 'Receitas avulsas (patrocínio, evento, aluguel do espaço…) e aportes. Mensalidades, pendências e Day Card têm abas próprias.',
    newLabel: 'Registrar',
    emptyAction: 'Registrar receita',
    emptyTitle: 'Nenhuma receita com esses filtros',
    emptyHint: 'Registre uma receita avulsa ou um aporte no caixa do clube.',
    sheetTitle: 'Registrar receita',
    sheetSubtitle: 'Receita avulsa ou aporte',
    openTotalLabel: 'Receitas em aberto nesta lista',
    totalKind: 'revenue',
    paidFilterLabel: 'Recebidas',
    reportId: 'contas-a-receber',
    reportTitle: 'Outras receitas (contas a receber)',
  },
};

/** Direção de um tipo de lançamento (para textos do detalhe). */
export const directionOf = (kind: EntryKind): EntryDirection => (kind === 'revenue' || kind === 'contribution' ? 'receive' : 'pay');

export const STATUS_TONE = { pending: 'info', partial: 'warn', paid: 'good', canceled: 'muted', overdue: 'bad' } as const;
const STATUS_LABEL = { pending: 'Pendente', partial: 'Parcial', paid: 'Paga', canceled: 'Cancelada', overdue: 'Vencida' } as const;

/** "Paga" para o que sai; "Recebida" para o que entra. */
export const entryStatusLabel = (status: FinEntry['display_status'], kind: EntryKind): string =>
  status === 'paid' && directionOf(kind) === 'receive' ? 'Recebida' : STATUS_LABEL[status];
