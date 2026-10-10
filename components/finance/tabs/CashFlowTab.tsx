/**
 * Fluxo de caixa: dinheiro que ENTROU e SAIU nas contas, pela data real.
 * Não é o DRE (competência). Transferências entre contas aparecem nos
 * movimentos, mas não contam como entrada nem saída do clube.
 */
import React, { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { MovementRow } from '../../../lib/finance/types';
import { CashMovementActions } from './CashMovementActions';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { accountBalances, cashFlow, dreLines, movements } from '../../../lib/finance/financeApi';
import { balanceSpec, exportFilename, movementsSpec, toCsv, type ReportSpec } from '../../../lib/finance/export';
import { notifyFinanceError } from '../../../lib/finance/errors';
import { buildDreStatement, composeDre, resolvePeriod, type Period } from '../../../lib/finance/reports';
import { brDate, monthShort } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { downloadBlob, useAsync, useToday } from '../hooks';
import { categoryLabel, useFinance } from '../FinanceContext';
import { BasisTag, Card, Empty, ErrorBlock, ExportButtons, Money, Notice, PeriodBar, Row, SectionTabs, Spinner, StatCard, btnGhost, inputCls } from '../ui';

type Gran = 'day' | 'week' | 'month';
const MOVEMENTS_LIMIT = 5000;
const GRAN_LABEL: Record<Gran, string> = { day: 'Dia', week: 'Semana', month: 'Mês' };

const bucketLabel = (g: Gran, start: string) => (g === 'month' ? monthShort(start) : brDate(start).slice(0, 5));

const CashFlowTab: React.FC = () => {
  const today = useToday();
  const { accounts, categories, settings } = useFinance();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));
  const [gran, setGran] = useState<Gran>('week');
  const [account, setAccount] = useState('');
  const [hideTransfers, setHideTransfers] = useState(false);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selectedMovement, setSelectedMovement] = useState<MovementRow | null>(null);

  const flow = useAsync(() => cashFlow(period.from, period.to, gran, account || null), [period.from, period.to, gran, account]);
  const moves = useAsync(() => movements(period.from, period.to, { ...(account ? { account_id: account } : {}), ...(category ? { category_id: category } : {}), ...(search.trim() ? { search: search.trim() } : {}) }, MOVEMENTS_LIMIT, 0), [period.from, period.to, account, category, search]);

  const totals = useMemo(() => {
    const b = flow.data ?? [];
    return { opening: b[0]?.opening_cents ?? 0, closing: b[b.length - 1]?.closing_cents ?? 0, inflow: b.reduce((s, x) => s + x.inflow_cents, 0), outflow: b.reduce((s, x) => s + x.outflow_cents, 0) };
  }, [flow.data]);
  const rows = useMemo(() => (moves.data ?? []).filter((m) => !hideTransfers || !m.is_transfer), [moves.data, hideTransfers]);

  const accountName = accounts.find((a) => a.id === account)?.name;
  const filters = [
    ...(accountName ? [{ label: 'Conta', value: accountName }] : []), ...(category ? [{ label: 'Categoria', value: categoryLabel(category, categories) }] : []),
    ...(search.trim() ? [{ label: 'Busca', value: search.trim() }] : []), ...(hideTransfers ? [{ label: 'Transferências', value: 'ocultas' }] : []),
  ];

  // "Balanço": saldos (posição), resultado (competência) e caixa (data real) em blocos separados.
  const exportBalance = async () => {
    const [balances, lines] = await Promise.all([accountBalances(period.to), dreLines(period.from, period.to)]);
    const dre = buildDreStatement(composeDre(lines.filter((l) => l.period === 'current')), composeDre(lines.filter((l) => l.period === 'previous')));
    return balanceSpec({ balances, dre, flow: { inflowCents: totals.inflow, outflowCents: totals.outflow } }, { period, filters, generatedAt: new Date().toISOString() });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><BasisTag basis="caixa" /><p className="text-xs text-stone-500">Pela data em que o dinheiro entrou ou saiu — diferente do DRE.</p></div>
      <Card title="Período e filtros">
        <PeriodBar value={period} onChange={setPeriod} today={today} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><p className="mb-1 text-[11px] font-black uppercase tracking-wider text-stone-400">Agrupar por</p>
            <SectionTabs label="Agrupar por" value={gran} onChange={(v) => setGran(v as Gran)} items={(['day', 'week', 'month'] as Gran[]).map((g) => ({ id: g, label: GRAN_LABEL[g] }))} /></div>
          <label className="block"><span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-stone-400">Conta</span>
            <select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Conta"><option value="">Todas as contas</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        </div>
      </Card>
      {settings && !settings.day_card_in_cash && <Notice tone="info">O Day Card dos convidados é derivado das reservas e <b>não</b> entra no caixa (não há pagamento registrado). Se o clube recebe na hora, ligue a opção em Configurações. Card Mensal e Aula avulsa dos alunos entram pelo pagamento registrado.</Notice>}

      {flow.error ? <ErrorBlock error={flow.error} onRetry={flow.reload} /> : flow.loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard indicator="balance" value={formatBRL(totals.closing)} sub={`saldo final · inicial ${formatBRL(totals.opening)}`} tone={totals.closing < 0 ? 'bad' : 'neutral'} />
            <StatCard indicator="cash_in" value={formatBRL(totals.inflow)} sub={`${brDate(period.from)} a ${brDate(period.to)}`} tone="good" />
            <StatCard indicator="cash_out" value={formatBRL(totals.outflow)} sub="saídas do período" />
            <div className="rounded-3xl border border-stone-100 bg-white p-4 shadow-sm"><p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Variação</p><p className="text-2xl font-black tabular-nums"><Money cents={totals.inflow - totals.outflow} signed /></p><p className="text-xs text-stone-500">entradas − saídas</p></div>
          </div>

          <Card title="Entradas, saídas e saldo" subtitle={`Por ${GRAN_LABEL[gran].toLowerCase()}`}>
            {(flow.data ?? []).length === 0 ? <Empty title="Sem movimentos no período" /> : (
              <div className="h-64" role="img" aria-label="Gráfico de entradas, saídas e saldo de caixa">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={flow.data!.map((b) => ({ x: bucketLabel(gran, b.bucket_start), Entradas: b.inflow_cents / 100, Saídas: b.outflow_cents / 100, Saldo: b.closing_cents / 100 }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="x" fontSize={11} /><YAxis fontSize={11} width={52} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                    <Tooltip formatter={(v) => formatBRL(Math.round(Number(v) * 100))} /><Legend />
                    <Bar dataKey="Entradas" fill="#10b981" radius={[6, 6, 0, 0]} /><Bar dataKey="Saídas" fill="#f97316" radius={[6, 6, 0, 0]} />
                    <Line dataKey="Saldo" stroke="#44403c" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card title="Movimentos" subtitle={`${rows.length} movimento(s)`}
            right={<ExportButtons disabled={rows.length === 0} getSpec={() => movementsSpec(rows, { period, filters, generatedAt: new Date().toISOString() })} />}>
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select className={inputCls} aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Todas as categorias</option>{categories.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id, categories)}</option>)}</select>
              <input className={inputCls} aria-label="Buscar pela descrição" placeholder="Buscar pela descrição" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <label className="flex min-h-11 items-center gap-2 text-xs font-bold text-stone-600"><input type="checkbox" className="h-5 w-5" checked={hideTransfers} onChange={(e) => setHideTransfers(e.target.checked)} />Ocultar transferências entre contas</label>
              <BalanceExport build={exportBalance} />
            </div>
            <p className="mb-3 text-xs text-stone-500">Encontrou um lançamento incorreto? Use <b>Corrigir / excluir</b> no movimento. Contas pagas são anuladas com estorno auditável, sem apagar a história; valores automáticos devem ser corrigidos na origem.</p>
            {moves.error ? <ErrorBlock error={moves.error} onRetry={moves.reload} /> : moves.loading ? <Spinner /> : rows.length === 0 ? <Empty title="Nenhum movimento" /> : (
              <ul className="space-y-2">
                {rows.slice(0, 300).map((m) => (
                  <li key={`${m.source_type}-${m.source_id}-${m.leg}`}>
                    <Row>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><p className="truncate text-sm font-bold text-stone-800">{m.description}</p><p className="text-xs text-stone-500">{brDate(m.occurred_on)} · {m.account_name}{m.category_name ? ` · ${m.category_name}` : ''}{m.is_transfer ? ' · transferência' : ''}</p></div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Money cents={m.amount_cents} className="text-sm font-black" signed />
                          <button type="button"
                            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-saibro-700 hover:bg-saibro-50"
                            aria-label={`Corrigir ou excluir movimento: ${m.description}, ${brDate(m.occurred_on)}`}
                            onClick={() => setSelectedMovement(m)}>
                            <Pencil size={14} /> Corrigir / excluir
                          </button>
                        </div>
                      </div>
                    </Row>
                  </li>
                ))}
              </ul>
            )}
            {rows.length > 300 && <p className="mt-2 text-xs text-stone-400">Mostrando 300 de {rows.length}. A exportação leva todos os movimentos filtrados.</p>}
            {(moves.data?.[0]?.total_count ?? 0) > MOVEMENTS_LIMIT && <div className="mt-2"><Notice tone="warn">Há mais de {MOVEMENTS_LIMIT.toLocaleString('pt-BR')} movimentos no filtro; só os mais recentes aparecem (e são exportados). Reduza o período ou use os filtros.</Notice></div>}
          </Card>
        </>
      )}
      <CashMovementActions
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
        onChanged={() => {
          setSelectedMovement(null);
          flow.reload();
          moves.reload();
        }}
      />
    </div>
  );
};

/** Botão do "Balanço": monta o arquivo sob demanda (precisa de saldos e DRE além do fluxo). */
const BalanceExport: React.FC<{ build: () => Promise<ReportSpec> }> = ({ build }) => {
  const [busy, setBusy] = useState(false);
  return (
    <button className={btnGhost} disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const spec = await build();
          downloadBlob(new Blob([toCsv(spec)], { type: 'text/csv;charset=utf-8' }), exportFilename(spec, 'csv'));
        } catch (e) { notifyFinanceError(e, 'Não foi possível gerar o balanço.', 'finance_export_failed'); }
        finally { setBusy(false); }
      }}>Balanço (CSV)</button>
  );
};

export default CashFlowTab;
