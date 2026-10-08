import React, { useState } from 'react';
import { adjustCharge, cancelCharge, registerPayment, reversePayment } from '../../../../lib/finance/financeApi';
import type { ChargePaymentRow, ChargeStatementRow, FinAccount } from '../../../../lib/finance/types';
import { brDate, type IsoDate } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { useConfirm } from '../../../../hooks/useConfirm';
import { useRequestKey, useToday } from '../../hooks';
import { useFinance } from '../../FinanceContext';
import { ActionPanel, PanelActions } from '../../ActionPanel';
import { AccountSelect, MethodSelect } from '../../fields';
import { Field, MoneyInput, Notice, btnDanger, btnPrimary, inputCls } from '../../ui';

/** Executa a operação, avisa o resultado e fecha o formulário. */
export type Submit = (action: () => Promise<unknown>, okText: string) => Promise<void>;

/** Todo formulário de ação recebe o mesmo conjunto; cada um usa o que precisa. */
export interface FormProps { charge: ChargeStatementRow; lastPayment: ChargePaymentRow | undefined; busy: boolean; submit: Submit; onBack: () => void }

const MIN_REASON = 5;
const hasReason = (text: string) => text.trim().length >= MIN_REASON;

// A conta pré-selecionada ao registrar: a padrão de recebimentos, senão a primeira ativa.
const preferredAccount = (accounts: FinAccount[]) => accounts.find((a) => a.is_default_receipts)?.id ?? accounts.find((a) => a.active)?.id ?? '';

export const PayForm: React.FC<FormProps> = ({ charge, busy, submit, onBack }) => {
  const today = useToday();
  const { accounts } = useFinance();
  const { key } = useRequestKey();
  const [amount, setAmount] = useState<number | null>(charge.total_due_cents);
  const [date, setDate] = useState<IsoDate>(today);
  const [method, setMethod] = useState('pix');
  const [account, setAccount] = useState(preferredAccount(accounts));
  const [note, setNote] = useState('');

  const pay = async () => {
    if (!amount) return;
    await submit(() => registerPayment(charge.charge_id, amount, date, method, account, note.trim() || null, key), 'Pagamento registrado.');
  };

  return (
    <ActionPanel title="Registrar pagamento">
      <p className="text-xs text-stone-500">O valor abate primeiro multa, depois juros, depois o principal. Se passar do devido, a sobra vira crédito do sócio (nunca se perde).</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor recebido"><MoneyInput value={amount} onChange={setAmount} aria-label="Valor recebido" /></Field>
        <Field label="Data do dinheiro"><input type="date" className={inputCls} value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Forma"><MethodSelect value={method} onChange={setMethod} /></Field>
        <Field label="Conta onde entrou"><AccountSelect accounts={accounts} value={account} onChange={setAccount} placeholder="Escolha…" /></Field>
      </div>
      <Field label="Observação (opcional)"><input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      <PanelActions onBack={onBack}>
        <button className={btnPrimary} disabled={busy || !amount || amount <= 0 || !account} onClick={pay}>Confirmar pagamento</button>
      </PanelActions>
    </ActionPanel>
  );
};

type AdjustKind = 'discount' | 'increase' | 'fee_waiver';
const CONFIRM_TITLE: Record<AdjustKind, string> = {
  fee_waiver: 'Dispensar estes encargos?',
  discount: 'Conceder este desconto?',
  increase: 'Lançar este acréscimo?',
};

type AdjustMode = 'discount' | 'waiver';

const adjustCopy = (mode: AdjustMode, charge: ChargeStatementRow) => (mode === 'waiver'
  ? { title: 'Dispensar multa e juros', hint: `Encargos devidos agora: ${formatBRL(charge.fees_due_cents)}`, startAmount: charge.fees_due_cents }
  : { title: 'Desconto ou acréscimo', hint: `Principal em aberto: ${formatBRL(charge.principal_remaining_cents)}`, startAmount: null });

const KindSelect: React.FC<{ value: 'discount' | 'increase'; onChange: (kind: 'discount' | 'increase') => void }> = ({ value, onChange }) => (
  <Field label="Tipo">
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as 'discount' | 'increase')}>
      <option value="discount">Desconto (reduz o principal)</option>
      <option value="increase">Acréscimo (aumenta o principal)</option>
    </select>
  </Field>
);

const AdjustForm: React.FC<FormProps & { mode: AdjustMode }> = ({ charge, mode, busy, submit, onBack }) => {
  const confirm = useConfirm();
  const { key } = useRequestKey();
  const copy = adjustCopy(mode, charge);
  const [kind, setKind] = useState<'discount' | 'increase'>('discount');
  const [amount, setAmount] = useState<number | null>(copy.startAmount);
  const [reason, setReason] = useState('');
  const adjustKind: AdjustKind = mode === 'waiver' ? 'fee_waiver' : kind;

  const register = async () => {
    if (!amount) return;
    const confirmed = await confirm({ tone: 'warning', title: CONFIRM_TITLE[adjustKind], description: `${formatBRL(amount)} — fica registrado na auditoria.`, confirmLabel: 'Confirmar' });
    if (!confirmed) return;
    await submit(() => adjustCharge(charge.charge_id, adjustKind, amount, reason.trim(), key), 'Ajuste registrado.');
  };

  return (
    <ActionPanel title={copy.title}>
      <Notice tone="warn">Todo desconto, acréscimo ou dispensa fica registrado com valor, motivo, quem fez e o extrato antes/depois. Só o administrador pode.</Notice>
      {mode === 'discount' && <KindSelect value={kind} onChange={setKind} />}
      <Field label="Valor" hint={copy.hint}><MoneyInput value={amount} onChange={setAmount} /></Field>
      <Field label="Justificativa (obrigatória)" hint="Mínimo de 5 caracteres."><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <PanelActions onBack={onBack}>
        <button className={btnPrimary} disabled={busy || !amount || !hasReason(reason)} onClick={register}>Registrar</button>
      </PanelActions>
    </ActionPanel>
  );
};

export const DiscountForm: React.FC<FormProps> = (props) => <AdjustForm {...props} mode="discount" />;
export const WaiverForm: React.FC<FormProps> = (props) => <AdjustForm {...props} mode="waiver" />;

export const CancelForm: React.FC<FormProps> = ({ charge, busy, submit, onBack }) => {
  const { key } = useRequestKey();
  const [reason, setReason] = useState('');
  return (
    <ActionPanel tone="red" title="Cancelar cobrança">
      <p className="text-xs text-stone-500">Só é possível sem pagamento. A cobrança deixa de contar como receita; o histórico fica.</p>
      <Field label="Motivo (obrigatório)"><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <PanelActions onBack={onBack}>
        <button className={btnDanger} disabled={busy || !hasReason(reason)} onClick={() => submit(() => cancelCharge(charge.charge_id, reason.trim(), key), 'Cobrança cancelada.')}>Cancelar cobrança</button>
      </PanelActions>
    </ActionPanel>
  );
};

export const ReverseForm: React.FC<FormProps> = ({ lastPayment: payment, busy, submit, onBack }) => {
  const { key } = useRequestKey();
  const [reason, setReason] = useState('');
  if (!payment) return null;
  return (
    <ActionPanel tone="red" title={`Estornar pagamento de ${formatBRL(payment.amount_cents)} (${brDate(payment.paid_on)})`}>
      <p className="text-xs text-stone-500">Cria uma linha de estorno: o caixa mostra a saída e a cobrança volta a ficar em aberto. Só o último pagamento pode ser estornado.</p>
      <Field label="Motivo (obrigatório)"><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <PanelActions onBack={onBack}>
        <button className={btnDanger} disabled={busy || !hasReason(reason)} onClick={() => submit(() => reversePayment(payment.id, reason.trim(), key), 'Pagamento estornado.')}>Estornar</button>
      </PanelActions>
    </ActionPanel>
  );
};
