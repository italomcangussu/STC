/**
 * Receber › Pendências de sócio: cobranças manuais (Day Card não lançado,
 * consumo, evento, reposição…) com régua de cobrança pelo WhatsApp. A régua
 * (dias, PIX, carência, multa/juros) se configura AQUI, em "Configurar régua";
 * o resumo da aba é lido das configurações salvas, não é texto fixo.
 */
import React, { useMemo, useState } from 'react';
import { BellRing, PauseCircle, PlayCircle, Plus, Send, Settings2 } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { notifyFinanceError } from '../../../lib/finance/errors';
import {
  cancelCharge, createMemberPendency, listActiveMembers, listCharges, listPendencyMeta,
  registerPayment, sendPendencyNow, setPendencyCollection,
} from '../../../lib/finance/financeApi';
import type { ChargeStatementRow, FinSettings, MemberPendencyKind, MemberPendencyMeta } from '../../../lib/finance/types';
import { brDate, firstOfMonth, monthLabel, type IsoDate } from '../../../lib/finance/dates';
import { formatBRL } from '../../../lib/finance/money';
import { matchesSearch } from '../../../lib/searchText';
import { useAsync, useRequestKey, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import { AdminSearch } from '../../admin/ui';
import { Badge, Card, ChargeStatusBadge, Empty, Field, MoneyInput, Notice, Row, SectionTabs, Sheet, Spinner, btnDanger, btnGhost, btnPrimary, inputCls } from '../ui';
import PendencyRulesSection from './PendencyRulesSection';

const KINDS: Array<[MemberPendencyKind, string]> = [
  ['day_card', 'Day Card'],
  ['consumo', 'Consumo'],
  ['evento', 'Evento'],
  ['multa', 'Multa'],
  ['dano_reposicao', 'Dano / reposição'],
  ['outros', 'Outros'],
];
const METHODS = [['pix', 'Pix'], ['transfer', 'Transferência'], ['cash', 'Dinheiro'], ['card', 'Cartão'], ['other', 'Outro']] as const;
const STATUS = [['', 'Todas'], ['overdue', 'Vencidas'], ['open', 'Em aberto'], ['partial', 'Parciais'], ['in_review', 'Em análise'], ['paid', 'Pagas'], ['canceled', 'Canceladas']] as const;

/** Pendências carregadas de uma vez (a lista e os totais de saldo saem delas); acima disso a tela avisa. */
const LIST_LIMIT = 5000;

type ViewRow = ChargeStatementRow & { meta: MemberPendencyMeta };

/** [0, 3, 7] → "No vencimento, +3 e +7 dias". */
const reminderDaysText = (days: number[]) => {
  const parts = days.map((d) => (d === 0 ? 'no vencimento' : `+${d}`));
  if (!parts.length) return 'Nenhum envio';
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
  const text = days[days.length - 1] === 0 ? joined : `${joined} dias`;
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const feeText = (fixed: number, bps: number) => [fixed ? formatBRL(fixed) : null, bps ? pct(bps) : null].filter(Boolean).join(' + ');

/** Resumo VIVO da régua (lido de `settings`), com o atalho para configurar. */
const RulesSummary: React.FC<{ s: FinSettings | null; onConfigure: () => void }> = ({ s, onConfigure }) => {
  const configure = <button className={`${btnGhost} w-full sm:w-auto`} onClick={onConfigure}><Settings2 size={16} /> Configurar</button>;
  if (!s) return <Card title="Régua de cobrança" right={configure}><Spinner /></Card>;
  const fine = feeText(s.pendency_fine_fixed_cents, s.pendency_fine_percent_bps);
  const interest = feeText(s.pendency_interest_daily_fixed_cents, s.pendency_interest_daily_percent_bps);
  const item = (label: string, value: React.ReactNode) => (
    <div className="rounded-2xl bg-stone-50 p-3"><dt className="text-[10px] font-black uppercase tracking-wide text-stone-400">{label}</dt><dd className="mt-0.5 text-sm font-bold text-stone-700">{value}</dd></div>
  );
  return (
    <Card
      title={<span className="flex items-center gap-2"><BellRing size={18} className="text-stone-400" /> Régua de cobrança <Badge tone={s.pendency_automation_enabled ? 'good' : 'muted'}>{s.pendency_automation_enabled ? 'Ativa' : 'Pausada'}</Badge></span>}
      subtitle="Antes de cada envio o saldo é recalculado e as pendências abertas do sócio vão numa mensagem só."
      right={configure}>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {item('Envios', reminderDaysText(s.pendency_reminder_days))}
        {item('Carência', s.pendency_grace_days ? `${s.pendency_grace_days} dia(s) após o vencimento` : 'Sem carência')}
        {fine || interest
          ? <>{fine && item('Multa', fine)}{interest && item('Juros por dia', interest)}</>
          : item('Multa e juros', 'Não cobra')}
        {item('Chave PIX', s.pix_key?.trim() ? <span className="break-all">{s.pix_key}</span> : <span className="text-amber-700">Não configurada</span>)}
      </dl>
      <p className="mt-3 text-xs text-stone-500">Comprovante com leitura segura dá baixa sozinho; na dúvida vai para revisão. Pagamento parcial mantém o saldo; excedente vira crédito do sócio.</p>
    </Card>
  );
};

const NewPendencySheet: React.FC<{ open: boolean; onClose: () => void; onDone: () => void; onConfigure: () => void }> = ({ open, onClose, onDone, onConfigure }) => {
  const today = useToday();
  const { accounts, categories, settings } = useFinance();
  const members = useAsync(() => (open ? listActiveMembers() : Promise.resolve([])), [open]);
  const { key, renew } = useRequestKey();
  const [profile, setProfile] = useState('');
  const [kind, setKind] = useState<MemberPendencyKind>('day_card');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(settings?.day_card_price_cents ?? null);
  const [competence, setCompetence] = useState(firstOfMonth(today));
  const [due, setDue] = useState<IsoDate>(today);
  const [guestName, setGuestName] = useState('');
  const [guestDate, setGuestDate] = useState<IsoDate | ''>('');
  const [sendNow, setSendNow] = useState(false);
  const [collection, setCollection] = useState(true);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [paidOn, setPaidOn] = useState<IsoDate>(today);
  const [method, setMethod] = useState('pix');
  const defaultAccount = accounts.find((a) => a.is_default_receipts && a.active)?.id ?? accounts.find((a) => a.active)?.id ?? '';
  const [account, setAccount] = useState(defaultAccount);
  const [busy, setBusy] = useState(false);

  const dayCardCategory = categories.find((c) => c.system_key === 'day_card')?.id ?? null;
  const genericCategory = categories.find((c) => c.system_key === 'member_pendency')?.id ?? null;
  const categoryId = kind === 'day_card' ? dayCardCategory : genericCategory;
  const valid = Boolean(profile && description.trim().length >= 3 && amount && amount > 0 && competence && due && categoryId && (!alreadyPaid || account));

  const reset = () => {
    setProfile(''); setKind('day_card'); setDescription(''); setAmount(settings?.day_card_price_cents ?? null);
    setCompetence(firstOfMonth(today)); setDue(today); setGuestName(''); setGuestDate('');
    setSendNow(false); setCollection(true); setAlreadyPaid(false); setPaidOn(today); setMethod('pix'); setAccount(defaultAccount);
    renew();
  };

  const changeKind = (next: MemberPendencyKind) => {
    setKind(next);
    if (next === 'day_card' && (!amount || amount === settings?.day_card_price_cents)) setAmount(settings?.day_card_price_cents ?? amount);
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await createMemberPendency({
        profileId: profile,
        description: description.trim(),
        amountCents: amount!,
        competenceMonth: firstOfMonth(competence),
        dueDate: due,
        pendencyKind: kind,
        categoryId,
        guestName: kind === 'day_card' ? guestName.trim() || null : null,
        guestDate: kind === 'day_card' ? guestDate || null : null,
        collectionEnabled: collection,
        sendNow: !alreadyPaid && sendNow,
        alreadyPaid,
        paidOn: alreadyPaid ? paidOn : null,
        method: alreadyPaid ? method : null,
        accountId: alreadyPaid ? account : null,
      }, key);
      notify.success(alreadyPaid ? 'Pendência lançada e pagamento registrado.' : sendNow ? 'Pendência criada. A cobrança entrou na fila do WhatsApp.' : 'Pendência criada.');
      reset(); onDone(); onClose();
    } catch (e) {
      notifyFinanceError(e, 'Não foi possível criar a pendência.', 'finance_member_pendency_create_failed');
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} wide title="Nova pendência de sócio" subtitle="Conta a receber vinculada ao sócio, com cobrança e comprovante no mesmo motor financeiro."
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy || !valid} onClick={save}>Criar pendência</button></>}>
      {members.loading ? <Spinner /> : <>
        <Field label="Sócio"><select className={inputCls} value={profile} onChange={(e) => setProfile(e.target.value)}><option value="">Escolha…</option>{(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Motivo"><select className={inputCls} value={kind} onChange={(e) => changeKind(e.target.value as MemberPendencyKind)}>{KINDS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} aria-label="Valor da pendência" /></Field>
        </div>
        <Field label="Descrição" hint="Explique de forma que o sócio entenda exatamente o que está sendo cobrado."><textarea className={inputCls} rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Day Card do convidado que esteve no clube em 05/10" /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Competência"><input type="month" className={inputCls} value={competence.slice(0,7)} onChange={(e) => setCompetence(`${e.target.value}-01`)} /></Field>
          <Field label="Vencimento"><input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        {kind === 'day_card' && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
            <p className="mb-2 text-xs font-black uppercase tracking-wide text-blue-700">Detalhes do Day Card — opcionais</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Convidado"><input className={inputCls} value={guestName} maxLength={120} onChange={(e) => setGuestName(e.target.value)} /></Field>
              <Field label="Data da visita"><input type="date" className={inputCls} value={guestDate} onChange={(e) => setGuestDate(e.target.value)} /></Field>
            </div>
          </div>
        )}
        <label className="flex items-start gap-3 rounded-2xl border border-stone-200 p-3">
          <input type="checkbox" className="mt-1" checked={collection} onChange={(e) => setCollection(e.target.checked)} />
          <span><b className="block text-sm">Cobrança automática habilitada</b><span className="text-xs text-stone-500">A régua para automaticamente quando o saldo for quitado.</span></span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-stone-200 p-3">
          <input type="checkbox" className="mt-1" checked={alreadyPaid} onChange={(e) => { setAlreadyPaid(e.target.checked); if (e.target.checked) setSendNow(false); }} />
          <span><b className="block text-sm">Já foi pago</b><span className="text-xs text-stone-500">Registra a entrada agora e não envia cobrança.</span></span>
        </label>
        {alreadyPaid ? (
          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3 sm:grid-cols-3">
            <Field label="Data do pagamento"><input type="date" max={today} className={inputCls} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
            <Field label="Forma"><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Conta"><select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Escolha…</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          </div>
        ) : (
          <label className="flex items-start gap-3 rounded-2xl border border-saibro-200 bg-saibro-50/50 p-3">
            <input type="checkbox" className="mt-1" checked={sendNow} disabled={!collection} onChange={(e) => setSendNow(e.target.checked)} />
            <span><b className="block text-sm">Enviar cobrança agora</b><span className="text-xs text-stone-500">O WhatsApp consolida todas as pendências abertas do sócio em uma única mensagem.</span></span>
          </label>
        )}
        {settings?.pix_key?.trim()
          ? <Notice tone="info">PIX do clube: <b className="break-all">{settings.pix_key}</b>. O comprovante pode gerar baixa parcial, quitar várias pendências e transformar excedente em crédito.</Notice>
          : <Notice tone="warn" title="Configure a chave PIX na régua">Sem a chave, a cobrança chega ao sócio sem o PIX para pagar.
              <span className="mt-2 block"><button type="button" className={`${btnGhost} w-full sm:w-auto`} onClick={onConfigure}><Settings2 size={16} /> Configurar régua</button></span></Notice>}
      </>}
    </Sheet>
  );
};

const PendencySheet: React.FC<{ row: ViewRow | null; onClose: () => void; onChanged: () => void }> = ({ row, onClose, onChanged }) => {
  const today=useToday();
  const { accounts }=useFinance();
  const { key, renew }=useRequestKey();
  const [mode,setMode]=useState<null|'pay'|'cancel'>(null);
  const [amount,setAmount]=useState<number|null>(null);
  const [date,setDate]=useState<IsoDate>(today);
  const [method,setMethod]=useState('pix');
  const [account,setAccount]=useState(accounts.find((a)=>a.is_default_receipts&&a.active)?.id ?? accounts.find((a)=>a.active)?.id ?? '');
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);

  if(!row) return null;
  const c=row; const m=row.meta;
  const run=async(fn:()=>Promise<unknown>,ok:string)=>{
    setBusy(true);
    try{await fn();notify.success(ok);renew();setMode(null);onChanged();}
    catch(e){notifyFinanceError(e,'Não foi possível concluir a operação.','finance_pendency_action_failed');}
    finally{setBusy(false);}
  };

  return <Sheet open onClose={onClose} wide title={m.description} subtitle={`${c.profile_name} · ${monthLabel(c.competence_month)} · vence ${brDate(c.due_date)}`}>
    <div className="flex flex-wrap items-center gap-2"><ChargeStatusBadge status={c.display_status}/>{!m.collection_enabled&&<Badge tone="neutral">Cobrança pausada</Badge>}{c.in_review&&<Badge tone="warn">Comprovante em análise</Badge>}</div>
    <dl className="space-y-1.5 rounded-2xl bg-stone-50 p-3 text-sm">
      <div className="flex justify-between"><dt className="text-stone-500">Valor original</dt><dd className="font-bold">{formatBRL(c.original_amount_cents)}</dd></div>
      <div className="flex justify-between"><dt className="text-stone-500">Já pago</dt><dd>{formatBRL(c.principal_paid_cents)}</dd></div>
      <div className="flex justify-between"><dt className="text-stone-500">Encargos</dt><dd>{formatBRL(c.fees_due_cents)}</dd></div>
      <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-black"><dt>Saldo</dt><dd>{formatBRL(c.total_due_cents)}</dd></div>
    </dl>
    {m.pendency_kind==='day_card'&&(m.guest_name||m.guest_date)&&<Notice tone="info">{m.guest_name?<>Convidado: <b>{m.guest_name}</b>. </>:null}{m.guest_date?<>Visita: <b>{brDate(m.guest_date)}</b>.</>:null}</Notice>}
    {mode===null&&c.stored_status!=='canceled'&&<>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {c.total_due_cents>0&&<button className={btnPrimary} onClick={()=>{setMode('pay');setAmount(c.total_due_cents);}}>Registrar pagamento</button>}
        {c.total_due_cents>0&&m.collection_enabled&&<button className={btnGhost} disabled={busy||c.in_review} onClick={()=>run(()=>sendPendencyNow(c.charge_id,key),'Cobrança adicionada à fila do WhatsApp.')}><Send size={15}/> Cobrar agora</button>}
        {c.total_due_cents>0&&<button className={btnGhost} disabled={busy} onClick={()=>run(()=>setPendencyCollection(c.charge_id,!m.collection_enabled,key),m.collection_enabled?'Cobrança automática pausada.':'Cobrança automática reativada.')}>{m.collection_enabled?<PauseCircle size={15}/>:<PlayCircle size={15}/>} {m.collection_enabled?'Pausar cobrança':'Reativar cobrança'}</button>}
        {c.principal_paid_cents===0&&c.stored_status!=='paid'&&<button className={btnDanger} onClick={()=>setMode('cancel')}>Cancelar pendência</button>}
      </div>
    </>}
    {mode==='pay'&&<div className="space-y-3 rounded-2xl border border-emerald-200 p-3">
      <p className="text-sm font-black">Registrar pagamento</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Valor"><MoneyInput value={amount} onChange={setAmount}/></Field>
        <Field label="Data"><input type="date" className={inputCls} value={date} max={today} onChange={(e)=>setDate(e.target.value)}/></Field>
        <Field label="Forma"><select className={inputCls} value={method} onChange={(e)=>setMethod(e.target.value)}>{METHODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
      </div>
      <Field label="Conta"><select className={inputCls} value={account} onChange={(e)=>setAccount(e.target.value)}><option value="">Escolha…</option>{accounts.filter((a)=>a.active).map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <div className="flex gap-2"><button className={btnGhost} onClick={()=>setMode(null)}>Voltar</button><button className={btnPrimary} disabled={busy||!amount||amount<=0||!account} onClick={()=>run(()=>registerPayment(c.charge_id,amount!,date,method,account,null,key),'Pagamento registrado.')}>Confirmar</button></div>
    </div>}
    {mode==='cancel'&&<div className="space-y-3 rounded-2xl border border-red-200 p-3">
      <Field label="Motivo do cancelamento"><textarea className={inputCls} rows={2} value={reason} onChange={(e)=>setReason(e.target.value)}/></Field>
      <div className="flex gap-2"><button className={btnGhost} onClick={()=>setMode(null)}>Voltar</button><button className={btnDanger} disabled={busy||reason.trim().length<5} onClick={()=>run(()=>cancelCharge(c.charge_id,reason.trim(),key),'Pendência cancelada.')}>Cancelar pendência</button></div>
    </div>}
  </Sheet>;
};

const PendenciesTab: React.FC = () => {
  const { settings, reload: reloadSettings } = useFinance();
  const [newOpen,setNewOpen]=useState(false);
  const [rulesOpen,setRulesOpen]=useState(false);
  // aberto pelo aviso de PIX da "Nova pendência": ao fechar a régua, volta para ela
  const [resumeNew,setResumeNew]=useState(false);
  const openRules=(fromNew=false)=>{ if(fromNew){setNewOpen(false);setResumeNew(true);} setRulesOpen(true); };
  const closeRules=()=>{ setRulesOpen(false); if(resumeNew){setResumeNew(false);setNewOpen(true);} };
  const [search,setSearch]=useState('');
  const [status,setStatus]=useState('');
  const [selected,setSelected]=useState<ViewRow|null>(null);
  const statements=useAsync(()=>listCharges({chargeType:'member_pendency',status},LIST_LIMIT),[status]);
  const meta=useAsync(()=>listPendencyMeta(),[]);
  const reload=()=>{statements.reload();meta.reload();};

  const rows=useMemo(()=>{
    const byId=new Map((meta.data??[]).map((m)=>[m.id,m]));
    return (statements.data??[]).map((s)=>({ ...s,meta:byId.get(s.charge_id)! })).filter((r)=>r.meta)
      .filter((r)=>!search.trim()||matchesSearch(search,`${r.profile_name} ${r.meta.description} ${r.meta.guest_name??''}`));
  },[statements.data,meta.data,search]);
  const loadedCount=statements.data?.length??0;
  const totalCount=statements.data?.[0]?.total_count??0;
  const partial=totalCount>loadedCount;
  const total=rows.filter((r)=>!['paid','canceled'].includes(r.stored_status)).reduce((sum,r)=>sum+r.total_due_cents,0);
  const overdue=rows.filter((r)=>r.display_status==='overdue').reduce((sum,r)=>sum+r.total_due_cents,0);

  return <div className="space-y-4">
    <Card title="Pendências de sócios" subtitle="Cobranças manuais vinculadas ao sócio: Day Card não lançado, consumo, evento, reposição ou outro ajuste."
      right={<div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <button className={`${btnGhost} flex-1 whitespace-nowrap sm:flex-none`} onClick={()=>openRules()}><Settings2 size={16}/> Configurar régua</button>
        <button className={`${btnPrimary} flex-1 whitespace-nowrap sm:flex-none`} onClick={()=>setNewOpen(true)}><Plus size={16}/> Nova pendência</button>
      </div>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-stone-50 p-3"><p className="text-[10px] font-black uppercase text-stone-400">Saldo em aberto</p><p className="text-xl font-black">{formatBRL(total)}</p></div>
        <div className="rounded-2xl bg-red-50 p-3"><p className="text-[10px] font-black uppercase text-red-400">Vencido</p><p className="text-xl font-black text-red-700">{formatBRL(overdue)}</p></div>
      </div>
      <div className="mt-4 space-y-3">
        <AdminSearch value={search} onChange={setSearch} placeholder="Buscar sócio, descrição ou convidado…" label="Buscar pendência"/>
        <SectionTabs label="Situação" value={status} onChange={setStatus} items={STATUS.map(([id,label])=>({id,label}))}/>
        {partial&&!statements.loading&&<Notice tone="warn">Há {totalCount.toLocaleString('pt-BR')} pendências neste filtro; só as {loadedCount.toLocaleString('pt-BR')} mais recentes entram na lista e nos totais acima. Escolha uma situação para ver as demais.</Notice>}
        {statements.loading||meta.loading?<Spinner/>:statements.error||meta.error?<Notice tone="warn">Não foi possível carregar as pendências.</Notice>:rows.length===0?<Empty title="Nenhuma pendência neste filtro" hint="Use “Nova pendência” para lançar uma cobrança manual para um sócio."/>:
          <div className="space-y-2">{rows.map((r)=><Row key={r.charge_id} onClick={()=>setSelected(r)}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-black text-stone-800">{r.profile_name}</p><p className="text-sm text-stone-600">{r.meta.description}</p><p className="mt-1 text-xs text-stone-400">{KINDS.find(([k])=>k===r.meta.pendency_kind)?.[1]??r.meta.pendency_kind} · competência {monthLabel(r.competence_month)} · vence {brDate(r.due_date)}</p></div>
              <div className="text-right"><p className="font-black tabular-nums">{formatBRL(r.total_due_cents)}</p><div className="mt-1 flex justify-end gap-1"><ChargeStatusBadge status={r.display_status}/>{!r.meta.collection_enabled&&<Badge tone="neutral">Pausada</Badge>}</div></div>
            </div>
          </Row>)}</div>}
      </div>
    </Card>
    <RulesSummary s={settings} onConfigure={()=>openRules()}/>
    <NewPendencySheet open={newOpen} onClose={()=>setNewOpen(false)} onDone={reload} onConfigure={()=>openRules(true)}/>
    <Sheet open={rulesOpen} onClose={closeRules} wide closeOnBackdrop={false} title="Régua de cobrança das pendências" subtitle="Vale para todas as pendências de sócio. Mensalidades têm encargos próprios, em Configurações.">
      {settings ? <PendencyRulesSection bare s={settings} onSaved={()=>{reloadSettings();closeRules();}}/> : <Spinner/>}
    </Sheet>
    <PendencySheet row={selected} onClose={()=>setSelected(null)} onChanged={()=>{reload();setSelected(null);}}/>
  </div>;
};

export default PendenciesTab;
