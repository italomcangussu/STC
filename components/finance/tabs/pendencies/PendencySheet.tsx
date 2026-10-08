import React, { useState } from 'react';
import { PauseCircle, PlayCircle, Send } from 'lucide-react';
import { notify } from '../../../../lib/notifications';
import { sendPendencyNow, setPendencyCollection } from '../../../../lib/finance/financeApi';
import { availablePendencyActions, type PendencyAction, type PendencyRow } from '../../../../lib/finance/pendencies';
import { brDate, monthLabel } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { useAction, useRequestKey } from '../../hooks';
import { Badge, ChargeStatusBadge, Notice, Sheet, btnDanger, btnGhost, btnPrimary } from '../../ui';
import { CancelPanel, PayPanel, type PendencySubmit } from './PendencyPanels';

type Mode = 'pay' | 'cancel';

const Line: React.FC<{ label: string; value: string; valueClass?: string }> = ({ label, value, valueClass }) => (
  <div className="flex justify-between"><dt className="text-stone-500">{label}</dt><dd className={valueClass}>{value}</dd></div>
);

const Amounts: React.FC<{ row: PendencyRow }> = ({ row: c }) => (
  <dl className="space-y-1.5 rounded-2xl bg-stone-50 p-3 text-sm">
    <Line label="Valor original" value={formatBRL(c.original_amount_cents)} valueClass="font-bold" />
    <Line label="Já pago" value={formatBRL(c.principal_paid_cents)} />
    <Line label="Encargos" value={formatBRL(c.fees_due_cents)} />
    <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-black"><dt>Saldo</dt><dd>{formatBRL(c.total_due_cents)}</dd></div>
  </dl>
);

const Badges: React.FC<{ row: PendencyRow }> = ({ row: c }) => (
  <div className="flex flex-wrap items-center gap-2">
    <ChargeStatusBadge status={c.display_status} />
    {!c.meta.collection_enabled && <Badge tone="neutral">Cobrança pausada</Badge>}
    {c.in_review && <Badge tone="warn">Comprovante em análise</Badge>}
  </div>
);

/** O convidado e a data da visita, só no Day Card que tem esses dados. */
const GuestNotice: React.FC<{ meta: PendencyRow['meta'] }> = ({ meta: m }) => {
  if (m.pendency_kind !== 'day_card' || !(m.guest_name || m.guest_date)) return null;
  return <Notice tone="info">{m.guest_name ? <>Convidado: <b>{m.guest_name}</b>. </> : null}{m.guest_date ? <>Visita: <b>{brDate(m.guest_date)}</b>.</> : null}</Notice>;
};

interface ButtonProps { row: PendencyRow; busy: boolean; choose: (mode: Mode) => void; send: () => void; toggle: () => void }

const BUTTONS: Record<PendencyAction, React.FC<ButtonProps>> = {
  pay: ({ choose }) => <button className={btnPrimary} onClick={() => choose('pay')}>Registrar pagamento</button>,
  send: ({ row, busy, send }) => <button className={btnGhost} disabled={busy || row.in_review} onClick={send}><Send size={15} /> Cobrar agora</button>,
  toggle: ({ row, busy, toggle }) => (
    <button className={btnGhost} disabled={busy} onClick={toggle}>
      {row.meta.collection_enabled ? <PauseCircle size={15} /> : <PlayCircle size={15} />} {row.meta.collection_enabled ? 'Pausar cobrança' : 'Reativar cobrança'}
    </button>
  ),
  cancel: ({ choose }) => <button className={btnDanger} onClick={() => choose('cancel')}>Cancelar pendência</button>,
};

const Actions: React.FC<ButtonProps> = (props) => {
  const actions = availablePendencyActions(props.row);
  if (actions.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {actions.map((action) => { const Button = BUTTONS[action]; return <Button key={action} {...props} />; })}
    </div>
  );
};

const PANELS: Record<Mode, React.FC<{ charge: PendencyRow; busy: boolean; submit: PendencySubmit; onBack: () => void }>> = { pay: PayPanel, cancel: CancelPanel };

/** Extrato de uma pendência de sócio e as ações do administrador: pagar, cobrar agora, pausar a régua ou cancelar. */
export const PendencySheet: React.FC<{ row: PendencyRow | null; onClose: () => void; onChanged: () => void }> = ({ row, onClose, onChanged }) => {
  const { key, renew } = useRequestKey();
  const { busy, run } = useAction({ message: 'Não foi possível concluir a operação.', event: 'finance_pendency_action_failed' });
  const [mode, setMode] = useState<Mode | null>(null);

  if (!row) return null;
  const submit: PendencySubmit = (action, okText) => run(action, () => { notify.success(okText); renew(); setMode(null); onChanged(); });
  const collecting = row.meta.collection_enabled;
  const send = () => submit(() => sendPendencyNow(row.charge_id, key), 'Cobrança adicionada à fila do WhatsApp.');
  const toggle = () => submit(() => setPendencyCollection(row.charge_id, !collecting, key), collecting ? 'Cobrança automática pausada.' : 'Cobrança automática reativada.');
  const Panel = mode === null ? null : PANELS[mode];

  return (
    <Sheet open onClose={onClose} wide title={row.meta.description} subtitle={`${row.profile_name} · ${monthLabel(row.competence_month)} · vence ${brDate(row.due_date)}`}>
      <Badges row={row} />
      <Amounts row={row} />
      <GuestNotice meta={row.meta} />
      {Panel ? <Panel charge={row} busy={busy} submit={submit} onBack={() => setMode(null)} /> : <Actions row={row} busy={busy} choose={setMode} send={send} toggle={toggle} />}
    </Sheet>
  );
};
