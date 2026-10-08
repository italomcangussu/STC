/**
 * "Meu financeiro" — a área do sócio. Mostra SÓ o que é dele (RLS no banco):
 * mensalidades com valor original, dias de atraso, multa e juros separados e
 * total atualizado; pagamentos; e o envio/acompanhamento de comprovantes.
 *
 * Comprovantes de mensalidade e de pendência podem gerar baixa automática quando OCR e regras financeiras conferem; os demais seguem para revisão.
 */
import React, { useMemo, useState } from 'react';
import type { User } from '../../types';
import { getMemberPaymentSettings, getPublicSettings, listCredits, listPendencyMeta, myCharges, myReceipts } from '../../lib/finance/financeApi';
import type { ChargeStatementRow } from '../../lib/finance/types';
import { formatBRL } from '../../lib/finance/money';
import { describeRules, groupCharges, openCreditCents, openPendencyCharges, payableCharges, sumDue, toggleId } from '../../lib/finance/memberStatement';
import { useAsync } from './hooks';
import { Empty, ErrorBlock, Notice, SectionTabs, Spinner } from './ui';
import { ChargeCard } from './member/ChargeCard';
import { SendReceiptSheet } from './member/SendReceiptSheet';
import { PendenciesCard, ReceiptsCard, RulesCard, StatementHeader, type MyReceipt } from './member/StatementPanels';

type SendState = { open: boolean; replaces: string | null; pre: string[] };

const TABS = (groups: ReturnType<typeof groupCharges>) => [
  { id: 'pay', label: 'A pagar', badge: groups.pay.length }, { id: 'forecast', label: 'Previstas', badge: groups.forecast.length },
  { id: 'paid', label: 'Pagas' }, { id: 'canceled', label: 'Canceladas' },
];

/** Cobranças, comprovantes, créditos e regras do sócio, já separados em grupos e totais. */
function useMemberFinance(userId: string) {
  const charges = useAsync(() => myCharges(), []);
  const receipts = useAsync(() => myReceipts(), []);
  const credits = useAsync(() => listCredits(userId), [userId]);
  const settings = useAsync(() => getPublicSettings(), []);
  const paySettings = useAsync(() => getMemberPaymentSettings(), []);
  const pendencies = useAsync(() => listPendencyMeta(userId), [userId]);

  const list = useMemo(() => charges.data ?? [], [charges.data]);
  const pendencyById = useMemo(() => new Map((pendencies.data ?? []).map((p) => [p.id, p])), [pendencies.data]);
  const groups = useMemo(() => groupCharges(list), [list]);
  const openPendencies = openPendencyCharges(list, new Set(pendencyById.keys()));
  const refresh = () => { charges.reload(); receipts.reload(); credits.reload(); pendencies.reload(); };

  return {
    charges, receipts, paySettings, list, pendencyById, groups, refresh,
    payable: payableCharges(groups),
    owedNow: sumDue(groups.pay),
    overdueCount: groups.pay.filter((c) => c.display_status === 'overdue').length,
    rules: settings.data ? describeRules(settings.data) : null,
    creditCents: openCreditCents(credits.data ?? []),
    openPendencyCents: sumDue(openPendencies),
    hasOpenPendencies: openPendencies.length > 0,
  };
}

type Finance = ReturnType<typeof useMemberFinance>;

const ChargeList: React.FC<{ finance: Finance; tab: string; picked: string[]; onToggle: (chargeId: string) => void }> = ({ finance, tab, picked, onToggle }) => {
  const shown: ChargeStatementRow[] = finance.groups[tab as keyof Finance['groups']];
  if (finance.charges.loading) return <Spinner />;
  if (shown.length === 0) {
    const none = finance.list.length === 0;
    return <Empty title={none ? 'Você não tem cobranças financeiras cadastradas' : 'Nada por aqui'} hint={none ? 'Mensalidades e pendências aparecerão aqui quando existirem.' : undefined} />;
  }
  return (
    <div className="space-y-3">
      {shown.map((c) => (
        <ChargeCard key={c.charge_id} c={c} meta={finance.pendencyById.get(c.charge_id)} selectable={tab === 'pay' || tab === 'forecast'} selected={picked.includes(c.charge_id)} onToggle={() => onToggle(c.charge_id)} />
      ))}
    </div>
  );
};

export const MemberFinance: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const finance = useMemberFinance(currentUser.id);
  const [tab, setTab] = useState('pay');
  const [send, setSend] = useState<SendState>({ open: false, replaces: null, pre: [] });
  const [picked, setPicked] = useState<string[]>([]);
  const resend = (r: MyReceipt) => setSend({ open: true, replaces: r.id, pre: r.charge_ids });

  return (
    <div className="space-y-4 pb-6">
      <StatementHeader overdueCount={finance.overdueCount} owedCents={finance.owedNow} canSend={finance.payable.length > 0} pickedCount={picked.length} onSend={() => setSend({ open: true, replaces: null, pre: picked })} />
      {finance.hasOpenPendencies && <PendenciesCard cents={finance.openPendencyCents} pixKey={finance.paySettings.data?.pix_key} />}
      {finance.rules && <RulesCard rules={finance.rules} />}
      {finance.creditCents > 0 && (
        <Notice tone="info" title={`Você tem ${formatBRL(finance.creditCents)} de crédito`}>
          Houve pagamento a mais ou repetido. O clube vai aplicar o crédito numa próxima cobrança ou devolver o valor — nada se perde.
        </Notice>
      )}
      {finance.charges.error ? <ErrorBlock error={finance.charges.error} onRetry={finance.charges.reload} /> : (
        <>
          <SectionTabs label="Cobranças" value={tab} onChange={setTab} items={TABS(finance.groups)} />
          <ChargeList finance={finance} tab={tab} picked={picked} onToggle={(id) => setPicked((p) => toggleId(p, id))} />
        </>
      )}
      <ReceiptsCard receipts={finance.receipts.data} loading={finance.receipts.loading} onResend={resend} />
      <SendReceiptSheet open={send.open} onClose={() => setSend((s) => ({ ...s, open: false }))} user={currentUser} payable={finance.payable} preselected={send.pre} replaces={send.replaces}
        pendencyMeta={finance.pendencyById} onSent={() => { setPicked([]); finance.refresh(); }} />
    </div>
  );
};

export default MemberFinance;
