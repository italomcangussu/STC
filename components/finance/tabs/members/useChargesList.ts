import { useCallback, useMemo, useState } from 'react';
import { listCharges, listPendencyMeta } from '../../../../lib/finance/financeApi';
import { chargeApiFilters, chargeExportFilters, chargeTotals, memberChargeRows, NO_CHARGE_FILTERS, type ChargeFilterState, type ChargeTypeFilter } from '../../../../lib/finance/memberCharges';
import { chargesSpec } from '../../../../lib/finance/export';
import { useAsync, useToday } from '../../hooks';

/** Cobranças trazidas de uma vez: a lista e os totais saem delas; acima disso a tela avisa. */
const LIST_LIMIT = 1000;
/** O arquivo exportado leva TODAS as cobranças do filtro, até este teto. */
const EXPORT_LIMIT = 5000;

/**
 * Filtros, consulta e totais da lista de cobranças de sócios (mensalidades e pendências juntas).
 * A busca por nome não vai ao banco (lá a comparação é sensível a acento): filtra o que já veio,
 * então digitar não refaz a consulta.
 */
export function useChargesList(initialType: ChargeTypeFilter = '') {
  const today = useToday();
  const [filters, setFilters] = useState<ChargeFilterState>({ ...NO_CHARGE_FILTERS, type: initialType });
  const change = useCallback((patch: Partial<ChargeFilterState>) => setFilters((current) => ({ ...current, ...patch })), []);

  const { search, type, status, compFrom, compTo, dueFrom, dueTo } = filters;
  const searching = search.trim() !== '';
  const charges = useAsync(() => listCharges(chargeApiFilters(filters), LIST_LIMIT), [type, status, compFrom, compTo, dueFrom, dueTo]);
  const meta = useAsync(() => (type === 'membership' ? Promise.resolve([]) : listPendencyMeta()), [type === 'membership']);

  const loaded = useMemo(() => charges.data ?? [], [charges.data]);
  const rows = useMemo(() => memberChargeRows(loaded, meta.data ?? [], search), [loaded, meta.data, search]);
  const totalCount = loaded[0]?.total_count ?? 0;
  const truncated = totalCount > loaded.length;
  const totals = useMemo(() => chargeTotals(rows), [rows]);

  const { reload: reloadCharges } = charges;
  const { reload: reloadMeta } = meta;
  const reload = useCallback(() => { reloadCharges(); reloadMeta(); }, [reloadCharges, reloadMeta]);

  // O arquivo leva todas as cobranças do filtro, com os mesmos totais da consulta.
  const exportSpec = async () => chargesSpec(!searching && truncated ? await listCharges(chargeApiFilters(filters), EXPORT_LIMIT) : rows, {
    generatedAt: new Date().toISOString(), period: null, filters: chargeExportFilters(filters, today),
  });

  return { filters, change, searching, charges, meta, loaded, rows, totalCount, truncated, totals, reload, exportSpec };
}

export type ChargesList = ReturnType<typeof useChargesList>;
