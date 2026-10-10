/**
 * Receber › Alunos e Day Card — as taxas dos NÃO-sócios ao clube, numa tela só e num
 * período só:
 *
 *  - Day Card: taxa do convidado de um sócio (acesso por um dia). Não há pagamento
 *    registrado: vem da reserva com convidado, no valor configurado. Isentar zera o valor.
 *  - Card Mensal e Aula avulsa: o que o aluno não-sócio pagou ao clube, registrado no
 *    cadastro do aluno (`student_payments`). A aula em si não gera receita a mais.
 *  - O professor é pago pelo próprio aluno: isso não entra no financeiro do clube.
 *
 * Os números são os mesmos da DRE: Day Card pela data da reserva, pagamento pela data em Fortaleza.
 */
import React, { useState } from 'react';
import { CreditCard, Trash2, Users } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { useConfirm } from '../../../hooks/useConfirm';
import { dayCardRows } from '../../../lib/finance/financeApi';
import { chargeDayCardAgain, deleteStudentPayment, exemptDayCard, listStudentPayments, studentFeeTotals, type StudentPaymentRow } from '../../../lib/finance/studentFees';
import type { DayCardRow } from '../../../lib/finance/types';
import { dayCardSpec } from '../../../lib/finance/export';
import { resolvePeriod, type Period } from '../../../lib/finance/reports';
import { brDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { useAction, useAsync, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import { Badge, Card, Empty, ErrorBlock, ExportButtons, PeriodBar, Row, Spinner, btnGhost } from '../ui';

const SHOWN = 300;

const Tile: React.FC<{ label: string; value: string; sub: string }> = ({ label, value, sub }) => (
  <div className="rounded-3xl border border-stone-100 bg-white p-4 shadow-sm">
    <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">{label}</p>
    <p className="text-2xl font-black tabular-nums text-stone-800">{value}</p>
    <p className="mt-0.5 text-xs text-stone-500">{sub}</p>
  </div>
);

const DayCardItem: React.FC<{ row: DayCardRow; onChanged: () => void }> = ({ row, onChanged }) => {
  const { busy, run } = useAction({ message: 'Não foi possível alterar o Day Card.', event: 'day_card_exempt_toggle_failed' });
  const change = (apply: typeof exemptDayCard, undo: typeof exemptDayCard, message: string) => run(() => apply(row.reservation_id), () => {
    onChanged();
    notify.success(message, { action: { label: 'Desfazer', onClick: () => { void undo(row.reservation_id).then(onChanged); } } });
  });
  const toggle = () => (row.exempt
    ? change(chargeDayCardAgain, exemptDayCard, `Day Card de ${row.guest_name} volta a ser cobrado.`)
    : change(exemptDayCard, chargeDayCardAgain, `Day Card de ${row.guest_name} isentado.`));
  return (
    <Row>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-stone-800">{row.guest_name}</p>
          <p className="text-xs text-stone-500">{brDate(row.occurred_on)}{row.booked_by ? ` · convidado de ${row.booked_by}` : ''}</p>
        </div>
        <p className="shrink-0 text-sm font-black tabular-nums">{formatBRL(row.charged_cents)}</p>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Badge tone={row.exempt ? 'muted' : 'warn'}>{row.exempt ? 'Isento' : 'Cobrado'}</Badge>
        <button className={`${btnGhost} min-h-11 px-3 text-xs`} disabled={busy} onClick={toggle}>{row.exempt ? 'Voltar a cobrar' : 'Isentar'}</button>
      </div>
    </Row>
  );
};

const DayCardCard: React.FC<{ rows: DayCardRow[]; period: Period; onChanged: () => void }> = ({ rows, period, onChanged }) => (
  <Card title="Day Card dos convidados" subtitle="Taxa do convidado de um sócio, para ter acesso ao clube por um dia. Vem da reserva, não de pagamento registrado; isentar zera o valor."
    right={<ExportButtons disabled={rows.length === 0} getSpec={() => dayCardSpec(rows, { period, generatedAt: new Date().toISOString() })} />}>
    {rows.length === 0 ? <Empty icon={<Users size={28} />} title="Nenhum convidado no período" hint="Aparece aqui toda reserva de amistoso com convidado." /> : (
      <ul className="space-y-2">{rows.slice(0, SHOWN).map((r) => <li key={r.reservation_id}><DayCardItem row={r} onChanged={onChanged} /></li>)}</ul>
    )}
    {rows.length > SHOWN && <p className="mt-2 text-xs text-stone-400">Mostrando {SHOWN} de {rows.length}. A exportação leva todas.</p>}
  </Card>
);

const PaymentItem: React.FC<{ payment: StudentPaymentRow; onChanged: () => void }> = ({ payment: p, onChanged }) => {
  const confirm = useConfirm();
  const { busy, run } = useAction({ message: 'Não foi possível excluir o pagamento.', event: 'student_payment_delete_failed' });
  const remove = async () => {
    if (!await confirm({ tone: 'danger', title: `Excluir o pagamento de ${p.studentName}?`, description: `${formatBRL(p.amountCents)} de ${brDate(p.paidOn)} sai do caixa e da DRE. A exclusão fica na auditoria.`, confirmLabel: 'Excluir pagamento' })) return;
    await run(() => deleteStudentPayment(p.id), () => { notify.success('Pagamento excluído.'); onChanged(); });
  };
  return (
    <Row className={p.canceled ? 'border-dashed opacity-70' : ''}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`truncate text-sm font-black ${p.canceled ? 'text-stone-500 line-through' : 'text-stone-800'}`}>{p.studentName}</p>
          <p className="text-xs text-stone-500">{p.canceled ? p.canceledReason || 'Pagamento estornado' : `Pago em ${brDate(p.paidOn)}`}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="text-right">
            <p className={`text-sm font-black tabular-nums ${p.canceled ? 'text-stone-400 line-through' : ''}`}>{formatBRL(p.amountCents)}</p>
            {p.canceled && <Badge tone="muted">Estornado</Badge>}
          </div>
          {!p.canceled && <button className="hit-44 rounded-xl text-stone-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" disabled={busy} onClick={remove} aria-label={`Excluir pagamento de ${p.studentName}`}><Trash2 size={16} /></button>}
        </div>
      </div>
    </Row>
  );
};

const PaymentsCard: React.FC<{ rows: StudentPaymentRow[]; onChanged: () => void }> = ({ rows, onChanged }) => (
  <Card title="Pagamentos de alunos" subtitle="Card Mensal e Aula avulsa: o pagamento registrado no cadastro do aluno.">
    {rows.length === 0 ? <Empty icon={<CreditCard size={28} />} title="Nenhum pagamento no período" hint="Os pagamentos são registrados no cadastro do aluno, em Pessoas › Alunos." /> : (
      <ul className="space-y-2">{rows.map((p) => <li key={p.id}><PaymentItem payment={p} onChanged={onChanged} /></li>)}</ul>
    )}
  </Card>
);

const StudentsTab: React.FC = () => {
  const today = useToday();
  const { settings } = useFinance();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));
  const data = useAsync(async () => {
    const [dayCards, payments] = await Promise.all([dayCardRows(period.from, period.to), listStudentPayments(period.from, period.to)]);
    return { dayCards, payments };
  }, [period.from, period.to]);
  const totals = data.data ? studentFeeTotals(data.data.dayCards, data.data.payments) : null;
  const price = settings ? formatBRL(settings.day_card_price_cents) : 'valor configurado';

  return (
    <div className="space-y-4">
      <Card><PeriodBar value={period} onChange={setPeriod} today={today} presets={['month', 'prev_month', 'quarter', 'last_30', 'custom']} /></Card>
      {data.error ? <ErrorBlock error={data.error} onRetry={data.reload} /> : !data.data || !totals ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Day Card" value={formatBRL(totals.dayCardCents)} sub={`${totals.dayCardCharged} cobrado(s) a ${price} · ${totals.dayCardExempt} isento(s)`} />
            <Tile label="Alunos" value={formatBRL(totals.paymentsCents)} sub={`${totals.paymentsCount} pagamento(s)${totals.canceledCount ? ` · ${totals.canceledCount} estornado(s)` : ''}`} />
          </div>
          <DayCardCard rows={data.data.dayCards} period={period} onChanged={data.reload} />
          <PaymentsCard rows={data.data.payments} onChanged={data.reload} />
          <p className="px-1 text-[11px] text-stone-400">O professor é pago pelo próprio aluno, por hora/aula: isso não entra no financeiro do clube.</p>
        </>
      )}
    </div>
  );
};

export default StudentsTab;
