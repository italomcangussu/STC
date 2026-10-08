import React, { useState } from 'react';
import { notify } from '../../../../lib/notifications';
import { listCharges, resolveCredit } from '../../../../lib/finance/financeApi';
import type { ChargeStatementRow, FinAccount, MemberCreditRow } from '../../../../lib/finance/types';
import { creditResolution, creditTargets, type CreditAction, type CreditDraft } from '../../../../lib/finance/memberCharges';
import { monthLabel } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { useAction, useAsync, useRequestKey } from '../../hooks';
import { useFinance } from '../../FinanceContext';
import { AccountSelect } from '../../fields';
import { Field, Sheet, btnGhost, btnPrimary, inputCls } from '../../ui';

interface FieldsProps {
  draft: CreditDraft;
  patch: (change: Partial<CreditDraft>) => void;
  accounts: FinAccount[];
  targets: ChargeStatementRow[];
  loadingTargets: boolean;
}

const ApplyFields: React.FC<FieldsProps> = ({ draft, patch, targets, loadingTargets }) => (
  <Field label="Cobrança">
    <select className={inputCls} value={draft.chargeId} onChange={(e) => patch({ chargeId: e.target.value })}>
      <option value="">{loadingTargets ? 'Carregando…' : 'Escolha…'}</option>
      {targets.map((t) => <option key={t.charge_id} value={t.charge_id}>{monthLabel(t.competence_month)} — {formatBRL(t.total_due_cents)}</option>)}
    </select>
  </Field>
);

const RefundFields: React.FC<FieldsProps> = ({ draft, patch, accounts }) => (
  <>
    <Field label="Conta de onde saiu"><AccountSelect accounts={accounts} value={draft.accountId} onChange={(accountId) => patch({ accountId })} /></Field>
    <Field label="Observação"><input className={inputCls} value={draft.reason} onChange={(e) => patch({ reason: e.target.value })} /></Field>
  </>
);

const VoidFields: React.FC<FieldsProps> = ({ draft, patch }) => (
  <Field label="Justificativa (obrigatória)"><textarea className={inputCls} rows={2} value={draft.reason} onChange={(e) => patch({ reason: e.target.value })} /></Field>
);

const FIELDS_BY_ACTION: Record<CreditAction, React.FC<FieldsProps>> = { apply: ApplyFields, refund: RefundFields, void: VoidFields };

export const ResolveCreditSheet: React.FC<{ credit: MemberCreditRow; memberName: string; onClose: () => void; onResolved: () => void }> = ({ credit, memberName, onClose, onResolved }) => {
  const { accounts } = useFinance();
  const { key } = useRequestKey();
  const { busy, run } = useAction({ message: 'Não foi possível resolver o crédito.', event: 'finance_credit_failed' });
  // Só as cobranças do sócio: não depende de a cobrança estar entre as mais recentes do clube.
  const charges = useAsync(() => listCharges({ profileId: credit.profile_id, chargeType: 'membership' }, 1000), [credit.profile_id]);
  const [action, setAction] = useState<CreditAction>('apply');
  const [draft, setDraft] = useState<CreditDraft>({ chargeId: '', accountId: accounts.find((a) => a.active)?.id ?? '', reason: '' });
  const patch = (change: Partial<CreditDraft>) => setDraft((current) => ({ ...current, ...change }));
  const resolution = creditResolution(action, draft);
  const Fields = FIELDS_BY_ACTION[action];

  const confirm = async () => {
    if (!resolution) return;
    await run(() => resolveCredit(credit.id, action, resolution, key), () => { notify.success('Crédito resolvido.'); onResolved(); });
  };

  return (
    <Sheet open onClose={onClose} title="Resolver crédito" subtitle={`${memberName} — ${formatBRL(credit.remaining_cents)}`}
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy || !resolution} onClick={confirm}>Confirmar</button></>}>
      <Field label="O que fazer">
        <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value as CreditAction)}>
          <option value="apply">Aplicar numa cobrança do sócio</option>
          <option value="refund">Devolver o dinheiro (saída de caixa)</option>
          <option value="void">Baixar com justificativa</option>
        </select>
      </Field>
      <Fields draft={draft} patch={patch} accounts={accounts} targets={creditTargets(charges.data ?? [], credit)} loadingTargets={charges.loading} />
    </Sheet>
  );
};
