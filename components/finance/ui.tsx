/**
 * Peças de interface do módulo financeiro. Seguem o padrão visual do STC
 * (cards `rounded-3xl`, paleta `saibro`/`stone`, modal `StandardModal`) e são
 * pensadas para o celular: alvos de toque ≥ 44px, uma coluna, listas em
 * cartões em vez de tabelas largas.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, Info, Loader2 } from 'lucide-react';
import { formatBRL, parseBRL, formatDecimalBRL } from '../../lib/finance/money';
import { CHARGE_STATUS_LABEL, type ChargeDisplayStatus } from '../../lib/finance/memberBilling';
import { INDICATOR_DEFINITIONS, PERIOD_LABELS, resolvePeriod, type Period, type PeriodPreset } from '../../lib/finance/reports';
import { brDate, type IsoDate } from '../../lib/finance/dates';
import { exportFilename, toCsv, type ReportSpec } from '../../lib/finance/export';
import { downloadBlob } from './hooks';
import { financeErrorInfo, notifyFinanceError } from '../../lib/finance/errors';

export const inputCls = 'w-full min-w-0 max-w-full min-h-11rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-hidden focus:border-saibro-400 focus:ring-2 focus:ring-saibro-100 disabled:bg-stone-50 disabled:text-stone-400';
export const btnPrimary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-saibro-600 px-4 py-2 text-sm font-black text-white shadow-sm shadow-saibro-200 transition active:scale-95 hover:bg-saibro-700 disabled:opacity-50 disabled:active:scale-100';
export const btnGhost = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-600 transition active:scale-95 hover:bg-stone-50 disabled:opacity-50';
export const btnDanger = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 transition active:scale-95 hover:bg-red-100 disabled:opacity-50';

export const Money: React.FC<{ cents: number; className?: string; signed?: boolean }> = ({ cents, className = '', signed }) => (
  <span className={`tabular-nums ${cents < 0 ? 'text-red-600' : ''} ${className}`}>{signed && cents > 0 ? '+' : ''}{formatBRL(cents)}</span>
);

export const Card: React.FC<{ title?: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode; className?: string }> = ({ title, subtitle, right, children, className = '' }) => (
  <section className={`rounded-3xl border border-stone-100 bg-white p-4 shadow-sm md:p-5 ${className}`}>
    {(title || right) && (
      // No celular o título ocupa a linha inteira e as ações vêm logo abaixo,
      // alinhadas à esquerda e podendo quebrar: antes, ações largas (ex.: "Gerar
      // lançamentos" + "Nova") esmagavam o título até sumir atrás delas.
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          {title && <h3 className="text-base font-black text-stone-800">{title}</h3>}
          {subtitle && <p className="text-xs font-medium text-stone-500">{subtitle}</p>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{right}</div>}
      </header>
    )}
    {children}
  </section>
);

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'muted';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-stone-100 text-stone-700', good: 'bg-emerald-100 text-emerald-700', bad: 'bg-red-100 text-red-700',
  warn: 'bg-amber-100 text-amber-800', info: 'bg-sky-100 text-sky-700', muted: 'bg-stone-50 text-stone-400',
};

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode }> = ({ tone = 'neutral', children }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${toneCls[tone]}`}>{children}</span>
);

const statusTone: Record<ChargeDisplayStatus, Tone> = {
  forecast: 'muted', open: 'info', overdue: 'bad', partial: 'warn', paid: 'good', canceled: 'muted', in_review: 'warn',
};
export const ChargeStatusBadge: React.FC<{ status: ChargeDisplayStatus }> = ({ status }) => <Badge tone={statusTone[status]}>{CHARGE_STATUS_LABEL[status]}</Badge>;

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Carregando…' }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm font-medium text-stone-400" role="status">
    <Loader2 className="animate-spin" size={18} /> {label}
  </div>
);

export const ErrorBlock: React.FC<{ error: unknown; onRetry?: () => void }> = ({ error, onRetry }) => {
  const info = financeErrorInfo(error, 'Não foi possível carregar.');
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-red-100 bg-red-50 p-6 text-center" role="alert">
      <AlertTriangle className="text-red-500" size={24} />
      <p className="text-sm font-bold text-red-700">{info.message}</p>
      {info.hint && <p className="text-xs text-red-600">{info.hint}</p>}
      {onRetry && <button className={btnGhost} onClick={onRetry}>Tentar de novo</button>}
    </div>
  );
};

export const Empty: React.FC<{ title: string; hint?: string; action?: React.ReactNode; icon?: React.ReactNode }> = ({ title, hint, action, icon }) => (
  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-stone-200 px-4 py-10 text-center">
    {icon && <div className="text-stone-300">{icon}</div>}
    <p className="text-sm font-bold text-stone-600">{title}</p>
    {hint && <p className="max-w-sm text-xs text-stone-400">{hint}</p>}
    {action}
  </div>
);

export const Notice: React.FC<{ tone?: 'info' | 'warn' | 'bad'; title?: string; children: React.ReactNode }> = ({ tone = 'info', title, children }) => {
  const cls = tone === 'bad' ? 'border-red-200 bg-red-50 text-red-800' : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900';
  return (
    <div className={`rounded-2xl border p-3 text-xs ${cls}`} role={tone === 'info' ? 'note' : 'alert'}>
      {title && <p className="mb-0.5 text-sm font-black">{title}</p>}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
};

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; className?: string }> = ({ label, hint, children, className = '' }) => (
  <label className={`block min-w-0 space-y-1 ${className}`}>
    <span className="text-[11px] font-black uppercase tracking-wider text-stone-400">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-stone-400">{hint}</span>}
  </label>
);

/** Campo de dinheiro: o usuário digita "1.234,56"; o valor sai em centavos inteiros. */
export const MoneyInput: React.FC<{ value: number | null; onChange: (cents: number | null) => void; placeholder?: string; disabled?: boolean; 'aria-label'?: string }> = ({ value, onChange, placeholder = '0,00', disabled, ...rest }) => {
  const [text, setText] = useState(value === null ? '' : formatDecimalBRL(value));
  // Só reescreve o texto quando o valor mudou POR FORA (formulário reaberto, valor sugerido). Se o texto digitado
  // já vale esse número, deixa como está: antes, digitar "2" virava "2,00" e jogava o cursor para o fim.
  useEffect(() => {
    setText((current) => (parseBRL(current) === value ? current : value === null ? '' : formatDecimalBRL(value)));
  }, [value]);
  return (
    <input
      inputMode="decimal" className={inputCls} placeholder={placeholder} value={text} disabled={disabled} aria-label={rest['aria-label']}
      onChange={(e) => { setText(e.target.value); onChange(e.target.value.trim() === '' ? null : parseBRL(e.target.value)); }}
      onBlur={() => { const c = parseBRL(text); setText(c === null ? '' : formatDecimalBRL(c)); }}
    />
  );
};

// A folha em si é genérica e mora em `components/ui/Sheet.tsx`; o financeiro só a reexporta.
export { Sheet } from '../ui/Sheet';

/** Tag que deixa claro em que base o número foi calculado. */
export const BasisTag: React.FC<{ basis: 'competencia' | 'caixa' | 'posicao' | 'previsao' }> = ({ basis }) => {
  const map = { competencia: ['Competência', 'info'], caixa: ['Caixa (data real)', 'good'], posicao: ['Posição hoje', 'neutral'], previsao: ['Previsão', 'warn'] } as const;
  const [label, tone] = map[basis];
  return <Badge tone={tone}>{label}</Badge>;
};

/** Cartão de indicador com a definição (origem) a um toque. */
export const StatCard: React.FC<{ indicator: keyof typeof INDICATOR_DEFINITIONS; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'bad' | 'neutral' }> = ({ indicator, value, sub, tone = 'neutral' }) => {
  const [open, setOpen] = useState(false);
  const def = INDICATOR_DEFINITIONS[indicator];
  return (
    <div className="rounded-3xl border border-stone-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">{def.label}</p>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Como é calculado: ${def.label}`} className="-m-2 flex h-11 w-11 items-center justify-center text-stone-300 hover:text-saibro-600"><Info size={16} /></button>
      </div>
      <p className={`text-2xl font-black tabular-nums ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-stone-800'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
      <div className="mt-2"><BasisTag basis={def.basis} /></div>
      {open && (
        <p className="mt-2 rounded-xl bg-stone-50 p-2.5 text-[11px] leading-relaxed text-stone-600">
          {def.definition} <span className="font-bold text-stone-500">Origem: {def.source}.</span>
        </p>
      )}
    </div>
  );
};

/** Seletor de período com atalhos; mostra sempre o período escolhido por extenso. */
export const PeriodBar: React.FC<{ value: Period; onChange: (p: Period) => void; today: IsoDate; presets?: PeriodPreset[]; showDates?: boolean }> = ({ value, onChange, today, presets = ['month', 'prev_month', 'quarter', 'year', 'last_30', 'custom'], showDates = true }) => {
  const [custom, setCustom] = useState(false);
  const active = (['month', 'prev_month', 'quarter', 'year', 'last_30'] as const).find((p) => {
    const r = resolvePeriod(p, today);
    return r.from === value.from && r.to === value.to;
  });
  return (
    <div className="space-y-2">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" role="group" aria-label="Período">
        {presets.map((p) => {
          const isActive = p === 'custom' ? custom || !active : !custom && active === p;
          return (
            <button
              key={p} aria-pressed={isActive}
              onClick={() => { if (p === 'custom') setCustom(true); else { setCustom(false); onChange(resolvePeriod(p, today)); } }}
              className={`min-h-11 whitespace-nowrap rounded-full border px-3.5 text-xs font-bold transition-colors ${isActive ? 'border-saibro-300 bg-saibro-50 text-saibro-700' : 'border-stone-200 bg-white text-stone-500'}`}
            >{PERIOD_LABELS[p]}</button>
          );
        })}
      </div>
      {(custom || !active) && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="De"><input type="date" className={inputCls} value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to: value.to })} /></Field>
          <Field label="Até"><input type="date" className={inputCls} value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ from: value.from, to: e.target.value })} /></Field>
        </div>
      )}
      {showDates && <p className="text-xs font-bold text-stone-500">Período selecionado: {brDate(value.from)} a {brDate(value.to)}</p>}
    </div>
  );
};

/** Exporta o MESMO relatório que está na tela (CSV ou PDF), com totais e data de geração. */
export const ExportButtons: React.FC<{ getSpec: () => ReportSpec | null | Promise<ReportSpec | null>; disabled?: boolean }> = ({ getSpec, disabled }) => {
  const [busy, setBusy] = useState(false);
  const run = async (kind: 'csv' | 'pdf') => {
    setBusy(true);
    try {
      const spec = await getSpec();
      if (!spec) return;
      if (kind === 'csv') downloadBlob(new Blob([toCsv(spec)], { type: 'text/csv;charset=utf-8' }), exportFilename(spec, 'csv'));
      else {
        const { toPdf } = await import('../../lib/finance/exportPdf');
        downloadBlob(await toPdf(spec), exportFilename(spec, 'pdf'));
      }
    } catch (e) {
      notifyFinanceError(e, 'Não foi possível gerar o arquivo.', 'finance_export_failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex gap-2">
      <button className={btnGhost} disabled={disabled || busy} onClick={() => run('csv')}><Download size={16} /> Planilha (CSV)</button>
      <button className={btnGhost} disabled={disabled || busy} onClick={() => run('pdf')}><Download size={16} /> PDF</button>
    </div>
  );
};

/** Linha de lista que vira cartão no celular. */
export const Row: React.FC<{ children: React.ReactNode; onClick?: () => void; className?: string }> = ({ children, onClick, className = '' }) => (
  <div
    className={`rounded-2xl border border-stone-100 bg-stone-50/60 p-3 ${onClick ? 'cursor-pointer hover:border-saibro-200' : ''} ${className}`}
    onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
  >{children}</div>
);

type TabItem = { id: string; label: string; badge?: number };

/**
 * Abas em dois estilos, para que níveis diferentes de navegação não pareçam o
 * mesmo controle: `segmented` (blocos de largura igual, o nível de cima) e
 * `chips` (pílulas roláveis, o nível de baixo).
 */
export const SectionTabs: React.FC<{ items: TabItem[]; value: string; onChange: (id: string) => void; label: string; variant?: 'chips' | 'segmented' }> = ({ items, value, onChange, label, variant = 'chips' }) => {
  const badge = (n?: number) => !!n && <span className="ml-1.5 rounded-full bg-saibro-600 px-1.5 py-0.5 text-[10px] font-black text-white">{n}<span className="sr-only"> pendentes</span></span>;
  // No seletor de blocos o selo flutua no canto: dentro do texto ele disputava a largura com o nome da aba.
  const cornerBadge = (n?: number) => !!n && <span className="absolute right-1 top-0.5 min-w-4 rounded-full bg-saibro-600 px-1 text-center text-[10px] font-black leading-4 text-white">{n}<span className="sr-only"> pendentes</span></span>;
  if (variant === 'segmented') {
    return (
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-stone-100 p-1" role="tablist" aria-label={label}>
        {items.map((i) => (
          <button
            key={i.id} role="tab" aria-selected={i.id === value} onClick={() => onChange(i.id)}
            className={`relative min-h-11 min-w-0 rounded-xl px-1 text-sm font-bold transition ${i.id === value ? 'bg-white text-saibro-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
          >
            {i.label}{cornerBadge(i.badge)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label={label}>
      {items.map((i) => (
        <button
          key={i.id} role="tab" aria-selected={i.id === value} onClick={() => onChange(i.id)}
          className={`min-h-11 whitespace-nowrap rounded-full border px-3.5 text-xs font-bold transition-colors ${i.id === value ? 'border-saibro-300 bg-saibro-50 text-saibro-700' : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300'}`}
        >
          {i.label}{badge(i.badge)}
        </button>
      ))}
    </div>
  );
};
