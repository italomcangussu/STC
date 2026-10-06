import React, { createContext, useContext } from 'react';
import type { FinAccount, FinCategory, FinSettings } from '../../lib/finance/types';

/** Dados de referência carregados uma vez pelo hub (contas, categorias, configuração). */
export interface FinanceRefs {
  accounts: FinAccount[];
  categories: FinCategory[];
  settings: FinSettings | null;
  reload: () => void;
  go: (tab: string) => void;
}

const Ctx = createContext<FinanceRefs | null>(null);

export const FinanceProvider: React.FC<{ value: FinanceRefs; children: React.ReactNode }> = ({ value, children }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;

// eslint-disable-next-line react-refresh/only-export-components
export function useFinance(): FinanceRefs {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFinance() exige <FinanceProvider> (o FinanceHub).');
  return v;
}

/** Nome "Estrutura › Aluguel" para uma categoria. */
// eslint-disable-next-line react-refresh/only-export-components
export function categoryLabel(id: string | null, categories: FinCategory[]): string {
  if (!id) return 'Sem categoria';
  const c = categories.find((x) => x.id === id);
  if (!c) return 'Categoria';
  const parent = c.parent_id ? categories.find((x) => x.id === c.parent_id) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}
