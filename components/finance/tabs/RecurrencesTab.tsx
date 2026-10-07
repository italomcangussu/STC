/**
 * Despesas recorrentes (aluguel, folha, energia…). Cada recorrência gera
 * lançamentos pendentes dentro do horizonte configurado; gerar de novo nunca
 * duplica. Alterar vale a partir do mês escolhido e só para o que ainda está
 * pendente e sem pagamento — o que já foi pago não muda.
 */
import React, { useState } from 'react';
import { Plus, Repeat, RefreshCw, Trash2 } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { useConfirm } from '../../../hooks/useConfirm';
import { notifyFinanceError } from '../../../lib/finance/errors';
import { deleteRecurrence, generateRecurrences, listRecurrences, saveRecurrence } from '../../../lib/finance/financeApi';
import type { FinRecurrence } from '../../../lib/finance/types';
import { firstOfMonth, monthLabel, type IsoDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { useAsync, useRequestKey, useToday } from '../hooks';
import { categoryLabel, useFinance } from '../FinanceContext';
import { Badge, Card, Empty, ErrorBlock, Field, MoneyInput, Notice, Row, Sheet, Spinner, btnDanger, btnGhost, btnPrimary, inputCls } from '../ui';

const FREQ_LABEL = { monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual' } as const;

const RecurrenceSheet: React.FC<{ rec: FinRecurrence | 'new' | null; onClose: () => void; onDone: () => void }> = ({ rec, onClose, onDone }) => {
  const today = useToday();
  const { accounts, categories } = useFinance();
  const confirm = useConfirm();
  const { key, renew } = useRequestKey();
  const editing = rec && rec !== 'new' ? rec : null;
  const [desc, setDesc] = useState(editing?.description ?? '');
  const [supplier, setSupplier] = useState(editing?.supplier ?? '');
  const [category, setCategory] = useState(editing?.category_id ?? '');
  const [amount, setAmount] = useState<number | null>(editing?.amount_cents ?? null);
  const [frequency, setFrequency] = useState<FinRecurrence['frequency']>(editing?.frequency ?? 'monthly');
  const [dueDay, setDueDay] = useState(String(editing?.due_day ?? 5));
  const [offset, setOffset] = useState(String(editing?.due_month_offset ?? 0));
  const [start, setStart] = useState<IsoDate>(editing?.start_month ?? firstOfMonth(today));
  const [end, setEnd] = useState<string>(editing?.end_month ?? '');
  const [account, setAccount] = useState(editing?.account_id ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [applyFrom, setApplyFrom] = useState<IsoDate>(firstOfMonth(today));
  const [busy, setBusy] = useState(false);
  if (!rec) return null;

  const cats = categories.filter((c) => (c.active || c.id === editing?.category_id) && c.kind === 'expense' && !c.system_key && c.dre_line !== 'none');
  const valid = desc.trim().length >= 2 && !!category && !!amount && amount > 0 && Number(dueDay) >= 1 && Number(dueDay) <= 31;

  const save = async () => {
    if (editing && !await confirm({
      tone: 'warning', title: 'Aplicar a mudança?',
      description: `Vale a partir de ${monthLabel(applyFrom)}, só para lançamentos ainda pendentes e sem pagamento. O que já foi pago não muda.${!active && editing.active ? ' A recorrência será pausada: lançamentos futuros pendentes serão cancelados.' : ''}`, confirmLabel: 'Aplicar',
    })) return;
    setBusy(true);
    try {
      await saveRecurrence(editing?.id ?? null, editing?.version ?? null, {
        description: desc.trim(), supplier: supplier.trim() || null, category_id: category, amount_cents: amount, frequency, due_day: Number(dueDay),
        due_month_offset: Number(offset), start_month: start, end_month: end || null, account_id: account || null, notes: notes.trim() || null, active,
      }, editing ? applyFrom : null, key);
      notify.success('Recorrência salva.'); renew(); onDone(); onClose();
    } catch (e) { notifyFinanceError(e, 'Não foi possível salvar a recorrência.', 'finance_recurrence_save_failed'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing) return;
    if (!await confirm({
      tone: 'danger', title: `Excluir "${editing.description}"?`,
      description: 'Os lançamentos pendentes e sem pagamento serão cancelados. O que já foi pago continua no caixa, nos relatórios e em Contas a pagar, como lançamento avulso. A recorrência deixa de existir e não volta a gerar lançamentos.',
      confirmLabel: 'Excluir recorrência',
    })) return;
    setBusy(true);
    try {
      const r = await deleteRecurrence(editing.id, editing.version, key);
      notify.success(r.canceled ? `Recorrência excluída. ${r.canceled} lançamento(s) pendente(s) cancelado(s).` : 'Recorrência excluída.');
      renew(); onDone(); onClose();
    } catch (e) { notifyFinanceError(e, 'Não foi possível excluir a recorrência.', 'finance_recurrence_delete_failed'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={onClose} title={editing ? 'Editar recorrência' : 'Nova recorrência'} subtitle="Despesa que se repete"
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy || !valid} onClick={save}>Salvar</button></>}>
      <Field label="Descrição"><input className={inputCls} maxLength={140} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <Field label="Fornecedor (opcional)"><input className={inputCls} value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
      <Field label="Categoria"><select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Escolha…</option>{cats.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id, categories)}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Frequência"><select className={inputCls} value={frequency} onChange={(e) => setFrequency(e.target.value as FinRecurrence['frequency'])}>{Object.entries(FREQ_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Dia do vencimento"><input inputMode="numeric" className={inputCls} value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
        <Field label="Vence no"><select className={inputCls} value={offset} onChange={(e) => setOffset(e.target.value)}><option value="0">mesmo mês</option><option value="1">mês seguinte</option><option value="2">2º mês seguinte</option></select></Field>
        <Field label="Começa em" hint="Mês de competência"><input type="date" className={inputCls} value={start} disabled={!!editing} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Termina em (opcional)"><input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Conta padrão (opcional)"><select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Sem conta definida</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Observações"><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-stone-700"><input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />Ativa (gera lançamentos)</label>
      {editing && <Field label="Mudança vale a partir de" hint="Competências anteriores e já pagas não mudam."><input type="month" className={inputCls} value={applyFrom.slice(0, 7)} onChange={(e) => e.target.value && setApplyFrom(`${e.target.value}-01`)} /></Field>}
      {editing && (
        <div className="mt-2 border-t border-stone-200 pt-4">
          <p className="mb-2 text-xs text-stone-500">Conta que varia todo mês (energia, água)? Exclua a recorrência e lance cada conta como despesa avulsa. O histórico pago não se perde.</p>
          <button type="button" className={btnDanger} disabled={busy} onClick={remove}><Trash2 size={16} /> Excluir recorrência</button>
        </div>
      )}
    </Sheet>
  );
};

const RecurrencesTab: React.FC = () => {
  const { categories } = useFinance();
  const { key, renew } = useRequestKey();
  const data = useAsync(() => listRecurrences(), []);
  const [sheet, setSheet] = useState<FinRecurrence | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try { const r = await generateRecurrences(key); notify.success(r.created === 0 ? 'Tudo já estava gerado.' : `${r.created} lançamento(s) gerado(s).`); renew(); }
    catch (e) { notifyFinanceError(e, 'Não foi possível gerar os lançamentos.', 'finance_recurrence_generate_failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Notice tone="info" title="Como funciona">Cada recorrência cria lançamentos pendentes (em Contas a pagar) para os próximos meses. Gerar de novo não duplica. Para encerrar, defina o mês final, desative ou exclua (o que já foi pago fica).</Notice>
      <Card title="Recorrências" right={<div className="flex gap-2"><button className={btnGhost} disabled={busy} onClick={generate}><RefreshCw size={16} /> Gerar lançamentos</button><button className={btnPrimary} onClick={() => setSheet('new')}><Plus size={16} /> Nova</button></div>}>
        {data.error ? <ErrorBlock error={data.error} onRetry={data.reload} /> : data.loading ? <Spinner /> : (data.data ?? []).length === 0 ? (
          <Empty icon={<Repeat size={28} />} title="Nenhuma despesa recorrente" hint="Cadastre aluguel, folha, energia, internet…" />
        ) : (
          <ul className="space-y-2">
            {data.data!.map((r) => (
              <li key={r.id}>
                <Row onClick={() => setSheet(r)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-black">{r.description}</p>
                      <p className="text-xs text-stone-500">{FREQ_LABEL[r.frequency]} · dia {r.due_day}{r.due_month_offset ? ` do ${r.due_month_offset === 1 ? 'mês seguinte' : '2º mês seguinte'}` : ''} · {categoryLabel(r.category_id, categories)}</p>
                      <p className="text-xs text-stone-400">desde {monthLabel(r.start_month)}{r.end_month ? ` até ${monthLabel(r.end_month)}` : ''}</p></div>
                    <div className="text-right"><p className="text-sm font-black tabular-nums">{formatBRL(r.amount_cents)}</p><Badge tone={r.active ? 'good' : 'muted'}>{r.active ? 'Ativa' : 'Pausada'}</Badge></div>
                  </div>
                </Row>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <RecurrenceSheet key={sheet === 'new' ? 'new' : sheet?.id ?? 'none'} rec={sheet} onClose={() => setSheet(null)} onDone={data.reload} />
    </div>
  );
};

export default RecurrencesTab;
