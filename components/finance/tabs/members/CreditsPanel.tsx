import React, { useState } from 'react';
import { listCredits, profileNames } from '../../../../lib/finance/financeApi';
import type { MemberCreditRow } from '../../../../lib/finance/types';
import { brDate } from '../../../../lib/finance/dates';
import { formatBRL } from '../../../../lib/finance/money';
import { useAsync } from '../../hooks';
import { Card, Empty, Row, Spinner } from '../../ui';
import { ResolveCreditSheet } from './ResolveCreditSheet';

const REASON_LABEL: Record<MemberCreditRow['reason'], string> = { duplicate: 'Pagamento duplicado', excess: 'Pagamento a mais' };

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

/** Créditos de sócios (pagamento a mais ou repetido): ficam guardados até alguém aplicar, devolver ou baixar. */
export const CreditsPanel: React.FC = () => {
  const credits = useAsync(() => listCredits(), []);
  const [selected, setSelected] = useState<MemberCreditRow | null>(null);
  const open = (credits.data ?? []).filter((c) => c.status === 'open');
  const owners = [...new Set(open.map((c) => c.profile_id))];
  const names = useAsync(() => profileNames(owners), [owners.join(',')]);
  const nameOf = (profileId: string) => names.data?.[profileId] ?? 'Sócio';

  const resolved = () => { setSelected(null); credits.reload(); };

  return (
    <Card title="Créditos de sócios" subtitle="Pagamento a mais ou repetido: o valor é guardado aqui, nunca descartado.">
      {credits.loading ? <Spinner /> : open.length === 0 ? <Empty title="Nenhum crédito em aberto" /> : <CreditList credits={open} nameOf={nameOf} onSelect={setSelected} />}
      {selected && <ResolveCreditSheet key={selected.id} credit={selected} memberName={nameOf(selected.profile_id)} onClose={() => setSelected(null)} onResolved={resolved} />}
    </Card>
  );
};
