import React from 'react';
import { CHARGE_STATUS_FILTERS, CHARGE_TYPE_FILTERS, lateSuffix, shownAmountCents, type ChargeTypeFilter, type MemberChargeRow } from '../../../../lib/finance/memberCharges';
import { pendencyKindLabel } from '../../../../lib/finance/pendencies';
import { brDate, monthLabel } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { AdminSearch } from '../../../admin/ui';
import { Badge, Card, ChargeStatusBadge, Empty, ErrorBlock, ExportButtons, Field, Notice, Row, SectionTabs, Spinner, inputCls } from '../../ui';
import type { ChargesList } from './useChargesList';

/** A tela desenha até este tanto; a exportação leva todas. */
const SHOWN = 300;

const DateFilters: React.FC<{ list: ChargesList }> = ({ list }) => {
  const { filters, change } = list;
  const active = [filters.compFrom, filters.compTo, filters.dueFrom, filters.dueTo].filter(Boolean).length;
  return (
    <details className="group rounded-2xl border border-stone-100 bg-stone-50/60 px-3" open={active > 0}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-xs font-bold text-stone-600">
        <span>Competência e vencimento{active ? ` · ${active} filtro(s)` : ''}</span><span className="text-stone-400 group-open:rotate-180">▾</span>
      </summary>
      <div className="grid grid-cols-2 gap-2 pb-3 md:grid-cols-4">
        <Field label="Competência de"><input type="month" className={inputCls} value={filters.compFrom} onChange={(e) => change({ compFrom: e.target.value })} /></Field>
        <Field label="Competência até"><input type="month" className={inputCls} value={filters.compTo} onChange={(e) => change({ compTo: e.target.value })} /></Field>
        <Field label="Vence de"><input type="date" className={inputCls} value={filters.dueFrom} onChange={(e) => change({ dueFrom: e.target.value })} /></Field>
        <Field label="Vence até"><input type="date" className={inputCls} value={filters.dueTo} onChange={(e) => change({ dueTo: e.target.value })} /></Field>
      </div>
    </details>
  );
};

const FiltersCard: React.FC<{ list: ChargesList; actions: React.ReactNode }> = ({ list, actions }) => {
  const { filters, change } = list;
  return (
    <Card title="Cobranças de sócios" subtitle="Mensalidades e pendências: o que cada sócio deve ao clube." right={actions}>
      <div className="space-y-3">
        <AdminSearch value={filters.search} onChange={(search) => change({ search })} placeholder="Sócio, descrição ou convidado" label="Buscar cobrança" />
        <SectionTabs variant="segmented" label="Tipo" value={filters.type} onChange={(type) => change({ type: type as ChargeTypeFilter })} items={CHARGE_TYPE_FILTERS.map(([id, label]) => ({ id, label }))} />
        <SectionTabs label="Situação" value={filters.status} onChange={(status) => change({ status })} items={CHARGE_STATUS_FILTERS.map(([id, label]) => ({ id, label }))} />
        <DateFilters list={list} />
      </div>
    </Card>
  );
};

const Totals: React.FC<{ list: ChargesList }> = ({ list }) => (
  <div className="grid grid-cols-2 gap-3">
    <div className="rounded-2xl bg-white p-3 shadow-sm"><p className="text-[11px] font-black uppercase tracking-wider text-stone-400">A receber</p><p className="text-xl font-black tabular-nums text-stone-800">{formatBRL(list.totals.due)}</p></div>
    <div className="rounded-2xl bg-red-50 p-3"><p className="text-[11px] font-black uppercase tracking-wider text-red-400">Vencido</p><p className="text-xl font-black tabular-nums text-red-700">{formatBRL(list.totals.overdue)}</p></div>
  </div>
);

const SummaryBar: React.FC<{ list: ChargesList }> = ({ list }) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <p className="text-xs font-bold text-stone-500">{list.rows.length} cobrança(s){list.rows.length > SHOWN ? ` · mostrando ${SHOWN}` : ''}</p>
    <ExportButtons getSpec={list.exportSpec} disabled={list.rows.length === 0} />
  </div>
);

/** A lista e os totais saem das cobranças carregadas: se o filtro tem mais, a pessoa precisa saber. */
const PartialNotice: React.FC<{ list: ChargesList }> = ({ list }) => {
  if (!list.truncated || list.charges.loading) return null;
  return <Notice tone="warn">Há {list.totalCount.toLocaleString('pt-BR')} cobranças neste filtro; só as {list.loaded.length.toLocaleString('pt-BR')} mais recentes entram na lista, na busca e nos totais. Restrinja por tipo, situação ou datas para ver as demais.</Notice>;
};

const chargeSubtitle = (r: MemberChargeRow): string => (r.meta
  ? `${pendencyKindLabel(r.meta.pendency_kind)} · competência ${monthLabel(r.competence_month)} · vence ${brDate(r.due_date)}${lateSuffix(r)}`
  : `Mensalidade de ${monthLabel(r.competence_month)} · vence ${brDate(r.due_date)}${lateSuffix(r)}`);

const ChargeRow: React.FC<{ charge: MemberChargeRow; onOpen: (charge: MemberChargeRow) => void }> = ({ charge: r, onOpen }) => (
  <Row onClick={() => onOpen(r)}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-stone-800">{r.profile_name}</p>
        {r.meta && <p className="truncate text-sm text-stone-600">{r.meta.description}</p>}
        <p className="text-xs text-stone-500">{chargeSubtitle(r)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-black tabular-nums">{formatBRL(shownAmountCents(r))}</p>
        <div className="mt-1 flex flex-col items-end gap-1"><ChargeStatusBadge status={r.display_status} />{r.meta && !r.meta.collection_enabled && <Badge tone="neutral">Pausada</Badge>}</div>
      </div>
    </div>
  </Row>
);

const EmptyCharges: React.FC<{ list: ChargesList }> = ({ list }) => (list.searching
  ? <Empty title={`Nada encontrado para “${list.filters.search.trim()}”`} hint="Confira o nome ou troque o tipo, a situação e as datas: os filtros também valem para a busca." />
  : <Empty title="Nenhuma cobrança com estes filtros" hint="Mensalidades nascem do valor de cada sócio (Cadastros › Mensalidades dos sócios) com “Gerar mensalidades”; pendências, de “Nova pendência”." />);

const ChargeRows: React.FC<{ list: ChargesList; onOpen: (charge: MemberChargeRow) => void }> = ({ list, onOpen }) => {
  const { charges, meta, rows } = list;
  if (charges.error || meta.error) return <ErrorBlock error={charges.error ?? meta.error} onRetry={list.reload} />;
  if (charges.loading || meta.loading) return <Spinner />;
  if (rows.length === 0) return <EmptyCharges list={list} />;
  return <div className="space-y-2">{rows.slice(0, SHOWN).map((r) => <ChargeRow key={r.charge_id} charge={r} onOpen={onOpen} />)}</div>;
};

/** Lista de cobranças de sócios: filtros (tipo, situação, datas), totais, exportação e a lista; tocar abre o extrato. */
export const ChargesView: React.FC<{ list: ChargesList; actions: React.ReactNode; notice?: React.ReactNode; onOpen: (charge: MemberChargeRow) => void }> = ({ list, actions, notice, onOpen }) => (
  <>
    <FiltersCard list={list} actions={actions} />
    {notice}
    <Totals list={list} />
    <SummaryBar list={list} />
    <PartialNotice list={list} />
    <ChargeRows list={list} onOpen={onOpen} />
  </>
);
