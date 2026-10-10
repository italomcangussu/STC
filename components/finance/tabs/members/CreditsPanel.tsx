import React, { useState } from 'react';
import { Wallet } from 'lucide-react';
import { profileNames } from '../../../../lib/finance/financeApi';
import type { MemberCreditRow } from '../../../../lib/finance/types';
import { brDate } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { useAsync, type AsyncState } from '../../hooks';
import { Notice, Row, Sheet, btnGhost } from '../../ui';
import { ResolveCreditSheet } from './ResolveCreditSheet';

const REASON_LABEL: Record<MemberCreditRow['reason'], string> = { duplicate: 'Pagamento duplicado', excess: 'Pagamento a mais' };

const openCredits = (credits: AsyncState<MemberCreditRow[]>) => (credits.data ?? []).filter((c) => c.status === 'open');

const CreditList: React.FC<{ credits: MemberCreditRow[]; nameOf: (profileId: string) => string; onSelect: (credit: MemberCreditRow) => void }> = ({ credits, nameOf, onSelect }) => (
  <div className="space-y-2">
    {credits.map((c) => (
      <Row key={c.id} onClick={() => onSelect(c)}>
        <div className="flex items-center justify-between"><span className="text-sm font-bold">{nameOf(c.profile_id)}</span><span className="font-black tabular-nums">{formatBRL(c.remaining_cents)}</span></div>
        <p className="text-xs text-stone-500">{REASON_LABEL[c.reason]} · {brDate(c.created_at.slice(0, 10))}</p>
      </Row>
    ))}
  </div>
);

/**
 * Créditos de sócios (pagamento a mais ou repetido): ficam guardados até alguém aplicar, devolver
 * ou baixar. Sem crédito em aberto, nada aparece; com crédito, um aviso na lista de cobranças abre a folha.
 */
export const CreditsPanel: React.FC<{ credits: AsyncState<MemberCreditRow[]> }> = ({ credits }) => {
  const [listOpen, setListOpen] = useState(false);
  const [selected, setSelected] = useState<MemberCreditRow | null>(null);
  const open = openCredits(credits);
  const owners = [...new Set(open.map((c) => c.profile_id))];
  const names = useAsync(() => (owners.length ? profileNames(owners) : Promise.resolve({} as Record<string, string>)), [owners.join(',')]);
  const nameOf = (profileId: string) => names.data?.[profileId] ?? 'Sócio';
  if (open.length === 0) return null;

  const total = open.reduce((s, c) => s + c.remaining_cents, 0);
  const resolved = () => { setSelected(null); credits.reload(); };
  return (
    <>
      <Notice tone="info">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span><b>{open.length} crédito(s) de sócios</b> em aberto, {formatBRL(total)}: pagamento a mais ou repetido, guardado até aplicar, devolver ou baixar.</span>
          <button className={btnGhost} onClick={() => setListOpen(true)}><Wallet size={16} /> Resolver créditos</button>
        </span>
      </Notice>
      <Sheet open={listOpen} onClose={() => setListOpen(false)} title="Créditos de sócios" subtitle="Pagamento a mais ou repetido: o valor é guardado aqui, nunca descartado.">
        <CreditList credits={open} nameOf={nameOf} onSelect={(c) => { setListOpen(false); setSelected(c); }} />
      </Sheet>
      {selected && <ResolveCreditSheet key={selected.id} credit={selected} memberName={nameOf(selected.profile_id)} onClose={() => setSelected(null)} onResolved={resolved} />}
    </>
  );
};
