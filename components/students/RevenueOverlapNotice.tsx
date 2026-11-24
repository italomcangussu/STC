import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { notify } from '../../lib/notifications';
import { useConfirm } from '../../hooks/useConfirm';
import { formatDateBr } from '../../utils';
import { formatBRL } from '../../lib/finance/money';
import { addDays, type IsoDate } from '../../lib/finance/dates';
import { cancelEntry, listCategories, listEntryPayments, listRecentRevenues, removeCashMovement } from '../../lib/finance/financeApi';
import type { FinEntry } from '../../lib/finance/types';
import {
  findOverlappingStudentRevenue, OVERLAP_WINDOW_DAYS, type RevenueCandidate,
} from '../../lib/finance/studentRevenueOverlap';

interface Props {
  studentName: string;
  paymentDate: IsoDate;
  today: IsoDate;
}

const toCandidate = (e: FinEntry, categoryName: Map<string, string>): RevenueCandidate => ({
  id: e.id,
  description: e.description,
  amountCents: e.amount_cents,
  date: (e.settled_on ?? e.due_date ?? e.competence_date) as IsoDate,
  categoryName: e.category_id ? categoryName.get(e.category_id) ?? null : null,
  canceled: e.status === 'canceled',
});

async function loadOverlaps(query: Props): Promise<Array<{ entry: FinEntry; candidate: RevenueCandidate }>> {
  const earliest = query.paymentDate < query.today ? query.paymentDate : query.today;
  const [entries, categories] = await Promise.all([
    listRecentRevenues(addDays(earliest, -OVERLAP_WINDOW_DAYS)), listCategories(),
  ]);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const byId = new Map(entries.map((e) => [e.id, e]));
  return findOverlappingStudentRevenue(query, entries.map((e) => toCandidate(e, names)))
    .map((candidate) => ({ entry: byId.get(candidate.id)!, candidate }));
}

/** Tira a receita do caixa pelo mesmo caminho do "Excluir lançamento incorreto" (auditado, nunca DELETE). */
async function removeRevenue(entry: FinEntry, reason: string) {
  const original = (await listEntryPayments(entry.id)).find((p) => p.kind === 'payment');
  if (original) await removeCashMovement('entry_payment', original.id, reason);
  else await cancelEntry(entry.id, entry.version, reason);
}

/**
 * Aviso no registro do Card: "já existe a receita X de R$ Y em DD/MM. É o mesmo dinheiro?".
 * O caixa soma Card e receita; o mesmo Pix lançado nos dois conta em dobro.
 */
export function RevenueOverlapNotice({ studentName, paymentDate, today }: Props) {
  const confirm = useConfirm();
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [overlaps, setOverlaps] = useState<Array<{ entry: FinEntry; candidate: RevenueCandidate }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState('loading');
    loadOverlaps({ studentName, paymentDate, today })
      .then((found) => { if (alive) { setOverlaps(found); setState('ready'); } })
      .catch(() => { if (alive) setState('unavailable'); });
    return () => { alive = false; };
  }, [studentName, paymentDate, today]);

  const dismiss = (id: string) => setOverlaps((list) => list.filter((o) => o.entry.id !== id));

  const exclude = async (entry: FinEntry) => {
    const ok = await confirm({
      tone: 'danger',
      title: `Excluir a receita "${entry.description}"?`,
      description: 'Ela sai do caixa e da DRE e fica só o Card deste aluno. O comprovante e o histórico continuam guardados.',
      confirmLabel: 'Excluir a receita',
    });
    if (!ok) return;
    setBusyId(entry.id);
    try {
      await removeRevenue(entry, `Duplicado: é o Card de ${studentName} com pagamento em ${formatDateBr(paymentDate)}`);
      dismiss(entry.id);
      notify.success('Receita excluída do caixa.', { description: 'Agora confirme o pagamento do Card.' });
    } catch (error) {
      notify.failure(error, 'Não foi possível excluir a receita.', { event: 'student_revenue_overlap_remove_failed' });
    } finally {
      setBusyId(null);
    }
  };

  if (state === 'loading') {
    return <p className="mb-4 flex items-center gap-2 text-xs text-texto-3"><Loader2 size={14} className="animate-spin" />Conferindo se este dinheiro já entrou como receita…</p>;
  }
  if (state === 'unavailable' || overlaps.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {overlaps.slice(0, 2).map(({ entry, candidate }) => (
        <div key={entry.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-start gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>Já existe a receita "{candidate.description}" de {formatBRL(candidate.amountCents)} em {formatDateBr(candidate.date)}. É o mesmo dinheiro?</span>
          </p>
          <p className="mt-1 text-xs text-amber-800">Se for, exclua a receita: o caixa soma as duas e o valor fica em dobro.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => dismiss(entry.id)} disabled={busyId === entry.id}
              className="min-h-11 rounded-lg border border-amber-200 bg-white px-3 text-xs font-bold text-amber-900 disabled:opacity-50">
              Não, é outro
            </button>
            <button type="button" onClick={() => exclude(entry)} disabled={busyId === entry.id}
              className="flex min-h-11 items-center justify-center gap-1 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white disabled:opacity-50">
              {busyId === entry.id ? <Loader2 size={14} className="animate-spin" /> : 'Sim, excluir a receita'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
