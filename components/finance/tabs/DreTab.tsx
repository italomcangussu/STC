/**
 * DRE por competência, comparada ao período anterior, com detalhamento por
 * categoria e por lançamento. Aporte, retirada e transferência não entram no
 * resultado: aparecem à parte (memorando). Exportação = o que está na tela.
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { dreDetail, dreLines, dreMemo } from '../../../lib/finance/financeApi';
import { breakdownByCategory, buildDreStatement, composeDre, isWholeMonths, previousPeriod, resolvePeriod, type DreStatementRow, type Period } from '../../../lib/finance/reports';
import { dreDetailSpec, dreSpec } from '../../../lib/finance/export';
import { brDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { useAsync, useToday } from '../hooks';
import { BasisTag, Card, Empty, ErrorBlock, ExportButtons, Money, Notice, PeriodBar, Row, Sheet, Spinner } from '../ui';

const pctText = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${p.toLocaleString('pt-BR')}%`);
const signed = (r: DreStatementRow, v: number) => (r.negative ? -v : v);

const SOURCE_LABEL: Record<string, string> = {
  member_charge: 'Mensalidade', member_discount: 'Desconto na mensalidade', member_fee_payment: 'Multa e juros recebidos', member_fee_reversal: 'Estorno de multa e juros',
  student_payment: 'Pagamento de aluno (Card Mensal / Aula avulsa)', day_card: 'Day Card (convidado, derivado da reserva)', entry: 'Lançamento', entry_adjustment: 'Juros/desconto no pagamento',
};

const DetailSheet: React.FC<{ category: { id: string; name: string } | null; period: Period; onClose: () => void }> = ({ category, period, onClose }) => {
  const data = useAsync(() => (category ? dreDetail(period.from, period.to, category.id) : Promise.resolve([])), [category?.id, period.from, period.to]);
  if (!category) return null;
  const rows = data.data ?? [];
  return (
    <Sheet open onClose={onClose} wide title={category.name} subtitle={`Lançamentos de ${brDate(period.from)} a ${brDate(period.to)} (competência)`}
      footer={<ExportButtons disabled={rows.length === 0} getSpec={() => dreDetailSpec(rows, { period, categoryName: category.name, generatedAt: new Date().toISOString() })} />}>
      {data.error ? <ErrorBlock error={data.error} onRetry={data.reload} /> : data.loading ? <Spinner /> : rows.length === 0 ? <Empty title="Sem lançamentos" /> : (
        <>
          <ul className="space-y-2">
            {rows.slice(0, 400).map((r) => (
              <li key={`${r.source_type}-${r.source_id}-${r.occurred_on}`}>
                <Row><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-bold">{r.description}</p><p className="text-xs text-stone-500">{brDate(r.occurred_on)} · {SOURCE_LABEL[r.source_type] ?? r.source_type}</p></div><Money cents={r.amount_cents} className="text-sm font-black" /></div></Row>
              </li>
            ))}
          </ul>
          <p className="text-sm font-black">Total: {formatBRL(rows.reduce((s, r) => s + r.amount_cents, 0))}</p>
          {rows.length > 400 && <p className="text-xs text-stone-400">Mostrando 400 de {rows.length}; o arquivo exportado leva todos.</p>}
        </>
      )}
    </Sheet>
  );
};

const DreTab: React.FC = () => {
  const today = useToday();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);
  const prev = previousPeriod(period);

  const data = useAsync(async () => {
    const [lines, memo] = await Promise.all([dreLines(period.from, period.to), dreMemo(period.from, period.to)]);
    return { lines, memo };
  }, [period.from, period.to]);

  const model = useMemo(() => {
    if (!data.data) return null;
    const cur = composeDre(data.data.lines.filter((l) => l.period === 'current'));
    const old = composeDre(data.data.lines.filter((l) => l.period === 'previous'));
    return { statement: buildDreStatement(cur, old), summary: cur };
  }, [data.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><BasisTag basis="competencia" /><p className="text-xs text-stone-500">Mensalidade pelo mês cobrado, Card Mensal e Aula avulsa pela data do pagamento, Day Card pela data da reserva, despesas pela competência — pagas ou não. Não é fluxo de caixa.</p></div>
      <Card title="Período"><PeriodBar value={period} onChange={setPeriod} today={today} />
        <p className="mt-1 text-xs text-stone-500">Comparado com {brDate(prev.from)} a {brDate(prev.to)}.</p>
        {!isWholeMonths(period) && <div className="mt-2"><Notice tone="warn">O período não fecha meses inteiros. Mensalidades entram pelo mês de competência (dia 1): um período quebrado pode deixar de fora ou incluir a mensalidade do mês inteiro.</Notice></div>}
      </Card>

      {data.error ? <ErrorBlock error={data.error} onRetry={data.reload} /> : data.loading || !model ? <Spinner /> : (
        <>
          <Card title="Demonstração do resultado" right={<ExportButtons getSpec={() => dreSpec(model.statement, { period, previous: prev, generatedAt: new Date().toISOString() })} />}>
            <ul className="divide-y divide-stone-100">
              {model.statement.map((r) => {
                const canOpen = !!r.bucket && (r.current !== 0 || r.previous !== 0);
                const open = expanded === r.key;
                const cats = open && r.bucket ? breakdownByCategory(data.data!.lines, r.bucket) : [];
                return (
                  <li key={r.key} className={r.kind === 'line' ? '' : 'bg-stone-50/70'}>
                    <button className="flex min-h-12 w-full items-center gap-2 px-1 py-2 text-left disabled:cursor-default" disabled={!canOpen} aria-expanded={canOpen ? open : undefined} onClick={() => setExpanded(open ? null : r.key)}>
                      <span className="w-4 shrink-0 text-stone-300">{canOpen ? (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : null}</span>
                      <span className={`flex-1 text-sm ${r.kind === 'line' ? 'font-medium text-stone-700' : 'font-black text-stone-900'}`}>{r.label}</span>
                      <span className="text-right">
                        <Money cents={signed(r, r.current)} className={`block text-sm ${r.kind === 'line' ? 'font-bold' : 'font-black'}`} />
                        <span className="block text-[11px] text-stone-400">ant. {formatBRL(signed(r, r.previous))} · {pctText(r.deltaPct)}{r.share !== null && r.kind === 'line' ? ` · ${r.share.toLocaleString('pt-BR')}% da rec.` : ''}</span>
                      </span>
                    </button>
                    {open && (
                      <ul className="mb-2 ml-6 space-y-1 border-l-2 border-stone-100 pl-3">
                        {cats.length === 0 && <li className="py-1 text-xs text-stone-400">Sem categorias.</li>}
                        {cats.map((c) => (
                          <li key={c.category_id}>
                            <button className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-xs hover:text-saibro-700" onClick={() => setDetail({ id: c.category_id, name: c.parent_name ? `${c.parent_name} › ${c.name}` : c.name })}>
                              <span className="font-bold underline-offset-2 hover:underline">{c.parent_name ? `${c.parent_name} › ` : ''}{c.name}</span>
                              <span className="tabular-nums">{formatBRL(c.current)} <span className="text-stone-400">(ant. {formatBRL(c.previous)})</span></span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Fora do resultado" subtitle="Movimentam o caixa, mas não são receita nem despesa">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-stone-500">Aportes no período</dt><dd className="font-bold tabular-nums">{formatBRL(data.data!.memo?.contributions_cents ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">Retiradas no período</dt><dd className="font-bold tabular-nums">{formatBRL(data.data!.memo?.withdrawals_cents ?? 0)}</dd></div>
            </dl>
            <p className="mt-2 text-[11px] text-stone-400">Transferências entre contas também ficam de fora.</p>
          </Card>
        </>
      )}
      <DetailSheet category={detail} period={period} onClose={() => setDetail(null)} />
    </div>
  );
};

export default DreTab;
