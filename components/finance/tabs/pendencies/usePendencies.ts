import { useMemo, useState } from 'react';
import { listCharges, listPendencyMeta } from '../../../../lib/finance/financeApi';
import { pendencyRows, pendencyTotals } from '../../../../lib/finance/pendencies';
import { useAsync } from '../../hooks';

/** Pendências carregadas de uma vez (a lista e os totais de saldo saem delas); acima disso a tela avisa. */
const LIST_LIMIT = 5000;

/** Filtros, consulta e totais da aba Pendências. */
export function usePendencies() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const statements = useAsync(() => listCharges({ chargeType: 'member_pendency', status }, LIST_LIMIT), [status]);
  const meta = useAsync(() => listPendencyMeta(), []);

  const rows = useMemo(() => pendencyRows(statements.data ?? [], meta.data ?? [], search), [statements.data, meta.data, search]);
  const totals = useMemo(() => pendencyTotals(rows), [rows]);
  const loadedCount = statements.data?.length ?? 0;
  const totalCount = statements.data?.[0]?.total_count ?? 0;

  const reload = () => { statements.reload(); meta.reload(); };
  return { search, setSearch, status, setStatus, statements, meta, rows, totals, loadedCount, totalCount, partial: totalCount > loadedCount, reload };
}

export type Pendencies = ReturnType<typeof usePendencies>;
