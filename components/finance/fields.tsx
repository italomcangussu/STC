import React from 'react';
import type { FinAccount } from '../../lib/finance/types';
import { inputCls } from './ui';

export const PAYMENT_METHODS = [['pix', 'Pix'], ['transfer', 'Transferência'], ['cash', 'Dinheiro'], ['card', 'Cartão'], ['other', 'Outro']] as const;

export const MethodSelect: React.FC<{ value: string; onChange: (method: string) => void }> = ({ value, onChange }) => (
  <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
    {PAYMENT_METHODS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
  </select>
);

/** Contas ativas do clube. Com `placeholder`, a primeira opção é a vazia ("Escolha…") e a pessoa precisa decidir. */
export const AccountSelect: React.FC<{ accounts: FinAccount[]; value: string; onChange: (accountId: string) => void; placeholder?: string }> = ({ accounts, value, onChange, placeholder }) => (
  <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
    {placeholder && <option value="">{placeholder}</option>}
    {accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
  </select>
);
