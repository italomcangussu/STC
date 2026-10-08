import React, { useMemo, useState } from 'react';
import { CalendarPlus, CreditCard, Plus, UserMinus } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { useConfirm } from '../../../hooks/useConfirm';
import { notifyFinanceError } from '../../../lib/finance/errors';
import {
  adjustCharge, cancelCharge, chargeHistory, createPlan, endPlan, generateCharges, listCharges, listCredits, listHolidays, listMembersWithoutPlan, listPlanPrices,
  listPlans, profileNames, registerPayment, resolveCredit, reversePayment, setPlanPrice, updatePlan, type PlanWithMember,
} from '../../../lib/finance/financeApi';
import type { ChargeStatementRow, MemberCreditRow } from '../../../lib/finance/types';
import { brDate, addMonths, firstOfMonth, monthLabel, type IsoDate } from '../../../lib/finance/dates';
import { buildCalendar, CLUB_DEFAULT_DUE_RULE, type DueRule } from '../../../lib/finance/calendar';
import { generationHorizon, planCharges, priceFor } from '../../../lib/finance/memberBilling';
import { formatBRL } from '../../../lib/finance/money';
import { matchesSearch } from '../../../lib/searchText';
import { chargesSpec } from '../../../lib/finance/export';
import { useAsync, useRequestKey, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import { AdminSearch } from '../../admin/ui';
import { Badge, Card, ChargeStatusBadge, Empty, ErrorBlock, ExportButtons, Field, MoneyInput, Notice, Row, SectionTabs, Sheet, Spinner, btnDanger, btnGhost, btnPrimary, inputCls } from '../ui';

const METHODS = [['pix', 'Pix'], ['transfer', 'Transferência'], ['cash', 'Dinheiro'], ['card', 'Cartão'], ['other', 'Outro']] as const;
/** Quantas cobranças a tela traz de uma vez; com busca por nome traz o máximo que o banco entrega. */
const LIST_LIMIT = 300;
const SEARCH_LIMIT = 1000;
const STATUS_FILTERS = [['', 'Todas'], ['overdue', 'Vencidas'], ['open', 'Em aberto'], ['forecast', 'Previstas'], ['partial', 'Parciais'], ['in_review', 'Em análise'], ['paid', 'Pagas'], ['canceled', 'Canceladas']] as const;

// ------------------------------------------------------------------
// Cobrança: extrato e ações
// ------------------------------------------------------------------
type ActionMode = null | 'pay' | 'discount' | 'waiver' | 'cancel' | 'reverse';

const ChargeSheet: React.FC<{ charge: ChargeStatementRow | null; onClose: () => void; onChanged: () => void }> = ({ charge, onClose, onChanged }) => {
  const today = useToday();
  const { accounts } = useFinance();
  const confirm = useConfirm();
  const [mode, setMode] = useState<ActionMode>(null);
  const { key, renew } = useRequestKey();
  const defaultAccount = accounts.find((a) => a.is_default_receipts)?.id ?? accounts.find((a) => a.active)?.id ?? '';
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState<IsoDate>(today);
  const [method, setMethod] = useState('pix');
  const [account, setAccount] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<'discount' | 'increase'>('discount');
  const [paymentId, setPaymentId] = useState('');
  const [busy, setBusy] = useState(false);
  const hist = useAsync(() => (charge ? chargeHistory(charge.charge_id) : Promise.resolve(null)), [charge?.charge_id, busy]);

  const open = (m: ActionMode) => {
    if (!charge) return;
    renew(); setMode(m); setReason('');
    setAmount(m === 'pay' ? charge.total_due_cents : m === 'waiver' ? charge.fees_due_cents : null);
    setAccount(defaultAccount); setDate(today); setMethod('pix');
  };

  const effective = (hist.data?.payments ?? []).filter((p) => p.kind === 'payment' && !(hist.data?.payments ?? []).some((r) => r.kind === 'reversal' && r.method === p.method && r.paid_on >= p.paid_on && r.amount_cents === p.amount_cents && r.principal_cents === p.principal_cents && r.created_at >= p.created_at));
  const lastPayment = [...effective].sort((a, b) => (a.paid_on + a.created_at).localeCompare(b.paid_on + b.created_at)).pop();

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); notify.success(ok); renew(); setMode(null); onChanged(); }
    catch (e) { notifyFinanceError(e, 'Não foi possível concluir a operação.', 'finance_charge_action_failed'); }
    finally { setBusy(false); }
  };

  if (!charge) return null;
  const c = charge;
  const reasonOk = reason.trim().length >= 5;
  return (
    <Sheet open onClose={onClose} wide title={`${c.profile_name} — ${monthLabel(c.competence_month)}`} subtitle={`Vencimento ${brDate(c.due_date)}`}>
      <div className="flex items-center justify-between"><ChargeStatusBadge status={c.display_status} />{c.in_review && <Badge tone="warn">Comprovante em análise</Badge>}</div>
      <dl className="space-y-1 rounded-2xl bg-stone-50 p-3 text-sm">
        {[['Valor original', c.original_amount_cents], ['Valor com ajustes', c.principal_base_cents], ['Principal já pago', c.principal_paid_cents], ['Principal em aberto', c.principal_remaining_cents]].map(([l, v]) => (
          <div key={l as string} className="flex justify-between"><dt className="text-stone-500">{l}</dt><dd className="font-bold tabular-nums">{formatBRL(v as number)}</dd></div>
        ))}
        <div className="flex justify-between"><dt className="text-stone-500">Dias de atraso</dt><dd className="font-bold">{c.days_late}</dd></div>
        {c.fees_configured ? (
          <>
            <div className="flex justify-between"><dt className="text-stone-500">Multa devida</dt><dd className="tabular-nums">{formatBRL(c.fine_due_cents)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Juros devidos</dt><dd className="tabular-nums">{formatBRL(c.interest_due_cents)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Encargos pagos / dispensados</dt><dd className="tabular-nums">{formatBRL(c.fees_paid_cents)} / {formatBRL(c.fees_waived_cents)}</dd></div>
          </>
        ) : <p className="text-xs text-amber-700">Encargos de atraso não configurados (Cadastros › Configurações).</p>}
        <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-black"><dt>Total a pagar</dt><dd className="tabular-nums">{formatBRL(c.total_due_cents)}</dd></div>
      </dl>

      {mode === null && c.display_status !== 'canceled' && (
        <div className="grid grid-cols-2 gap-2">
          {c.total_due_cents > 0 && <button className={btnPrimary} onClick={() => open('pay')}>Registrar pagamento</button>}
          {c.principal_remaining_cents > 0 && <button className={btnGhost} onClick={() => open('discount')}>Desconto / acréscimo</button>}
          {c.fees_due_cents > 0 && <button className={btnGhost} onClick={() => open('waiver')}>Dispensar encargos</button>}
          {lastPayment && <button className={btnGhost} onClick={() => { open('reverse'); setPaymentId(lastPayment.id); }}>Estornar último pagamento</button>}
          {!lastPayment && c.stored_status !== 'paid' && <button className={btnDanger} onClick={() => open('cancel')}>Cancelar cobrança</button>}
        </div>
      )}

      {mode === 'pay' && (
        <div className="space-y-3 rounded-2xl border border-saibro-200 p-3">
          <p className="text-sm font-black">Registrar pagamento</p>
          <p className="text-xs text-stone-500">O valor abate primeiro multa, depois juros, depois o principal. Se passar do devido, a sobra vira crédito do sócio (nunca se perde).</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor recebido"><MoneyInput value={amount} onChange={setAmount} aria-label="Valor recebido" /></Field>
            <Field label="Data do dinheiro"><input type="date" className={inputCls} value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Forma"><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Conta onde entrou"><select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Escolha…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          </div>
          <Field label="Observação (opcional)"><input className={inputCls} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setMode(null)}>Voltar</button>
            <button className={btnPrimary} disabled={busy || !amount || amount <= 0 || !account} onClick={() => run(() => registerPayment(c.charge_id, amount!, date, method, account, reason.trim() || null, key), 'Pagamento registrado.')}>Confirmar pagamento</button></div>
        </div>
      )}

      {(mode === 'discount' || mode === 'waiver') && (
        <div className="space-y-3 rounded-2xl border border-saibro-200 p-3">
          <p className="text-sm font-black">{mode === 'waiver' ? 'Dispensar multa e juros' : 'Desconto ou acréscimo'}</p>
          <Notice tone="warn">Todo desconto, acréscimo ou dispensa fica registrado com valor, motivo, quem fez e o extrato antes/depois. Só o administrador pode.</Notice>
          {mode === 'discount' && <Field label="Tipo"><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as 'discount' | 'increase')}><option value="discount">Desconto (reduz o principal)</option><option value="increase">Acréscimo (aumenta o principal)</option></select></Field>}
          <Field label="Valor" hint={mode === 'waiver' ? `Encargos devidos agora: ${formatBRL(c.fees_due_cents)}` : `Principal em aberto: ${formatBRL(c.principal_remaining_cents)}`}><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Justificativa (obrigatória)" hint="Mínimo de 5 caracteres."><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setMode(null)}>Voltar</button>
            <button className={btnPrimary} disabled={busy || !amount || !reasonOk} onClick={async () => {
              if (!await confirm({ tone: 'warning', title: mode === 'waiver' ? 'Dispensar estes encargos?' : kind === 'discount' ? 'Conceder este desconto?' : 'Lançar este acréscimo?', description: `${formatBRL(amount ?? 0)} — fica registrado na auditoria.`, confirmLabel: 'Confirmar' })) return;
              await run(() => adjustCharge(c.charge_id, mode === 'waiver' ? 'fee_waiver' : kind, amount!, reason.trim(), key), 'Ajuste registrado.');
            }}>Registrar</button></div>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="space-y-3 rounded-2xl border border-red-200 p-3">
          <p className="text-sm font-black text-red-700">Cancelar cobrança</p>
          <p className="text-xs text-stone-500">Só é possível sem pagamento. A cobrança deixa de contar como receita; o histórico fica.</p>
          <Field label="Motivo (obrigatório)"><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setMode(null)}>Voltar</button>
            <button className={btnDanger} disabled={busy || !reasonOk} onClick={() => run(() => cancelCharge(c.charge_id, reason.trim(), key), 'Cobrança cancelada.')}>Cancelar cobrança</button></div>
        </div>
      )}

      {mode === 'reverse' && lastPayment && (
        <div className="space-y-3 rounded-2xl border border-red-200 p-3">
          <p className="text-sm font-black text-red-700">Estornar pagamento de {formatBRL(lastPayment.amount_cents)} ({brDate(lastPayment.paid_on)})</p>
          <p className="text-xs text-stone-500">Cria uma linha de estorno: o caixa mostra a saída e a cobrança volta a ficar em aberto. Só o último pagamento pode ser estornado.</p>
          <Field label="Motivo (obrigatório)"><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setMode(null)}>Voltar</button>
            <button className={btnDanger} disabled={busy || !reasonOk} onClick={() => run(() => reversePayment(paymentId, reason.trim(), key), 'Pagamento estornado.')}>Estornar</button></div>
        </div>
      )}

      <div className="space-y-1.5 border-t border-stone-100 pt-3 text-xs text-stone-600">
        <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Histórico</p>
        {hist.loading && <Spinner label="Carregando…" />}
        {hist.data?.payments.map((p) => (
          <p key={p.id}>{brDate(p.paid_on)} — {p.kind === 'reversal' ? <b className="text-red-600">Estorno</b> : 'Pagamento'} <b>{formatBRL(p.amount_cents)}</b> ({p.method}){p.kind === 'payment' && ` · principal ${formatBRL(p.principal_cents)}, encargos ${formatBRL(p.fine_cents + p.interest_cents)}${p.excess_cents ? `, crédito ${formatBRL(p.excess_cents)}` : ''}`}{p.note ? ` — ${p.note}` : ''}</p>
        ))}
        {hist.data?.adjustments.map((a) => <p key={a.id}>{brDate(a.created_at.slice(0, 10))} — {a.kind === 'discount' ? 'Desconto' : a.kind === 'increase' ? 'Acréscimo' : 'Dispensa de encargos'} <b>{formatBRL(a.amount_cents)}</b>: {a.reason}</p>)}
        {hist.data && hist.data.payments.length + hist.data.adjustments.length === 0 && <p className="text-stone-400">Sem pagamentos ou ajustes.</p>}
      </div>
    </Sheet>
  );
};

// ------------------------------------------------------------------
// Plano: novo, reajuste, pausa, encerramento
// ------------------------------------------------------------------
const NewPlanSheet: React.FC<{ open: boolean; onClose: () => void; onDone: () => void }> = ({ open, onClose, onDone }) => {
  const today = useToday();
  const { settings } = useFinance();
  const { key, renew } = useRequestKey();
  const members = useAsync(() => (open ? listMembersWithoutPlan() : Promise.resolve([])), [open]);
  const holidays = useAsync(() => (open ? listHolidays() : Promise.resolve([])), [open]);
  const [profile, setProfile] = useState('');
  const [start, setStart] = useState<IsoDate>(firstOfMonth(today));
  const [period, setPeriod] = useState<1 | 3 | 6 | 12>(1);
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    if (!amount || !start) return null;
    const rule: DueRule = settings ? { dueDay: settings.due_day, monthOffset: settings.due_month_offset, nonBusinessRule: settings.non_business_rule } : CLUB_DEFAULT_DUE_RULE;
    const cal = buildCalendar((holidays.data ?? []).map((h) => ({ date: h.holiday_date, active: h.active })), settings?.saturday_is_business ?? false);
    return planCharges({ id: 'new', profileId: profile || 'x', startOn: start, endedOn: null, status: 'active', periodMonths: period }, [{ effectiveFrom: firstOfMonth(start), amountCents: amount }], [],
      generationHorizon(today, settings?.horizon_months ?? 1), rule, cal);
  }, [amount, start, period, holidays.data, settings, today, profile]);
  // Com o vencimento no mês cobrado, um vínculo que começou antes de hoje já gera cobranças vencidas: o admin precisa ver isso antes de criar.
  const overdue = preview ? preview.create.filter((c) => c.dueDate < today).length : 0;

  const save = async () => {
    setBusy(true);
    try {
      const plan = await createPlan({ profile_id: profile, start_on: start, amount_cents: amount, period_months: period }, key);
      const gen = await generateCharges(plan.id);
      notify.success('Mensalidade criada.', { description: `${gen.created} cobrança(s) gerada(s).` });
      renew(); onDone(); onClose();
    } catch (e) { notifyFinanceError(e, 'Não foi possível criar a mensalidade.', 'finance_plan_create_failed'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} wide title="Nova mensalidade" subtitle="Cada sócio tem o seu valor — não existe valor único para todos."
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy || !profile || !amount} onClick={save}>Criar e gerar cobranças</button></>}>
      {members.loading ? <Spinner /> : (
        <>
          <Field label="Sócio" hint="Só aparecem sócios ativos que ainda não têm mensalidade."><select className={inputCls} value={profile} onChange={(e) => setProfile(e.target.value)}><option value="">Escolha…</option>{(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor por período"><MoneyInput value={amount} onChange={setAmount} aria-label="Valor da mensalidade" /></Field>
            <Field label="Periodicidade"><select className={inputCls} value={period} onChange={(e) => setPeriod(Number(e.target.value) as 1 | 3 | 6 | 12)}><option value={1}>Mensal</option><option value={3}>Trimestral</option><option value={6}>Semestral</option><option value={12}>Anual</option></select></Field>
            <Field label="Início do vínculo" className="col-span-2"><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          </div>
          {preview && (
            <Notice tone={preview.create.length > 12 || overdue > 0 ? 'warn' : 'info'} title={`Serão geradas ${preview.create.length} cobrança(s)`}>
              {preview.create.length === 0 ? 'Nenhuma cobrança no período.' : <>De {monthLabel(preview.create[0].competenceMonth)} a {monthLabel(preview.create[preview.create.length - 1].competenceMonth)}; a primeira vence em {brDate(preview.create[0].dueDate)}.
                {overdue > 0 && (overdue === preview.create.length ? (overdue === 1 ? ' Ela já está vencida hoje.' : ' Todas já estão vencidas hoje.') : ` ${overdue === 1 ? '1 já está vencida' : `${overdue} já estão vencidas`} hoje.`)}
                {preview.create.length > 12 && ' Muitas competências passadas: confira se a data de início está certa.'}</>}
            </Notice>
          )}
        </>
      )}
    </Sheet>
  );
};

const PlanCard: React.FC<{ plan: PlanWithMember; onChanged: () => void }> = ({ plan, onChanged }) => {
  const today = useToday();
  const confirm = useConfirm();
  const { key, renew } = useRequestKey();
  const prices = useAsync(() => listPlanPrices(plan.id), [plan.id]);
  const [mode, setMode] = useState<null | 'price' | 'end' | 'prices'>(null);
  const [from, setFrom] = useState<IsoDate>(addMonths(firstOfMonth(today), 1));
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [endOn, setEndOn] = useState<IsoDate>(today);
  const [busy, setBusy] = useState(false);
  const current = prices.data ? priceFor(prices.data.map((p) => ({ effectiveFrom: p.effective_from, amountCents: p.amount_cents })), firstOfMonth(today)) : null;
  const ended = plan.status === 'ended';

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); notify.success(ok); renew(); setMode(null); prices.reload(); onChanged(); }
    catch (e) { notifyFinanceError(e, 'Não foi possível concluir.', 'finance_plan_action_failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className={`rounded-3xl border bg-white p-4 shadow-sm ${ended ? 'border-stone-100 opacity-70' : 'border-stone-100'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="truncate text-sm font-black text-stone-800">{plan.profile?.name ?? 'Sócio'}</p>
          <p className="text-xs text-stone-500">Desde {brDate(plan.start_on)} · {plan.period_months === 1 ? 'mensal' : `a cada ${plan.period_months} meses`}{plan.ended_on ? ` · encerrada em ${brDate(plan.ended_on)}` : ''}</p></div>
        <Badge tone={plan.status === 'active' ? 'good' : plan.status === 'paused' ? 'warn' : 'muted'}>{plan.status === 'active' ? 'Ativa' : plan.status === 'paused' ? 'Pausada' : 'Encerrada'}</Badge>
      </div>
      <p className="mt-2 text-lg font-black tabular-nums">{current !== null ? formatBRL(current) : '—'}<span className="text-xs font-medium text-stone-400"> vigente hoje</span></p>
      {plan.end_reason && <p className="text-xs text-stone-400">Motivo: {plan.end_reason}</p>}
      {!ended && mode === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => { renew(); setMode('price'); setAmount(null); setReason(''); }}>Reajustar valor</button>
          <button className={btnGhost} disabled={busy} onClick={() => run(() => updatePlan(plan.id, plan.version, { status: plan.status === 'active' ? 'paused' : 'active' }, key), plan.status === 'active' ? 'Mensalidade pausada.' : 'Mensalidade retomada.')}>{plan.status === 'active' ? 'Pausar' : 'Retomar'}</button>
          <button className={btnGhost} onClick={() => setMode('prices')}>Histórico de preços</button>
          <button className={btnDanger} onClick={() => { renew(); setMode('end'); setReason(''); }}><UserMinus size={16} /> Encerrar vínculo</button>
        </div>
      )}
      {ended && <button className={`${btnGhost} mt-3`} onClick={() => setMode(mode === 'prices' ? null : 'prices')}>Histórico de preços</button>}

      {mode === 'price' && (
        <div className="mt-3 space-y-3 rounded-2xl border border-saibro-200 p-3">
          <p className="text-sm font-black">Reajustar valor</p>
          <p className="text-xs text-stone-500">Vale da competência escolhida em diante. Cobranças anteriores — e as que já foram pagas ou ajustadas — não mudam.</p>
          <div className="grid grid-cols-2 gap-3"><Field label="Novo valor"><MoneyInput value={amount} onChange={setAmount} /></Field><Field label="A partir de"><input type="month" className={inputCls} value={from.slice(0, 7)} onChange={(e) => e.target.value && setFrom(`${e.target.value}-01`)} /></Field></div>
          <Field label="Motivo"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setMode(null)}>Voltar</button>
            <button className={btnPrimary} disabled={busy || !amount || reason.trim().length < 3} onClick={() => run(async () => { const r = await setPlanPrice(plan.id, from, amount!, reason.trim(), key); notify.info(`${r.repriced_charges} cobrança(s) futura(s) ainda intocada(s) passam ao novo valor.`); }, 'Valor reajustado.')}>Reajustar</button></div>
        </div>
      )}

      {mode === 'end' && (
        <div className="mt-3 space-y-3 rounded-2xl border border-red-200 p-3">
          <p className="text-sm font-black text-red-700">Encerrar vínculo</p>
          <p className="text-xs text-stone-500">Cobranças de períodos que começam depois da data e ainda sem pagamento são canceladas. Passado, pagamentos e histórico ficam intactos.</p>
          <div className="grid grid-cols-2 gap-3"><Field label="Último dia do vínculo"><input type="date" className={inputCls} value={endOn} onChange={(e) => setEndOn(e.target.value)} /></Field><Field label="Motivo"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setMode(null)}>Voltar</button>
            <button className={btnDanger} disabled={busy || reason.trim().length < 3} onClick={async () => {
              if (!await confirm({ tone: 'warning', title: 'Encerrar este vínculo?', description: 'As cobranças futuras sem pagamento serão canceladas.', confirmLabel: 'Encerrar' })) return;
              await run(async () => { const r = await endPlan(plan.id, endOn, reason.trim(), key); notify.info(`${r.canceled_charges} cobrança(s) futura(s) cancelada(s).`); }, 'Vínculo encerrado.');
            }}>Encerrar</button></div>
        </div>
      )}

      {mode === 'prices' && (
        <ul className="mt-3 space-y-1 text-xs text-stone-600">
          {(prices.data ?? []).map((p) => <li key={p.id} className="flex justify-between"><span>desde {monthLabel(p.effective_from)}{p.reason ? ` — ${p.reason}` : ''}</span><b className="tabular-nums">{formatBRL(p.amount_cents)}</b></li>)}
        </ul>
      )}
    </div>
  );
};

// ------------------------------------------------------------------
// Créditos (excedente / duplicado)
// ------------------------------------------------------------------
const CreditsPanel: React.FC = () => {
  const { accounts } = useFinance();
  const credits = useAsync(() => listCredits(), []);
  const [sel, setSel] = useState<MemberCreditRow | null>(null);
  const [action, setAction] = useState<'apply' | 'refund' | 'void'>('apply');
  const [charge, setCharge] = useState('');
  const [account, setAccount] = useState('');
  const [reason, setReason] = useState('');
  const { key, renew } = useRequestKey();
  const [busy, setBusy] = useState(false);
  const open = (credits.data ?? []).filter((c) => c.status === 'open');
  const owners = [...new Set(open.map((c) => c.profile_id))];
  const names = useAsync(() => profileNames(owners), [owners.join(',')]);
  // Só as cobranças do sócio escolhido: não depende de a cobrança estar entre as mais recentes do clube.
  const charges = useAsync(() => (sel ? listCharges({ profileId: sel.profile_id, chargeType: 'membership' }, 1000) : Promise.resolve([])), [sel?.profile_id]);
  const targets = (charges.data ?? []).filter((c) => sel && c.profile_id === sel.profile_id && c.total_due_cents > 0 && c.display_status !== 'canceled');
  const who = (profileId: string) => names.data?.[profileId] ?? 'Sócio';

  const submit = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      await resolveCredit(sel.id, action, action === 'apply' ? { charge_id: charge } : action === 'refund' ? { account_id: account, reason } : { reason }, key);
      notify.success('Crédito resolvido.'); renew(); setSel(null); credits.reload(); charges.reload();
    } catch (e) { notifyFinanceError(e, 'Não foi possível resolver o crédito.', 'finance_credit_failed'); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Créditos de sócios" subtitle="Pagamento a mais ou repetido: o valor é guardado aqui, nunca descartado.">
      {credits.loading ? <Spinner /> : open.length === 0 ? <Empty title="Nenhum crédito em aberto" /> : (
        <div className="space-y-2">{open.map((c) => (
          <Row key={c.id} onClick={() => { renew(); setSel(c); setAction('apply'); setCharge(''); setAccount(accounts.find((a) => a.active)?.id ?? ''); setReason(''); }}>
            <div className="flex items-center justify-between"><span className="text-sm font-bold">{who(c.profile_id)}</span><span className="font-black tabular-nums">{formatBRL(c.remaining_cents)}</span></div>
            <p className="text-xs text-stone-500">{c.reason === 'duplicate' ? 'Pagamento duplicado' : 'Pagamento a mais'} · {brDate(c.created_at.slice(0, 10))}</p>
          </Row>
        ))}</div>
      )}
      <Sheet open={!!sel} onClose={() => setSel(null)} title="Resolver crédito" subtitle={sel ? `${who(sel.profile_id)} — ${formatBRL(sel.remaining_cents)}` : ''}
        footer={<><button className={btnGhost} onClick={() => setSel(null)}>Cancelar</button><button className={btnPrimary} disabled={busy || (action === 'apply' && !charge) || (action === 'refund' && (!account || reason.trim().length < 3)) || (action === 'void' && reason.trim().length < 5)} onClick={submit}>Confirmar</button></>}>
        <Field label="O que fazer"><select className={inputCls} value={action} onChange={(e) => setAction(e.target.value as 'apply')}><option value="apply">Aplicar numa cobrança do sócio</option><option value="refund">Devolver o dinheiro (saída de caixa)</option><option value="void">Baixar com justificativa</option></select></Field>
        {action === 'apply' && <Field label="Cobrança"><select className={inputCls} value={charge} onChange={(e) => setCharge(e.target.value)}><option value="">{charges.loading ? 'Carregando…' : 'Escolha…'}</option>{targets.map((t) => <option key={t.charge_id} value={t.charge_id}>{monthLabel(t.competence_month)} — {formatBRL(t.total_due_cents)}</option>)}</select></Field>}
        {action === 'refund' && <><Field label="Conta de onde saiu"><select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field><Field label="Observação"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></>}
        {action === 'void' && <Field label="Justificativa (obrigatória)"><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      </Sheet>
    </Card>
  );
};

// ------------------------------------------------------------------
// Aba
// ------------------------------------------------------------------
const MembersTab: React.FC = () => {
  const today = useToday();
  const [view, setView] = useState('charges');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [compFrom, setCompFrom] = useState('');
  const [compTo, setCompTo] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [sel, setSel] = useState<ChargeStatementRow | null>(null);
  const [newPlan, setNewPlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const { key, renew } = useRequestKey();

  // A busca por nome NÃO vai ao banco: lá a comparação é sensível a acento ("joao" não acha "João").
  // Com busca ativa a tela traz o máximo de linhas de uma vez e filtra aqui, sem acento e sem maiúsculas;
  // digitar mais letras não refaz a consulta.
  const searching = search.trim() !== '';
  const filters = { status, competenceFrom: compFrom ? `${compFrom}-01` : undefined, competenceTo: compTo ? `${compTo}-01` : undefined, dueFrom: dueFrom || undefined, dueTo: dueTo || undefined, chargeType: 'membership' as const };
  const charges = useAsync(() => listCharges(filters, searching ? SEARCH_LIMIT : LIST_LIMIT), [searching, status, compFrom, compTo, dueFrom, dueTo]);
  const plans = useAsync(() => listPlans(), []);

  const loaded = useMemo(() => charges.data ?? [], [charges.data]);
  const rows = useMemo(() => (searching ? loaded.filter((r) => matchesSearch(search, r.profile_name)) : loaded), [loaded, search, searching]);
  const totalCount = loaded[0]?.total_count ?? 0;
  const truncated = totalCount > loaded.length;
  const totals = useMemo(() => ({
    due: rows.filter((r) => r.display_status !== 'paid' && r.display_status !== 'canceled').reduce((s, r) => s + r.total_due_cents, 0),
    overdue: rows.filter((r) => r.display_status === 'overdue').reduce((s, r) => s + r.total_due_cents, 0),
  }), [rows]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await generateCharges(null, key);
      notify.success(r.created ? `${r.created} cobrança(s) gerada(s).` : 'Nada novo a gerar — tudo já está gerado.', { description: r.missing_price ? `${r.missing_price} competência(s) sem preço definido não foram geradas.` : undefined });
      renew(); charges.reload(); plans.reload();
    } catch (e) { notifyFinanceError(e, 'Não foi possível gerar as cobranças.', 'finance_generate_failed'); }
    finally { setBusy(false); }
  };

  // A tela mostra até 300 linhas; o arquivo leva TODAS as do filtro (até 5.000), com os mesmos totais da consulta.
  const spec = async () => chargesSpec(!searching && truncated ? await listCharges(filters, 5000) : rows, {
    generatedAt: new Date().toISOString(), period: null,
    filters: [
      { label: 'Situação', value: STATUS_FILTERS.find((s) => s[0] === status)?.[1] ?? 'Todas' }, { label: 'Busca', value: search || '—' },
      { label: 'Competência', value: compFrom || compTo ? `${compFrom || '…'} a ${compTo || '…'}` : 'todas' }, { label: 'Vencimento', value: dueFrom || dueTo ? `${dueFrom || '…'} a ${dueTo || '…'}` : 'todos' },
      { label: 'Posição em', value: brDate(today) },
    ],
  });

  return (
    <div className="space-y-4">
      <SectionTabs label="Mensalidades" value={view} onChange={setView} items={[{ id: 'charges', label: 'Cobranças' }, { id: 'plans', label: 'Sócios e valores' }, { id: 'credits', label: 'Créditos' }]} />

      {view === 'charges' && (
        <>
          <Card title="Cobranças" subtitle="Valor original, encargos e total atualizado de cada mensalidade."
            right={<button className={btnGhost} disabled={busy} onClick={generate}><CalendarPlus size={16} /> Gerar cobranças</button>}>
            <div className="space-y-3">
              <AdminSearch value={search} onChange={setSearch} placeholder="Buscar sócio…" label="Buscar sócio" />
              <SectionTabs label="Situação" value={status} onChange={setStatus} items={STATUS_FILTERS.map(([id, label]) => ({ id, label }))} />
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Field label="Competência de"><input type="month" className={inputCls} value={compFrom} onChange={(e) => setCompFrom(e.target.value)} /></Field>
                <Field label="Competência até"><input type="month" className={inputCls} value={compTo} onChange={(e) => setCompTo(e.target.value)} /></Field>
                <Field label="Vence de"><input type="date" className={inputCls} value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} /></Field>
                <Field label="Vence até"><input type="date" className={inputCls} value={dueTo} onChange={(e) => setDueTo(e.target.value)} /></Field>
              </div>
            </div>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-stone-500">{!searching && truncated ? `Mostrando ${rows.length} de ${totalCount}` : `${rows.length} cobrança(s)`} · a receber <span className="text-stone-800">{formatBRL(totals.due)}</span> · vencido <span className="text-red-600">{formatBRL(totals.overdue)}</span></p>
            <ExportButtons getSpec={spec} disabled={rows.length === 0} />
          </div>
          {searching && truncated && !charges.loading && <Notice tone="warn">A busca olhou as {loaded.length.toLocaleString('pt-BR')} cobranças mais recentes de {totalCount.toLocaleString('pt-BR')}. Para achar as mais antigas, restrinja por competência ou vencimento.</Notice>}
          {charges.error ? <ErrorBlock error={charges.error} onRetry={charges.reload} /> : charges.loading ? <Spinner /> : rows.length === 0 ? (
            searching
              ? <Empty title={`Nenhuma cobrança de “${search.trim()}”`} hint="Confira o nome ou troque a situação e as datas — os filtros abaixo da busca também valem." />
              : <Empty title="Nenhuma cobrança com estes filtros" hint="Cadastre a mensalidade de um sócio em “Sócios e valores” e use “Gerar cobranças”." />
          ) : (
            <div className="space-y-2">{rows.map((r) => (
              <Row key={r.charge_id} onClick={() => setSel(r)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-sm font-black text-stone-800">{r.profile_name}</p><p className="text-xs capitalize text-stone-500">{monthLabel(r.competence_month)} · vence {brDate(r.due_date)}{r.days_late > 0 && r.display_status !== 'paid' && r.display_status !== 'canceled' ? ` · ${r.days_late} dia(s) de atraso` : ''}</p></div>
                  <div className="text-right"><ChargeStatusBadge status={r.display_status} /><p className="mt-1 text-sm font-black tabular-nums">{r.display_status === 'paid' || r.display_status === 'canceled' ? formatBRL(r.original_amount_cents) : formatBRL(r.total_due_cents)}</p></div>
                </div>
              </Row>
            ))}</div>
          )}
        </>
      )}

      {view === 'plans' && (
        <>
          <div className="flex items-center justify-between"><p className="text-sm font-bold text-stone-600">Mensalidade individual de cada sócio</p><button className={btnPrimary} onClick={() => setNewPlan(true)}><Plus size={16} /> Nova</button></div>
          {plans.error ? <ErrorBlock error={plans.error} onRetry={plans.reload} /> : plans.loading ? <Spinner /> : (plans.data ?? []).length === 0 ? (
            <Empty icon={<CreditCard size={32} />} title="Nenhuma mensalidade cadastrada" hint="Defina o valor de cada sócio. Não há valor padrão para todos." />
          ) : <div className="grid gap-3 md:grid-cols-2">{(plans.data ?? []).map((p) => <PlanCard key={p.id} plan={p} onChanged={() => { plans.reload(); charges.reload(); }} />)}</div>}
          <NewPlanSheet open={newPlan} onClose={() => setNewPlan(false)} onDone={() => { plans.reload(); charges.reload(); }} />
        </>
      )}

      {view === 'credits' && <CreditsPanel />}
      <ChargeSheet charge={sel} onClose={() => setSel(null)} onChanged={() => { charges.reload(); setSel(null); }} />
    </div>
  );
};

export default MembersTab;
