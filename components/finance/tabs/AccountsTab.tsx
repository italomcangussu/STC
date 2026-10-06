/**
 * Contas do clube (caixa, banco, cartão). O saldo é: saldo inicial + entradas −
 * saídas até hoje, sempre pela data real do dinheiro. Contas nunca são
 * apagadas: desativam-se (o histórico e os relatórios continuam).
 */
import React, { useState } from 'react';
import { Landmark, Plus, Star } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { notifyFinanceError } from '../../../lib/finance/errors';
import { accountBalances, saveAccount } from '../../../lib/finance/financeApi';
import type { FinAccount } from '../../../lib/finance/types';
import { brDate, type IsoDate } from '../../../lib/finance/dates';
import { useAsync, useRequestKey, useToday } from '../hooks';
import { useFinance } from '../FinanceContext';
import { Badge, Card, Empty, ErrorBlock, Field, Money, MoneyInput, Notice, Row, Sheet, Spinner, btnGhost, btnPrimary, inputCls } from '../ui';

const KIND_LABEL = { cash: 'Caixa (dinheiro)', bank: 'Conta bancária', card: 'Cartão / maquininha', other: 'Outra' } as const;

const AccountSheet: React.FC<{ account: FinAccount | 'new' | null; onClose: () => void; onDone: () => void }> = ({ account, onClose, onDone }) => {
  const today = useToday();
  const { key, renew } = useRequestKey();
  const editing = account && account !== 'new' ? account : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [kind, setKind] = useState<FinAccount['kind']>(editing?.kind ?? 'bank');
  const [opening, setOpening] = useState<number | null>(editing?.opening_balance_cents ?? 0);
  const [openingDate, setOpeningDate] = useState<IsoDate>((editing?.opening_date ?? today) as IsoDate);
  const [isDefault, setIsDefault] = useState(editing?.is_default_receipts ?? false);
  const [active, setActive] = useState(editing?.active ?? true);
  const [busy, setBusy] = useState(false);
  if (!account) return null;

  const save = async () => {
    setBusy(true);
    try {
      await saveAccount(editing?.id ?? null, editing?.version ?? null, { name: name.trim(), kind, opening_balance_cents: opening ?? 0, opening_date: openingDate, is_default_receipts: isDefault && active, active }, key);
      notify.success('Conta salva.'); renew(); onDone(); onClose();
    } catch (e) { notifyFinanceError(e, 'Não foi possível salvar a conta.', 'finance_account_save_failed'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={onClose} title={editing ? 'Editar conta' : 'Nova conta'}
      footer={<><button className={btnGhost} onClick={onClose}>Cancelar</button><button className={btnPrimary} disabled={busy || name.trim().length < 2} onClick={save}>Salvar</button></>}>
      <Field label="Nome"><input className={inputCls} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Tipo"><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as FinAccount['kind'])}>{Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Saldo inicial" hint="Quanto havia na conta na data abaixo."><MoneyInput value={opening} onChange={setOpening} /></Field>
        <Field label="Data do saldo inicial"><input type="date" className={inputCls} value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} /></Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-stone-700"><input type="checkbox" className="h-5 w-5" checked={isDefault} disabled={!active} onChange={(e) => setIsDefault(e.target.checked)} />Conta padrão de recebimentos</label>
      <p className="-mt-2 text-[11px] text-stone-400">Recebe os pagamentos de Card Mensal e Day Card feitos fora do módulo financeiro.</p>
      {editing && <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-stone-700"><input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => { setActive(e.target.checked); if (!e.target.checked) setIsDefault(false); }} />Conta ativa</label>}
      {editing && <Notice tone="warn">Mudar o saldo inicial ou a data reescreve o saldo de todo o histórico desta conta.</Notice>}
    </Sheet>
  );
};

const AccountsTab: React.FC = () => {
  const { accounts, reload } = useFinance();
  const [sheet, setSheet] = useState<FinAccount | 'new' | null>(null);
  const bal = useAsync(() => accountBalances(), [accounts]);
  const balanceOf = (id: string) => bal.data?.find((b) => b.id === id)?.balance_cents ?? null;

  return (
    <div className="space-y-4">
      {accounts.length > 0 && !accounts.some((a) => a.is_default_receipts) && <Notice tone="warn">Defina a conta padrão de recebimentos: sem ela, Card Mensal e Day Card aparecem como “sem conta” no caixa.</Notice>}
      <Card title="Contas" right={<button className={btnPrimary} onClick={() => setSheet('new')}><Plus size={16} /> Nova conta</button>}>
        {bal.error ? <ErrorBlock error={bal.error} onRetry={bal.reload} /> : bal.loading && accounts.length === 0 ? <Spinner /> : accounts.length === 0 ? (
          <Empty icon={<Landmark size={28} />} title="Nenhuma conta cadastrada" hint="Cadastre o caixa e a conta do banco para registrar recebimentos e pagamentos." />
        ) : (
          <ul className="space-y-2">
            {accounts.map((a) => (
              <li key={a.id}>
                <Row onClick={() => setSheet(a)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-black">{a.name}</p><p className="text-xs text-stone-500">{KIND_LABEL[a.kind]} · saldo inicial {brDate(a.opening_date)}</p></div>
                    <div className="text-right">{balanceOf(a.id) !== null ? <Money cents={balanceOf(a.id)!} className="text-sm font-black" /> : <span className="text-xs text-stone-300">—</span>}</div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">{a.is_default_receipts && <Badge tone="good"><Star size={10} className="mr-1" />Recebimentos</Badge>}{!a.active && <Badge tone="muted">Inativa</Badge>}</div>
                </Row>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <AccountSheet key={sheet === 'new' ? 'new' : sheet?.id ?? 'none'} account={sheet} onClose={() => setSheet(null)} onDone={() => { reload(); bal.reload(); }} />
    </div>
  );
};

export default AccountsTab;
