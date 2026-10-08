/**
 * Configurações do financeiro. Nenhum valor de multa, juros ou carência
 * vem preenchido: o clube decide. Até a política de encargos ser CONFIRMADA
 * (inclusive a escolha "não cobrar encargos"), nenhuma multa ou juro é calculada.
 *
 * A régua das pendências de sócio (dias, PIX, encargos próprios) NÃO fica aqui:
 * mora em Receber › Pendências › "Configurar régua", junto do que ela cobra.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BellRing, CalendarDays, History, Percent, Settings2 } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { useConfirm } from '../../../hooks/useConfirm';
import { notifyFinanceError } from '../../../lib/finance/errors';
import { listAudit, listHolidays, saveHoliday, saveSettings, seedHolidays } from '../../../lib/finance/financeApi';
import type { FinHoliday, FinSettings } from '../../../lib/finance/types';
import { buildCalendar, computeDueDate, type NonBusinessRule } from '../../../lib/finance/calendar';
import { computeStatement, type FeePolicy } from '../../../lib/finance/lateFees';
import { addDays, addMonths, brDate, firstOfMonth, monthLabel } from '../../../lib/finance/dates';
import { formatBRL, parseBRL } from '../../../lib/finance/money';
import { useAsync, useRequestKey, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import { Badge, Card, Empty, ErrorBlock, Field, MoneyInput, Notice, Row, SectionTabs, Spinner, btnGhost, btnPrimary, inputCls } from '../ui';

/** "2" → 200 pontos-base; "0,033" → 3; vazio → null. `NaN` se inválido. */
const percentToBps = (text: string): number | null => {
  if (!text.trim()) return null;
  const n = parseBRL(text.trim().replace('%', ''));
  return n === null ? Number.NaN : Math.round((n / 100) * 100);
};
const bpsToText = (bps: number | null) => (bps === null ? '' : (bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false }));

// ------------------------------------------------------------------
// Vencimento
// ------------------------------------------------------------------
const DueSection: React.FC<{ s: FinSettings; holidays: FinHoliday[]; onSaved: () => void }> = ({ s, holidays, onSaved }) => {
  const today = useToday();
  const { key, renew } = useRequestKey();
  const [dueDay, setDueDay] = useState(String(s.due_day));
  const [offset, setOffset] = useState(String(s.due_month_offset));
  const [rule, setRule] = useState<NonBusinessRule>(s.non_business_rule);
  const [saturday, setSaturday] = useState(s.saturday_is_business);
  const [horizon, setHorizon] = useState(String(s.horizon_months));
  const [busy, setBusy] = useState(false);

  const cal = useMemo(() => buildCalendar(holidays.map((h) => ({ date: h.holiday_date, active: h.active })), saturday), [holidays, saturday]);
  const preview = useMemo(() => {
    const day = Number(dueDay);
    if (!(day >= 1 && day <= 31)) return [];
    return [0, 1, 2, 3].map((i) => {
      const comp = addMonths(firstOfMonth(today), i);
      return { comp, ...computeDueDate(comp, 1, { dueDay: day, monthOffset: Number(offset), nonBusinessRule: rule }, cal) };
    });
  }, [dueDay, offset, rule, cal, today]);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings(s.version, { due_day: Number(dueDay), due_month_offset: Number(offset), non_business_rule: rule, saturday_is_business: saturday, horizon_months: Number(horizon) }, key);
      notify.success('Regra de vencimento salva. Vale para as próximas cobranças geradas.'); renew(); onSaved();
    } catch (e) { notifyFinanceError(e, 'Não foi possível salvar.', 'finance_settings_save_failed'); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Vencimento das mensalidades" subtitle="Vale para cobranças novas; as já geradas mantêm a data.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dia do vencimento"><input inputMode="numeric" className={inputCls} value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
        <Field label="Vence no"><select className={inputCls} value={offset} onChange={(e) => setOffset(e.target.value)}><option value="0">mesmo mês cobrado</option><option value="1">mês seguinte ao cobrado</option><option value="2">2º mês seguinte</option></select></Field>
        <Field label="Se cair em dia não útil" className="col-span-2"><select className={inputCls} value={rule} onChange={(e) => setRule(e.target.value as NonBusinessRule)}><option value="next_business_day">Vai para o próximo dia útil</option><option value="previous_business_day">Vai para o dia útil anterior</option><option value="keep">Mantém a data</option></select></Field>
        <Field label="Cobranças geradas à frente" hint="Meses futuros já previstos."><input inputMode="numeric" className={inputCls} value={horizon} onChange={(e) => setHorizon(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm font-bold text-stone-700"><input type="checkbox" className="h-5 w-5" checked={saturday} onChange={(e) => setSaturday(e.target.checked)} />Sábado é dia útil</label>
      </div>
      <div className="mt-3 space-y-1 rounded-2xl bg-stone-50 p-3 text-xs text-stone-600">
        <p className="font-black text-stone-500">Prévia (com os feriados ativos abaixo)</p>
        {preview.map((p) => <p key={p.comp}>Mensalidade de <b className="capitalize">{monthLabel(p.comp)}</b> vence em <b>{brDate(p.due)}</b>{p.adjusted ? ` (dia ${brDate(p.nominal).slice(0, 5)} não é útil)` : ''}</p>)}
      </div>
      <div className="mt-3"><button className={btnPrimary} disabled={busy || !(Number(dueDay) >= 1 && Number(dueDay) <= 31) || Number(horizon) < 1} onClick={save}>Salvar vencimento</button></div>
    </Card>
  );
};

// ------------------------------------------------------------------
// Encargos de atraso
// ------------------------------------------------------------------
const FeesSection: React.FC<{ s: FinSettings; onSaved: () => void }> = ({ s, onSaved }) => {
  const confirm = useConfirm();
  const { key, renew } = useRequestKey();
  const confirmed = !!s.late_fee_confirmed_at;
  const [grace, setGrace] = useState(String(s.grace_days));
  const [fineFixed, setFineFixed] = useState<number | null>(s.fine_fixed_cents);
  const [finePct, setFinePct] = useState(bpsToText(s.fine_percent_bps));
  const [intFixed, setIntFixed] = useState<number | null>(s.interest_daily_fixed_cents);
  const [intPct, setIntPct] = useState(bpsToText(s.interest_daily_percent_bps));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [simPrincipal, setSimPrincipal] = useState<number | null>(null);
  const [simDays, setSimDays] = useState('10');

  useEffect(() => {
    setGrace(String(s.grace_days)); setFineFixed(s.fine_fixed_cents); setFinePct(bpsToText(s.fine_percent_bps));
    setIntFixed(s.interest_daily_fixed_cents); setIntPct(bpsToText(s.interest_daily_percent_bps));
  }, [s.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const fb = percentToBps(finePct);
  const ib = percentToBps(intPct);
  const invalid = Number.isNaN(fb) || Number.isNaN(ib) || !(Number(grace) >= 0);
  const policy: FeePolicy = { confirmed: true, graceDays: Number(grace) || 0, fineFixedCents: fineFixed, finePercentBps: Number.isNaN(fb) ? null : fb, interestDailyFixedCents: intFixed, interestDailyPercentBps: Number.isNaN(ib) ? null : ib };
  const any = fineFixed || (fb && !Number.isNaN(fb)) || intFixed || (ib && !Number.isNaN(ib));
  const changed = confirmed && (Number(grace) !== s.grace_days || (fineFixed ?? null) !== s.fine_fixed_cents || (fb ?? null) !== s.fine_percent_bps || (intFixed ?? null) !== s.interest_daily_fixed_cents || (ib ?? null) !== s.interest_daily_percent_bps);

  const sim = useMemo(() => {
    if (!simPrincipal || invalid) return null;
    const due = '2026-01-10';
    return computeStatement({ originalCents: simPrincipal, dueDate: due, payments: [] }, policy, addDays(due, policy.graceDays + (Number(simDays) || 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simPrincipal, simDays, grace, fineFixed, finePct, intFixed, intPct]);

  const persist = async (data: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try { await saveSettings(s.version, data, key); notify.success(ok); renew(); setReason(''); onSaved(); }
    catch (e) { notifyFinanceError(e, 'Não foi possível salvar.', 'finance_settings_save_failed'); }
    finally { setBusy(false); }
  };

  const values = () => ({ grace_days: Number(grace) || 0, fine_fixed_cents: fineFixed, fine_percent_bps: Number.isNaN(fb) ? null : fb, interest_daily_fixed_cents: intFixed, interest_daily_percent_bps: Number.isNaN(ib) ? null : ib });

  const confirmPolicy = async () => {
    if (!any && !await confirm({ tone: 'warning', title: 'Confirmar que o clube NÃO cobra encargos?', description: 'Mensalidades vencidas não terão multa nem juros. Você pode mudar isso depois, com justificativa.', confirmLabel: 'Confirmar sem encargos' })) return;
    if (any && !await confirm({ tone: 'warning', title: 'Confirmar esta política de encargos?', description: 'Passa a valer para mensalidades em atraso (inclusive as já vencidas): o que o sócio deve é recalculado. Não há valores padrão — estes são os que você digitou.', confirmLabel: 'Confirmar política' })) return;
    await persist({ ...values(), late_fee_confirmed: true }, 'Política de encargos confirmada.');
  };

  return (
    <Card title="Encargos de atraso" subtitle="Multa e juros. O clube define; não há valor padrão." right={<Badge tone={confirmed ? 'good' : 'warn'}>{confirmed ? 'Confirmada' : 'Não configurada'}</Badge>}>
      {!confirmed && <div className="mb-3"><Notice tone="warn" title="Sem política confirmada">Enquanto não confirmar, mensalidades vencidas <b>não recebem multa nem juros</b> e os sócios veem “encargos ainda não definidos”.</Notice></div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Carência (dias)" hint="Dias após o vencimento sem encargo."><input inputMode="numeric" className={inputCls} value={grace} onChange={(e) => setGrace(e.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>
        <div />
        <Field label="Multa fixa (R$)" hint="Cobrada uma vez, no 1º dia de atraso."><MoneyInput value={fineFixed} onChange={setFineFixed} /></Field>
        <Field label="Multa (% do valor em aberto)" hint="Soma-se à multa fixa."><input inputMode="decimal" className={inputCls} value={finePct} placeholder="0" onChange={(e) => setFinePct(e.target.value)} aria-invalid={Number.isNaN(fb)} /></Field>
        <Field label="Juros fixos por dia (R$)"><MoneyInput value={intFixed} onChange={setIntFixed} /></Field>
        <Field label="Juros por dia (%)" hint="Sobre o principal em aberto. Até 2 casas decimais (ex.: 0,03)."><input inputMode="decimal" className={inputCls} value={intPct} placeholder="0" onChange={(e) => setIntPct(e.target.value)} aria-invalid={Number.isNaN(ib)} /></Field>
      </div>
      <div className="mt-3"><Notice tone="info" title="Como o cálculo funciona">Juros <b>simples</b> por dia de atraso, sobre o principal em aberto no início do dia. Multa e juros nunca entram na base de cálculo (sem juros sobre juros). Um pagamento abate primeiro a multa, depois os juros, depois o principal.</Notice></div>

      <div className="mt-3 space-y-2 rounded-2xl border border-stone-100 p-3">
        <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Simulador (não grava nada)</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mensalidade (R$)"><MoneyInput value={simPrincipal} onChange={setSimPrincipal} /></Field>
          <Field label="Dias além da carência"><input inputMode="numeric" className={inputCls} value={simDays} onChange={(e) => setSimDays(e.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>
        </div>
        {sim ? (
          <p className="text-sm">Multa <b>{formatBRL(sim.fineDueCents)}</b> + juros <b>{formatBRL(sim.interestDueCents)}</b> → total a pagar <b>{formatBRL(sim.totalDueCents)}</b></p>
        ) : <p className="text-xs text-stone-400">Informe um valor para ver quanto o sócio pagaria.</p>}
      </div>

      {confirmed && changed && <Field label="Justificativa da mudança (obrigatória)" className="mt-3" hint="Mudar encargo altera o que o sócio deve."><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!confirmed ? (
          <button className={btnPrimary} disabled={busy || invalid} onClick={confirmPolicy}>{any ? 'Confirmar política de encargos' : 'Confirmar: sem encargos'}</button>
        ) : (
          <>
            <button className={btnPrimary} disabled={busy || invalid || !changed || reason.trim().length < 5} onClick={() => persist({ ...values(), reason: reason.trim() }, 'Encargos atualizados.')}>Salvar alteração</button>
          </>
        )}
      </div>
    </Card>
  );
};

// ------------------------------------------------------------------
// Outras opções
// ------------------------------------------------------------------
const OptionsSection: React.FC<{ s: FinSettings; onSaved: () => void }> = ({ s, onSaved }) => {
  const { key, renew } = useRequestKey();
  const [price, setPrice] = useState<number | null>(s.day_card_price_cents);
  const [inCash, setInCash] = useState(s.day_card_in_cash);
  const [payees, setPayees] = useState(s.payee_names.join('\n'));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await saveSettings(s.version, { day_card_price_cents: price ?? 0, day_card_in_cash: inCash, payee_names: payees.split('\n').map((x) => x.trim()).filter(Boolean) }, key);
      notify.success('Opções salvas.'); renew(); onSaved();
    } catch (e) { notifyFinanceError(e, 'Não foi possível salvar.', 'finance_settings_save_failed'); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Day Card e comprovantes">
      <div className="space-y-3">
        <Field label="Valor do Day Card (R$)" hint="Taxa do convidado de um sócio (acesso ao clube por um dia). Vale por reserva com convidado. Card Mensal e Aula avulsa dos alunos valem o que foi pago e registrado no cadastro do aluno."><MoneyInput value={price} onChange={setPrice} /></Field>
        <label className="flex min-h-11 items-start gap-2 text-sm font-bold text-stone-700"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={inCash} onChange={(e) => setInCash(e.target.checked)} />Contar o Day Card como entrada no fluxo de caixa <span className="font-normal text-stone-400">(desligado: o Day Card é derivado da reserva, sem pagamento registrado, e só conta no DRE)</span></label>
        <Field label="Nomes do clube em comprovantes (um por linha)" hint="O favorecido lido no comprovante precisa conter um destes nomes inteiro para haver baixa automática. Vazio = nenhum comprovante é baixado automaticamente; todos vão para análise."><textarea className={inputCls} rows={3} value={payees} onChange={(e) => setPayees(e.target.value)} /></Field>
        <button className={btnPrimary} disabled={busy || price === null} onClick={save}>Salvar</button>
      </div>
    </Card>
  );
};

// ------------------------------------------------------------------
// Feriados
// ------------------------------------------------------------------
const HolidaysSection: React.FC<{ holidays: FinHoliday[]; onChanged: () => void }> = ({ holidays, onChanged }) => {
  const today = useToday();
  const { key, renew } = useRequestKey();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'municipal' | 'state' | 'club'>('municipal');
  const [busy, setBusy] = useState(false);
  const list = holidays.filter((h) => h.holiday_date.startsWith(String(year)));

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); notify.success(ok); renew(); onChanged(); }
    catch (e) { notifyFinanceError(e, 'Não foi possível salvar o feriado.', 'finance_holiday_failed'); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Calendário de feriados" subtitle="O vencimento só pula sábado e domingo. Marque um feriado para que ele também seja pulado." right={<CalendarDays size={18} className="text-stone-300" />}>
      <div className="mb-3 flex items-center gap-2">
        <button className={btnGhost} aria-label="Ano anterior" onClick={() => setYear((y) => y - 1)}>‹</button><span className="min-w-14 text-center text-sm font-black">{year}</span><button className={btnGhost} aria-label="Próximo ano" onClick={() => setYear((y) => y + 1)}>›</button>
        <button className={btnGhost} disabled={busy} onClick={() => run(() => seedHolidays(year, key), `Feriados nacionais de ${year} carregados (desativados: ative os que o vencimento deve pular).`)}>Carregar nacionais de {year}</button>
      </div>
      {list.length === 0 ? <Empty title={`Sem feriados em ${year}`} hint="Carregue os nacionais para consultar e cadastre os municipais. Nenhum conta até você ativar." /> : (
        <ul className="space-y-1.5">
          {list.map((h) => (
            <li key={h.id}>
              <Row>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-sm font-bold">{brDate(h.holiday_date)} · {h.name}</p><p className="text-[11px] text-stone-400">{h.scope === 'national' ? 'Nacional' : h.scope === 'state' ? 'Estadual' : h.scope === 'municipal' ? 'Municipal' : 'Do clube'}{h.kind === 'optional' ? ' · ponto facultativo' : ''}</p></div>
                  <label className="flex min-h-11 items-center gap-2 text-xs font-bold text-stone-600"><input type="checkbox" className="h-5 w-5" checked={h.active} disabled={busy} onChange={(e) => run(() => saveHoliday(h.id, { active: e.target.checked }, key), 'Feriado atualizado.')} />Conta como feriado</label>
                </div>
              </Row>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3 rounded-2xl border border-stone-100 p-3">
        <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">Adicionar feriado local</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Tipo"><select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}><option value="municipal">Municipal</option><option value="state">Estadual</option><option value="club">Do clube</option></select></Field>
          <Field label="Nome" className="col-span-2"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <button className={btnPrimary} disabled={busy || !date || name.trim().length < 2} onClick={() => run(async () => { await saveHoliday(null, { holiday_date: date, name: name.trim(), scope }, key); setDate(''); setName(''); }, 'Feriado cadastrado.')}>Adicionar</button>
      </div>
    </Card>
  );
};

// ------------------------------------------------------------------
// Auditoria
// ------------------------------------------------------------------
const AUDIT_TABLES = [['', 'Tudo'], ['fin_settings', 'Configurações'], ['fin_member_charges', 'Mensalidades e pendências'], ['fin_charge_adjustments', 'Descontos e dispensas'], ['fin_charge_payments', 'Pagamentos'], ['fin_receipt_submissions', 'Comprovantes'], ['fin_entries', 'Lançamentos']] as const;

const AuditSection: React.FC = () => {
  const [table, setTable] = useState('');
  const audit = useAsync(() => listAudit(100, table || undefined), [table]);
  return (
    <Card title="Auditoria financeira" subtitle="Quem fez o quê e quando (últimos 100 registros)" right={<History size={18} className="text-stone-300" />}>
      <select className={`${inputCls} mb-3`} aria-label="Filtrar por área" value={table} onChange={(e) => setTable(e.target.value)}>{AUDIT_TABLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {audit.error ? <ErrorBlock error={audit.error} onRetry={audit.reload} /> : audit.loading ? <Spinner /> : (audit.data ?? []).length === 0 ? <Empty title="Nenhum registro" /> : (
        <ul className="space-y-1.5">
          {audit.data!.map((a) => (
            <li key={a.id}><Row>
              <p className="text-xs font-bold text-stone-700">{new Date(a.occurred_at).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short' })} · {a.action}</p>
              <p className="text-[11px] text-stone-500">{a.actor_name_snapshot ?? 'sistema'}{a.target_name_snapshot ? ` → ${a.target_name_snapshot}` : ''}{a.table_name ? ` · ${a.table_name}` : ''}{a.changed_fields?.length ? ` · campos: ${a.changed_fields.join(', ')}` : ''}</p>
            </Row></li>
          ))}
        </ul>
      )}
    </Card>
  );
};

// ------------------------------------------------------------------
const SettingsTab: React.FC = () => {
  const { settings, reload, go } = useFinance();
  const [view, setView] = useState('rules');
  const holidays = useAsync(() => listHolidays(), []);
  if (!settings) return <Spinner />;
  const reloadAll = () => { reload(); holidays.reload(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-stone-600"><Settings2 size={18} /><p className="text-sm font-bold">Configurações do financeiro</p></div>
      <SectionTabs label="Seção" value={view} onChange={setView} items={[{ id: 'rules', label: 'Cobrança' }, { id: 'calendar', label: 'Feriados' }, { id: 'options', label: 'Day Card e comprovantes' }, { id: 'audit', label: 'Auditoria' }]} />
      {view === 'rules' && (
        <>
          <DueSection s={settings} holidays={holidays.data ?? []} onSaved={reloadAll} />
          <FeesSection s={settings} onSaved={reloadAll} />
          <Notice tone="info">
            <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-start gap-1.5"><BellRing size={14} className="mt-0.5 shrink-0" />A régua de pendências de sócios (dias de envio, PIX, multa e juros) fica em Receber › Pendências.</span>
              <button className={`${btnGhost} w-full shrink-0 sm:w-auto`} onClick={() => go('pendencies')}>Abrir Pendências <ArrowRight size={16} /></button>
            </span>
          </Notice>
          <Notice tone="info"><span className="flex items-start gap-1.5"><Percent size={14} className="mt-0.5 shrink-0" />Descontos e dispensas de encargo são feitos cobrança a cobrança (aba Mensalidades), sempre com justificativa e registro de quem autorizou.</span></Notice>
        </>
      )}
      {view === 'calendar' && (holidays.error ? <ErrorBlock error={holidays.error} onRetry={holidays.reload} /> : <HolidaysSection holidays={holidays.data ?? []} onChanged={holidays.reload} />)}
      {view === 'options' && <OptionsSection s={settings} onSaved={reloadAll} />}
      {view === 'audit' && <AuditSection />}
    </div>
  );
};

export default SettingsTab;
