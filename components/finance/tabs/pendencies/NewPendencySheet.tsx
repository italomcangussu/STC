import React, { useState } from 'react';
import { notify } from '../../../../lib/notifications';
import { createMemberPendency, listActiveMembers } from '../../../../lib/finance/financeApi';
import { defaultReceiptsAccountId } from '../../../../lib/finance/accounts';
import {
  amountAfterKindChange, emptyPendencyDraft, isPendencyReady, pendencyCategoryId, pendencyCreatedMessage, pendencyInput, type PendencyDraft,
} from '../../../../lib/finance/pendencies';
import type { MemberPendencyKind } from '../../../../lib/finance/types';
import { useAction, useAsync, useRequestKey, useToday } from '../../hooks';
import { useFinance } from '../../FinanceContext';
import { Sheet, Spinner, btnGhost, btnPrimary } from '../../ui';
import { CollectionFields, DayCardFields, MainFields, PixNotice } from './NewPendencyFields';

interface Props { open: boolean; onClose: () => void; onDone: () => void; onConfigure: () => void }

export const NewPendencySheet: React.FC<Props> = ({ open, onClose, onDone, onConfigure }) => {
  const today = useToday();
  const { accounts, categories, settings } = useFinance();
  const members = useAsync(() => (open ? listActiveMembers() : Promise.resolve([])), [open]);
  const { key, renew } = useRequestKey();
  const { busy, run } = useAction({ message: 'Não foi possível criar a pendência.', event: 'finance_member_pendency_create_failed' });
  const [draft, setDraft] = useState<PendencyDraft>(() => emptyPendencyDraft(today, settings, defaultReceiptsAccountId(accounts)));
  const patch = (change: Partial<PendencyDraft>) => setDraft((current) => ({ ...current, ...change }));
  const categoryId = pendencyCategoryId(categories, draft.kind);
  const ready = isPendencyReady(draft, categoryId);

  const changeKind = (kind: MemberPendencyKind) => setDraft((current) => ({ ...current, kind, amount: amountAfterKindChange(kind, current.amount, settings?.day_card_price_cents) }));
  const created = () => {
    notify.success(pendencyCreatedMessage(draft));
    setDraft(emptyPendencyDraft(today, settings, defaultReceiptsAccountId(accounts)));
    renew(); onDone(); onClose();
  };
  const save = async () => {
    if (ready) await run(() => createMemberPendency(pendencyInput(draft, categoryId), key), created);
  };

  return (
    <Sheet open={open} onClose={onClose} wide title="Nova pendência de sócio" subtitle="Conta a receber vinculada ao sócio, com cobrança e comprovante no mesmo motor financeiro."
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy || !ready} onClick={save}>Criar pendência</button></>}>
      {members.loading ? <Spinner /> : <>
        <MainFields draft={draft} patch={patch} members={members.data ?? []} onKindChange={changeKind} />
        <DayCardFields draft={draft} patch={patch} />
        <CollectionFields draft={draft} patch={patch} accounts={accounts} today={today} />
        <PixNotice settings={settings} onConfigure={onConfigure} />
      </>}
    </Sheet>
  );
};
