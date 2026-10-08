/**
 * Lista de lançamentos manuais de UMA direção (ver `entryDirection.ts`):
 * Pagar → despesas, retiradas e transferências; Receber → receitas avulsas e
 * aportes. Mesmo motor (`fin_entries`), mesmas folhas de detalhe.
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, Search } from 'lucide-react';
import { listEntries, type EntryFilters } from '../../../../lib/finance/financeApi';
import type { EntryKind, FinEntry } from '../../../../lib/finance/types';
import { ENTRY_KIND_LABEL, entriesSpec } from '../../../../lib/finance/export';
import { brDate } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { useAsync } from '../../hooks';
import { categoryLabel, useFinance } from '../../FinanceContext';
import { Badge, Card, Empty, ErrorBlock, ExportButtons, Row, SectionTabs, Spinner, btnPrimary, inputCls } from '../../ui';
import { DIRECTIONS, STATUS_TONE, entryStatusLabel, type EntryDirection } from './entryDirection';
import { EntrySheet, NewEntrySheet } from './EntrySheets';

type Status = NonNullable<EntryFilters['status']>;

/**
 * `listEntries` filtra um tipo por vez. Sem filtro de tipo, busca cada tipo da
 * direção (o limite vale por tipo, então uma direção não "come" a outra) e junta
 * na ordem da tela: vencimento crescente, sem vencimento por último.
 */
async function loadDirection(kinds: EntryKind[], base: EntryFilters): Promise<FinEntry[]> {
  const lists = await Promise.all(kinds.map((k) => listEntries({ ...base, kind: k })));
  const seen = new Set<string>();
  const out: FinEntry[] = [];
  lists.forEach((list, i) => list.forEach((r) => {
    // defensivo: nunca mostra um tipo de outra direção, mesmo se a consulta devolver
    if (r.kind !== kinds[i] || seen.has(r.id)) return;
    seen.add(r.id); out.push(r);
  }));
  if (kinds.length > 1) out.sort((a, b) => (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31'));
  return out;
}

export const EntriesTab: React.FC<{ direction: EntryDirection }> = ({ direction }) => {
  const cfg = DIRECTIONS[direction];
  const { categories } = useFinance();
  const [status, setStatus] = useState<Status>('open');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const statusFilters = useMemo(() => [['open', 'Em aberto'], ['overdue', 'Vencidas'], ['paid', cfg.paidFilterLabel], ['canceled', 'Canceladas'], ['all', 'Todas']] as const, [cfg.paidFilterLabel]);
  const kinds = kind ? [kind as EntryKind] : cfg.listKinds;
  const data = useAsync(
    () => loadDirection(kinds, { status, search, dueFrom: dueFrom || undefined, dueTo: dueTo || undefined, limit: 300 }),
    [direction, status, kind, search, dueFrom, dueTo],
  );
  const rows = useMemo(() => data.data ?? [], [data.data]);
  const selected = rows.find((r) => r.id === openId) ?? null;
  const live = useMemo(() => rows.filter((r) => r.status !== 'canceled'), [rows]);
  const openTotal = live.filter((r) => r.kind === cfg.totalKind).reduce((s, r) => s + r.remaining_cents, 0);

  const specFilters = [
    { label: 'Situação', value: statusFilters.find((s) => s[0] === status)?.[1] ?? status },
    ...(kind ? [{ label: 'Tipo', value: ENTRY_KIND_LABEL[kind as EntryKind] }] : []),
    ...(search.trim() ? [{ label: 'Busca', value: search.trim() }] : []),
    ...(dueFrom ? [{ label: 'Vencimento a partir de', value: brDate(dueFrom) }] : []),
    ...(dueTo ? [{ label: 'Vencimento até', value: brDate(dueTo) }] : []),
  ];

  const newButton = (label: string) => <button className={btnPrimary} onClick={() => setCreating(true)}><Plus size={16} /> {label}</button>;

  return (
    <div className="space-y-4">
      <Card title={cfg.title} subtitle={cfg.subtitle} right={newButton(cfg.newLabel)}>
        <SectionTabs label="Situação" value={status} onChange={(v) => setStatus(v as Status)} items={statusFilters.map(([id, label]) => ({ id, label }))} />
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="relative col-span-2"><Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-stone-300" /><input className={`${inputCls} pl-9`} placeholder="Buscar pela descrição" aria-label="Buscar pela descrição" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <select className={inputCls} aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Todos os tipos</option>{cfg.listKinds.map((k) => <option key={k} value={k}>{ENTRY_KIND_LABEL[k]}</option>)}</select>
          <div className="flex gap-2"><input type="date" className={inputCls} aria-label="Vencimento a partir de" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} /><input type="date" className={inputCls} aria-label="Vencimento até" value={dueTo} onChange={(e) => setDueTo(e.target.value)} /></div>
        </div>
      </Card>

      {data.error ? <ErrorBlock error={data.error} onRetry={data.reload} /> : data.loading ? <Spinner /> : rows.length === 0 ? (
        <Empty title={cfg.emptyTitle} hint={cfg.emptyHint} icon={<ArrowLeftRight size={28} />} action={newButton(cfg.emptyAction)} />
      ) : (
        <Card title={`${rows.length} lançamento(s)`} subtitle={`${cfg.openTotalLabel}: ${formatBRL(openTotal)}`} right={<ExportButtons getSpec={() => ({ ...entriesSpec(rows, { period: null, filters: specFilters, generatedAt: new Date().toISOString(), categoryName: (id) => categoryLabel(id, categories) }), id: cfg.reportId, title: cfg.reportTitle })} />}>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Row onClick={() => setOpenId(r.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-black text-stone-800">{r.description}</p><p className="text-xs text-stone-500">{ENTRY_KIND_LABEL[r.kind]}{r.due_date ? ` · vence ${brDate(r.due_date)}` : ''}{r.recurrence_id ? ' · recorrente' : ''}</p></div>
                    <div className="text-right"><p className="text-sm font-black tabular-nums">{formatBRL(r.amount_cents)}</p>{r.remaining_cents > 0 && r.paid_cents > 0 && <p className="text-[11px] text-stone-400">faltam {formatBRL(r.remaining_cents)}</p>}</div>
                  </div>
                  <div className="mt-1"><Badge tone={STATUS_TONE[r.display_status]}>{entryStatusLabel(r.display_status, r.kind)}</Badge></div>
                </Row>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <NewEntrySheet direction={direction} open={creating} onClose={() => setCreating(false)} onDone={data.reload} />
      <EntrySheet key={selected?.id ?? 'none'} entry={selected} onClose={() => setOpenId(null)} onChanged={data.reload} />
    </div>
  );
};

export default EntriesTab;
