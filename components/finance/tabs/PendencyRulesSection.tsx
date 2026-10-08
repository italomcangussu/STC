/**
 * Régua de cobrança das pendências de sócio: ativa/pausada, PIX, dias de envio,
 * carência, multa e juros. Abre a partir de Receber › Pendências ("Configurar
 * régua"), dentro de uma folha (`bare`); sem `bare`, ainda se embrulha num Card.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { BellRing } from 'lucide-react';
import { notify } from '../../../lib/notifications';
import { notifyFinanceError } from '../../../lib/finance/errors';
import { saveSettings } from '../../../lib/finance/financeApi';
import type { FinSettings } from '../../../lib/finance/types';
import { parseBRL } from '../../../lib/finance/money';
import { useRequestKey } from '../hooks';
import { Badge, Card, Field, MoneyInput, Notice, btnPrimary, inputCls } from '../ui';

const percentToBps = (text: string): number | null => {
  if (!text.trim()) return 0;
  const n = parseBRL(text.trim().replace('%', ''));
  return n === null ? Number.NaN : Math.round((n / 100) * 100);
};

const bpsToText = (bps: number) =>
  (bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false });

export const PendencyRulesSection: React.FC<{ s: FinSettings; onSaved: () => void; /** Sem o Card externo (para dentro de uma folha). */ bare?: boolean }> = ({ s, onSaved, bare }) => {
  const { key, renew } = useRequestKey();
  const [enabled, setEnabled] = useState(s.pendency_automation_enabled);
  const [pix, setPix] = useState(s.pix_key);
  const [days, setDays] = useState(s.pendency_reminder_days.join(', '));
  const [grace, setGrace] = useState(String(s.pendency_grace_days));
  const [fineFixed, setFineFixed] = useState<number | null>(s.pendency_fine_fixed_cents);
  const [finePct, setFinePct] = useState(bpsToText(s.pendency_fine_percent_bps));
  const [intFixed, setIntFixed] = useState<number | null>(s.pendency_interest_daily_fixed_cents);
  const [intPct, setIntPct] = useState(bpsToText(s.pendency_interest_daily_percent_bps));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(s.pendency_automation_enabled);
    setPix(s.pix_key);
    setDays(s.pendency_reminder_days.join(', '));
    setGrace(String(s.pendency_grace_days));
    setFineFixed(s.pendency_fine_fixed_cents);
    setFinePct(bpsToText(s.pendency_fine_percent_bps));
    setIntFixed(s.pendency_interest_daily_fixed_cents);
    setIntPct(bpsToText(s.pendency_interest_daily_percent_bps));
  }, [s.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const reminderDays = useMemo(() => {
    const raw = days.split(/[,; ]+/).map((v) => v.trim()).filter(Boolean);
    const parsed = raw.map(Number);
    if (!parsed.length || parsed.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) return null;
    return [...new Set(parsed)].sort((a, b) => a - b);
  }, [days]);

  const fineBps = percentToBps(finePct);
  const intBps = percentToBps(intPct);
  const invalid = !pix.trim() || !reminderDays || Number.isNaN(fineBps) || Number.isNaN(intBps) || Number(grace) < 0;

  const save = async () => {
    if (invalid || !reminderDays) return;
    setBusy(true);
    try {
      await saveSettings(s.version, {
        pix_key: pix.trim(),
        pendency_automation_enabled: enabled,
        pendency_reminder_days: reminderDays,
        pendency_grace_days: Number(grace) || 0,
        pendency_fine_fixed_cents: fineFixed ?? 0,
        pendency_fine_percent_bps: fineBps ?? 0,
        pendency_interest_daily_fixed_cents: intFixed ?? 0,
        pendency_interest_daily_percent_bps: intBps ?? 0,
      }, key);
      notify.success('Régua de pendências salva.');
      renew();
      onSaved();
    } catch (e) {
      notifyFinanceError(e, 'Não foi possível salvar a régua de pendências.', 'finance_pendency_settings_save_failed');
    } finally {
      setBusy(false);
    }
  };

  const form = (
      <div className="space-y-3">
        <label className="flex min-h-11 items-start gap-3 rounded-2xl border border-stone-200 p-3">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            <b className="block text-sm text-stone-800">Cobrança automática ativa</b>
            <span className="text-xs text-stone-500">Desligar pausa a régua global. “Cobrar agora” continua disponível para o administrador.</span>
          </span>
        </label>

        <Field label="Chave PIX do clube" hint="Incluída automaticamente nas cobranças.">
          <input className={inputCls} value={pix} maxLength={120} onChange={(e) => setPix(e.target.value)} />
        </Field>

        <Field label="Dias da régua" hint="0 = no vencimento. Depois, dias corridos após o vencimento. Ex.: 0, 3, 7, 14, 21.">
          <input className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={!reminderDays} />
        </Field>
        {!reminderDays && <p className="text-xs font-bold text-red-600">Use números de 0 a 365 separados por vírgula.</p>}

        <Notice tone="info">
          Antes de cada envio, o sistema recalcula o saldo e consolida todas as pendências abertas do sócio. Quando o saldo chega a zero, as cobranças futuras param automaticamente.
        </Notice>

        <div className="grid grid-cols-2 items-end gap-3">
          <Field label="Carência da pendência (dias)">
            <input inputMode="numeric" className={inputCls} value={grace} onChange={(e) => setGrace(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
          </Field>
          <div />
          <Field label="Multa fixa da pendência (R$)"><MoneyInput value={fineFixed} onChange={setFineFixed} /></Field>
          <Field label="Multa da pendência (%)"><input inputMode="decimal" className={inputCls} value={finePct} placeholder="0" onChange={(e) => setFinePct(e.target.value)} aria-invalid={Number.isNaN(fineBps)} /></Field>
          <Field label="Juros fixos por dia da pendência (R$)"><MoneyInput value={intFixed} onChange={setIntFixed} /></Field>
          <Field label="Juros por dia da pendência (%)"><input inputMode="decimal" className={inputCls} value={intPct} placeholder="0" onChange={(e) => setIntPct(e.target.value)} aria-invalid={Number.isNaN(intBps)} /></Field>
        </div>

        <p className="text-xs text-stone-500">O padrão é zero de multa e juros. Valores só são aplicados depois de configurados aqui.</p>
        <button className={`${btnPrimary} w-full sm:w-auto`} disabled={busy || invalid} onClick={save}>Salvar pendências e automação</button>
      </div>
  );

  if (bare) return form;
  return (
    <Card
      title="Pendências de sócios"
      subtitle="Régua de cobrança, PIX e encargos próprios das pendências manuais."
      right={<div className="flex items-center gap-2"><Badge tone={enabled ? 'good' : 'muted'}>{enabled ? 'Ativa' : 'Pausada'}</Badge><BellRing size={18} className="text-stone-300" /></div>}
    >
      {form}
    </Card>
  );
};

export default PendencyRulesSection;
