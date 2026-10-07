/**
 * Peças de interface de Documentos e Assinaturas. Mesmo padrão visual do STC (cards `rounded-3xl`,
 * paleta `saibro`/`stone`, alvos de toque ≥ 44 px, uma coluna).
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';

export const inputCls = 'w-full min-w-0 max-w-full min-h-11 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-hidden focus:border-saibro-400 focus:ring-2 focus:ring-saibro-100 disabled:bg-stone-50 disabled:text-stone-400';
export const btnPrimary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-saibro-600 px-4 py-2 text-sm font-black text-white shadow-sm shadow-saibro-200 transition active:scale-95 hover:bg-saibro-700 disabled:opacity-50 disabled:active:scale-100';
export const btnGhost = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-600 transition active:scale-95 hover:bg-stone-50 disabled:opacity-50';

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Carregando…' }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm font-medium text-stone-400" role="status">
    <Loader2 className="animate-spin" size={18} /> {label}
  </div>
);

type NoticeTone = 'info' | 'warn' | 'bad' | 'good';
const noticeCls: Record<NoticeTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  bad: 'border-red-200 bg-red-50 text-red-800',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

export const Notice: React.FC<{ tone?: NoticeTone; title?: string; children: React.ReactNode; action?: React.ReactNode }> = ({ tone = 'info', title, children, action }) => {
  const Icon = tone === 'bad' || tone === 'warn' ? AlertTriangle : tone === 'good' ? CheckCircle2 : Info;
  return (
    <div className={`flex gap-2.5 rounded-2xl border p-3 text-xs ${noticeCls[tone]}`} role={tone === 'info' || tone === 'good' ? 'status' : 'alert'}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="mb-0.5 text-sm font-black">{title}</p>}
        {children}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
};

type BadgeTone = 'neutral' | 'good' | 'bad' | 'warn' | 'info';
const badgeCls: Record<BadgeTone, string> = {
  neutral: 'bg-stone-100 text-stone-700', good: 'bg-emerald-100 text-emerald-700', bad: 'bg-red-100 text-red-700',
  warn: 'bg-amber-100 text-amber-800', info: 'bg-sky-100 text-sky-700',
};
export const Badge: React.FC<{ tone?: BadgeTone; children: React.ReactNode }> = ({ tone = 'neutral', children }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${badgeCls[tone]}`}>{children}</span>
);

/** Um passo do caminho de assinatura: número (ou ✓), título e o conteúdo do passo. */
export const Step: React.FC<{ n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode }> = ({ n, title, done, active, children }) => (
  <section className={`rounded-3xl border p-4 shadow-sm transition ${done ? 'border-emerald-200 bg-emerald-50/40' : active ? 'border-saibro-300 bg-white' : 'border-stone-100 bg-white/60'}`} aria-label={`Passo ${n}: ${title}`}>
    <header className="flex items-center gap-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${done ? 'bg-emerald-500 text-white' : active ? 'bg-saibro-600 text-white' : 'bg-stone-200 text-stone-500'}`} aria-hidden>
        {done ? <CheckCircle2 size={16} /> : n}
      </span>
      <h3 className={`text-sm font-black ${active || done ? 'text-stone-800' : 'text-stone-400'}`}>{title}</h3>
    </header>
    {children && <div className="mt-3 space-y-3 pl-10">{children}</div>}
  </section>
);
