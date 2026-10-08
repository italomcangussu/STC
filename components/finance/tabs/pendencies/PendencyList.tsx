import React from 'react';
import { brDate, monthLabel } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { pendencyKindLabel, type PendencyRow } from '../../../../lib/finance/pendencies';
import { Badge, ChargeStatusBadge, Empty, Notice, Row, Spinner } from '../../ui';
import type { Pendencies } from './usePendencies';

export const Totals: React.FC<{ totals: Pendencies['totals'] }> = ({ totals }) => (
  <div className="grid grid-cols-2 gap-3">
    <div className="rounded-2xl bg-stone-50 p-3"><p className="text-[10px] font-black uppercase text-stone-400">Saldo em aberto</p><p className="text-xl font-black">{formatBRL(totals.open)}</p></div>
    <div className="rounded-2xl bg-red-50 p-3"><p className="text-[10px] font-black uppercase text-red-400">Vencido</p><p className="text-xl font-black text-red-700">{formatBRL(totals.overdue)}</p></div>
  </div>
);

/** A lista e os totais saem das pendências carregadas: se o filtro tem mais, a pessoa precisa saber. */
export const PartialNotice: React.FC<{ pendencies: Pendencies }> = ({ pendencies }) => {
  if (!pendencies.partial || pendencies.statements.loading) return null;
  return <Notice tone="warn">Há {pendencies.totalCount.toLocaleString('pt-BR')} pendências neste filtro; só as {pendencies.loadedCount.toLocaleString('pt-BR')} mais recentes entram na lista e nos totais acima. Escolha uma situação para ver as demais.</Notice>;
};

const PendencyRowItem: React.FC<{ row: PendencyRow; onOpen: (row: PendencyRow) => void }> = ({ row: r, onOpen }) => (
  <Row onClick={() => onOpen(r)}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="font-black text-stone-800">{r.profile_name}</p>
        <p className="text-sm text-stone-600">{r.meta.description}</p>
        <p className="mt-1 text-xs text-stone-400">{pendencyKindLabel(r.meta.pendency_kind)} · competência {monthLabel(r.competence_month)} · vence {brDate(r.due_date)}</p>
      </div>
      <div className="text-right">
        <p className="font-black tabular-nums">{formatBRL(r.total_due_cents)}</p>
        <div className="mt-1 flex justify-end gap-1"><ChargeStatusBadge status={r.display_status} />{!r.meta.collection_enabled && <Badge tone="neutral">Pausada</Badge>}</div>
      </div>
    </div>
  </Row>
);

export const PendencyRows: React.FC<{ pendencies: Pendencies; onOpen: (row: PendencyRow) => void }> = ({ pendencies, onOpen }) => {
  const { statements, meta, rows } = pendencies;
  if (statements.loading || meta.loading) return <Spinner />;
  if (statements.error || meta.error) return <Notice tone="warn">Não foi possível carregar as pendências.</Notice>;
  if (rows.length === 0) return <Empty title="Nenhuma pendência neste filtro" hint="Use “Nova pendência” para lançar uma cobrança manual para um sócio." />;
  return <div className="space-y-2">{rows.map((r) => <PendencyRowItem key={r.charge_id} row={r} onOpen={onOpen} />)}</div>;
};
