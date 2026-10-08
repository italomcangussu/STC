import React from 'react';
import { CalendarPlus } from 'lucide-react';
import { notify } from '../../../../lib/notifications';
import { generateCharges } from '../../../../lib/finance/financeApi';
import type { ChargeStatementRow } from '../../../../lib/finance/types';
import { CHARGE_STATUS_FILTERS, lateSuffix, shownAmountCents } from '../../../../lib/finance/memberCharges';
import { brDate, monthLabel } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { useAction, useRequestKey } from '../../hooks';
import { AdminSearch } from '../../../admin/ui';
import { Card, ChargeStatusBadge, Empty, ErrorBlock, ExportButtons, Field, Notice, Row, SectionTabs, Spinner, btnGhost, inputCls } from '../../ui';
import type { ChargesList } from './useChargesList';

const GenerateButton: React.FC<{ onGenerated: () => void }> = ({ onGenerated }) => {
  const { key, renew } = useRequestKey();
  const { busy, run } = useAction({ message: 'Não foi possível gerar as cobranças.', event: 'finance_generate_failed' });
  const generate = () => run(() => generateCharges(null, key), (result) => {
    notify.success(result.created ? `${result.created} cobrança(s) gerada(s).` : 'Nada novo a gerar — tudo já está gerado.', {
      description: result.missing_price ? `${result.missing_price} competência(s) sem preço definido não foram geradas.` : undefined,
    });
    renew(); onGenerated();
  });
  return <button className={btnGhost} disabled={busy} onClick={generate}><CalendarPlus size={16} /> Gerar cobranças</button>;
};

const FiltersCard: React.FC<{ list: ChargesList; onGenerated: () => void }> = ({ list, onGenerated }) => {
  const { filters, change } = list;
  return (
    <Card title="Cobranças" subtitle="Valor original, encargos e total atualizado de cada mensalidade." right={<GenerateButton onGenerated={onGenerated} />}>
      <div className="space-y-3">
        <AdminSearch value={filters.search} onChange={(search) => change({ search })} placeholder="Buscar sócio…" label="Buscar sócio" />
        <SectionTabs label="Situação" value={filters.status} onChange={(status) => change({ status })} items={CHARGE_STATUS_FILTERS.map(([id, label]) => ({ id, label }))} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Field label="Competência de"><input type="month" className={inputCls} value={filters.compFrom} onChange={(e) => change({ compFrom: e.target.value })} /></Field>
          <Field label="Competência até"><input type="month" className={inputCls} value={filters.compTo} onChange={(e) => change({ compTo: e.target.value })} /></Field>
          <Field label="Vence de"><input type="date" className={inputCls} value={filters.dueFrom} onChange={(e) => change({ dueFrom: e.target.value })} /></Field>
          <Field label="Vence até"><input type="date" className={inputCls} value={filters.dueTo} onChange={(e) => change({ dueTo: e.target.value })} /></Field>
        </div>
      </div>
    </Card>
  );
};

const SummaryBar: React.FC<{ list: ChargesList }> = ({ list }) => {
  const { rows, searching, truncated, totalCount, totals } = list;
  const count = !searching && truncated ? `Mostrando ${rows.length} de ${totalCount}` : `${rows.length} cobrança(s)`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-bold text-stone-500">{count} · a receber <span className="text-stone-800">{formatBRL(totals.due)}</span> · vencido <span className="text-red-600">{formatBRL(totals.overdue)}</span></p>
      <ExportButtons getSpec={list.exportSpec} disabled={rows.length === 0} />
    </div>
  );
};

const ChargeRow: React.FC<{ charge: ChargeStatementRow; onOpen: (charge: ChargeStatementRow) => void }> = ({ charge: r, onOpen }) => (
  <Row onClick={() => onOpen(r)}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-stone-800">{r.profile_name}</p>
        <p className="text-xs capitalize text-stone-500">{monthLabel(r.competence_month)} · vence {brDate(r.due_date)}{lateSuffix(r)}</p>
      </div>
      <div className="text-right"><ChargeStatusBadge status={r.display_status} /><p className="mt-1 text-sm font-black tabular-nums">{formatBRL(shownAmountCents(r))}</p></div>
    </div>
  </Row>
);

const EmptyCharges: React.FC<{ searchText: string; searching: boolean }> = ({ searchText, searching }) => (searching
  ? <Empty title={`Nenhuma cobrança de “${searchText.trim()}”`} hint="Confira o nome ou troque a situação e as datas — os filtros abaixo da busca também valem." />
  : <Empty title="Nenhuma cobrança com estes filtros" hint="Cadastre a mensalidade de um sócio em “Sócios e valores” e use “Gerar cobranças”." />);

const ChargeRows: React.FC<{ list: ChargesList; onOpen: (charge: ChargeStatementRow) => void }> = ({ list, onOpen }) => {
  const { charges, rows, searching, filters } = list;
  if (charges.error) return <ErrorBlock error={charges.error} onRetry={charges.reload} />;
  if (charges.loading) return <Spinner />;
  if (rows.length === 0) return <EmptyCharges searchText={filters.search} searching={searching} />;
  return <div className="space-y-2">{rows.map((r) => <ChargeRow key={r.charge_id} charge={r} onOpen={onOpen} />)}</div>;
};

/** A busca por nome só olha as cobranças carregadas: se o banco tem mais, a pessoa precisa saber. */
const SearchLimitNotice: React.FC<{ list: ChargesList }> = ({ list }) => {
  if (!list.searching || !list.truncated || list.charges.loading) return null;
  return <Notice tone="warn">A busca olhou as {list.loaded.length.toLocaleString('pt-BR')} cobranças mais recentes de {list.totalCount.toLocaleString('pt-BR')}. Para achar as mais antigas, restrinja por competência ou vencimento.</Notice>;
};

/** Aba "Cobranças": filtros, resumo com exportação e a lista; tocar numa linha abre o extrato. */
export const ChargesView: React.FC<{ list: ChargesList; onOpen: (charge: ChargeStatementRow) => void; onGenerated: () => void }> = ({ list, onOpen, onGenerated }) => (
  <>
    <FiltersCard list={list} onGenerated={() => { list.charges.reload(); onGenerated(); }} />
    <SummaryBar list={list} />
    <SearchLimitNotice list={list} />
    <ChargeRows list={list} onOpen={onOpen} />
  </>
);
