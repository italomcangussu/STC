import React from 'react';
import { BellRing, Settings2 } from 'lucide-react';
import type { FinSettings } from '../../../../lib/finance/types';
import { feeText, reminderDaysText } from '../../../../lib/finance/pendencies';
import { Badge, Card, Spinner, btnGhost } from '../../ui';

const Item: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="rounded-2xl bg-stone-50 p-3"><dt className="text-[10px] font-black uppercase tracking-wide text-stone-400">{label}</dt><dd className="mt-0.5 text-sm font-bold text-stone-700">{children}</dd></div>
);

const FeeItems: React.FC<{ settings: FinSettings }> = ({ settings: s }) => {
  const fine = feeText(s.pendency_fine_fixed_cents, s.pendency_fine_percent_bps);
  const interest = feeText(s.pendency_interest_daily_fixed_cents, s.pendency_interest_daily_percent_bps);
  if (!fine && !interest) return <Item label="Multa e juros">Não cobra</Item>;
  return <>{fine && <Item label="Multa">{fine}</Item>}{interest && <Item label="Juros por dia">{interest}</Item>}</>;
};

const PixItem: React.FC<{ pixKey: string | null }> = ({ pixKey }) => (
  <Item label="Chave PIX">{pixKey?.trim() ? <span className="break-all">{pixKey}</span> : <span className="text-amber-700">Não configurada</span>}</Item>
);

/** Resumo VIVO da régua (lido de `settings`), com o atalho para configurar. */
export const RulesSummary: React.FC<{ settings: FinSettings | null; onConfigure: () => void }> = ({ settings: s, onConfigure }) => {
  const configure = <button className={`${btnGhost} w-full sm:w-auto`} onClick={onConfigure}><Settings2 size={16} /> Configurar</button>;
  if (!s) return <Card title="Régua de cobrança" right={configure}><Spinner /></Card>;
  return (
    <Card
      title={<span className="flex items-center gap-2"><BellRing size={18} className="text-stone-400" /> Régua de cobrança <Badge tone={s.pendency_automation_enabled ? 'good' : 'muted'}>{s.pendency_automation_enabled ? 'Ativa' : 'Pausada'}</Badge></span>}
      subtitle="Antes de cada envio o saldo é recalculado e as pendências abertas do sócio vão numa mensagem só."
      right={configure}>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Item label="Envios">{reminderDaysText(s.pendency_reminder_days)}</Item>
        <Item label="Carência">{s.pendency_grace_days ? `${s.pendency_grace_days} dia(s) após o vencimento` : 'Sem carência'}</Item>
        <FeeItems settings={s} />
        <PixItem pixKey={s.pix_key} />
      </dl>
      <p className="mt-3 text-xs text-stone-500">Comprovante com leitura segura dá baixa sozinho; na dúvida vai para revisão. Pagamento parcial mantém o saldo; excedente vira crédito do sócio.</p>
    </Card>
  );
};
