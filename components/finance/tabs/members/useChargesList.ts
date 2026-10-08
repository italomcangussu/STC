import { useCallback, useMemo, useState } from 'react';
import { listCharges } from '../../../../lib/finance/financeApi';
import { chargeApiFilters, chargeExportFilters, chargeTotals, NO_CHARGE_FILTERS, type ChargeFilterState } from '../../../../lib/finance/memberCharges';
import { chargesSpec } from '../../../../lib/finance/export';
import { matchesSearch } from '../../../../lib/searchText';
import { useAsync, useToday } from '../../hooks';

/** Quantas cobranças a tela traz de uma vez; com busca por nome traz o máximo que o banco entrega. */
const LIST_LIMIT = 300;
const SEARCH_LIMIT = 1000;
/** O arquivo exportado leva TODAS as cobranças do filtro, até este teto. */
const EXPORT_LIMIT = 5000;

/** Filtros, consulta e totais da lista de cobranças; vive acima das abas para o filtro sobreviver à troca de aba. */
export function useChargesList() {
  const today = useToday();
  const [filters, setFilters] = useState<ChargeFilterState>(NO_CHARGE_FILTERS);
  const change = useCallback((patch: Partial<ChargeFilterState>) => setFilters((current) => ({ ...current, ...patch })), []);

  // Digitar mais letras do nome não refaz a consulta: só mudar de "sem busca" para "com busca" e os demais filtros.
  const { search, status, compFrom, compTo, dueFrom, dueTo } = filters;
  const searching = search.trim() !== '';
  const charges = useAsync(() => listCharges(chargeApiFilters(filters), searching ? SEARCH_LIMIT : LIST_LIMIT), [searching, status, compFrom, compTo, dueFrom, dueTo]);

  const loaded = useMemo(() => charges.data ?? [], [charges.data]);
  const rows = useMemo(() => (searching ? loaded.filter((r) => matchesSearch(search, r.profile_name)) : loaded), [loaded, search, searching]);
  const totalCount = loaded[0]?.total_count ?? 0;
  const truncated = totalCount > loaded.length;
  const totals = useMemo(() => chargeTotals(rows), [rows]);

  // A tela mostra até 300 linhas; o arquivo leva todas as do filtro, com os mesmos totais da consulta.
  const exportSpec = async () => chargesSpec(!searching && truncated ? await listCharges(chargeApiFilters(filters), EXPORT_LIMIT) : rows, {
    generatedAt: new Date().toISOString(), period: null, filters: chargeExportFilters(filters, today),
  });

  return { filters, change, searching, charges, loaded, rows, totalCount, truncated, totals, exportSpec };
}

export type ChargesList = ReturnType<typeof useChargesList>;
