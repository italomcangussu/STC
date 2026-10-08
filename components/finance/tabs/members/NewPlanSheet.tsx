import React, { useMemo, useState } from 'react';
import { notify } from '../../../../lib/notifications';
import { createPlan, generateCharges, listHolidays, listMembersWithoutPlan } from '../../../../lib/finance/financeApi';
import type { FinHoliday } from '../../../../lib/finance/types';
import { overdueCount, previewNeedsAttention, previewNewPlan, previewSentence } from '../../../../lib/finance/memberCharges';
import { firstOfMonth, type IsoDate } from '../../../../lib/finance/dates';
import type { PeriodMonths } from '../../../../lib/finance/memberBilling';
import { useAction, useAsync, useRequestKey, useToday } from '../../hooks';
import { useFinance } from '../../FinanceContext';
import { Field, MoneyInput, Notice, Sheet, Spinner, btnGhost, btnPrimary, inputCls } from '../../ui';

const PERIODS: Array<[PeriodMonths, string]> = [[1, 'Mensal'], [3, 'Trimestral'], [6, 'Semestral'], [12, 'Anual']];

/** Com o vencimento no mês cobrado, um vínculo que começou antes de hoje já gera cobranças vencidas: o admin precisa ver isso antes de criar. */
const PlanPreview: React.FC<{ preview: ReturnType<typeof previewNewPlan>; today: IsoDate }> = ({ preview, today }) => {
  const overdue = overdueCount(preview, today);
  return (
    <Notice tone={previewNeedsAttention(preview, overdue) ? 'warn' : 'info'} title={`Serão geradas ${preview.create.length} cobrança(s)`}>
      {previewSentence(preview, today)}
    </Notice>
  );
};

type Draft = { profile: string; start: IsoDate; period: PeriodMonths; amount: number | null };

/** O que o plano geraria hoje com o que foi digitado; só existe quando há valor e início. */
function useNewPlanPreview({ profile, start, period, amount }: Draft, holidays: FinHoliday[] | null) {
  const today = useToday();
  const { settings } = useFinance();
  return useMemo(
    () => (amount && start ? previewNewPlan({ profile, start, period, amountCents: amount }, { today, settings, holidays: holidays ?? [] }) : null),
    [amount, start, period, holidays, settings, today, profile],
  );
}

export const NewPlanSheet: React.FC<{ open: boolean; onClose: () => void; onDone: () => void }> = ({ open, onClose, onDone }) => {
  const today = useToday();
  const { key, renew } = useRequestKey();
  const { busy, run } = useAction({ message: 'Não foi possível criar a mensalidade.', event: 'finance_plan_create_failed' });
  const members = useAsync(() => (open ? listMembersWithoutPlan() : Promise.resolve([])), [open]);
  const holidays = useAsync(() => (open ? listHolidays() : Promise.resolve([])), [open]);
  const [profile, setProfile] = useState('');
  const [start, setStart] = useState<IsoDate>(firstOfMonth(today));
  const [period, setPeriod] = useState<PeriodMonths>(1);
  const [amount, setAmount] = useState<number | null>(null);

  const preview = useNewPlanPreview({ profile, start, period, amount }, holidays.data);

  const create = () => run(async () => {
    const plan = await createPlan({ profile_id: profile, start_on: start, amount_cents: amount, period_months: period }, key);
    return generateCharges(plan.id);
  }, (generated) => {
    notify.success('Mensalidade criada.', { description: `${generated.created} cobrança(s) gerada(s).` });
    renew(); onDone(); onClose();
  });

  return (
    <Sheet open={open} onClose={onClose} wide title="Nova mensalidade" subtitle="Cada sócio tem o seu valor — não existe valor único para todos."
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy || !profile || !amount} onClick={create}>Criar e gerar cobranças</button></>}>
      {members.loading ? <Spinner /> : (
        <>
          <Field label="Sócio" hint="Só aparecem sócios ativos que ainda não têm mensalidade.">
            <select className={inputCls} value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="">Escolha…</option>
              {(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor por período"><MoneyInput value={amount} onChange={setAmount} aria-label="Valor da mensalidade" /></Field>
            <Field label="Periodicidade">
              <select className={inputCls} value={period} onChange={(e) => setPeriod(Number(e.target.value) as PeriodMonths)}>
                {PERIODS.map(([months, label]) => <option key={months} value={months}>{label}</option>)}
              </select>
            </Field>
            <Field label="Início do vínculo" className="col-span-2"><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          </div>
          {preview && <PlanPreview preview={preview} today={today} />}
        </>
      )}
    </Sheet>
  );
};
