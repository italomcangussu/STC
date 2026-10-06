/**
 * Peças de interface de Conversas. Reaproveitam o desenho do módulo financeiro (cards `rounded-3xl`,
 * paleta saibro/stone, `Sheet` sobre `StandardModal`) e acrescentam o `Button`/`InlineAlert` que o
 * chat do North Jato usa, já com os tokens do STC.
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { cx } from '../../lib/conversations/cx';

// eslint-disable-next-line react-refresh/only-export-components
export { inputCls, btnPrimary, btnGhost, btnDanger, Card, Badge, Spinner, Empty, Notice, Field, Sheet, SectionTabs } from '../finance/ui';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-saibro-600 text-white shadow-sm shadow-saibro-200 hover:bg-saibro-700',
  secondary: 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50',
  ghost: 'text-stone-600 hover:bg-stone-100',
  danger: 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean };

export const Button: React.FC<ButtonProps> = ({ variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', ...rest }) => (
  <button
    type={type}
    disabled={disabled || loading}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-xl font-bold outline-hidden transition active:scale-95 focus-visible:ring-2 focus-visible:ring-saibro-300 disabled:opacity-50 disabled:active:scale-100',
      size === 'sm' ? 'min-h-9 px-3 text-xs' : 'min-h-11 px-4 text-sm', VARIANT[variant], className)}
    {...rest}
  >
    {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
    {children}
  </button>
);

type AlertProps = {
  tone?: 'info' | 'error' | 'success' | 'warning';
  title: string;
  description?: React.ReactNode;
  onDismiss?: () => void;
  action?: { label: string; onClick: () => void };
};

const ALERT: Record<NonNullable<AlertProps['tone']>, { box: string; Icon: typeof Info }> = {
  info: { box: 'border-sky-200 bg-sky-50 text-sky-900', Icon: Info },
  error: { box: 'border-red-200 bg-red-50 text-red-800', Icon: AlertTriangle },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', Icon: AlertTriangle },
};

export const InlineAlert: React.FC<AlertProps> = ({ tone = 'info', title, description, onDismiss, action }) => {
  const { box, Icon } = ALERT[tone];
  return (
    <div role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'} className={cx('flex items-start gap-2 rounded-xl border p-3 text-xs', box)}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-bold">{title}</p>
        {description && <div className="mt-0.5 leading-relaxed">{description}</div>}
        {action && <button type="button" onClick={action.onClick} className="mt-1 font-bold underline underline-offset-2">{action.label}</button>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dispensar aviso" className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-black/5"><X size={14} aria-hidden /></button>
      )}
    </div>
  );
};

export const LoadingSpinner: React.FC<{ text?: string }> = ({ text = 'Carregando…' }) => (
  <div className="flex items-center justify-center gap-2 text-sm font-medium text-stone-400" role="status">
    <Loader2 className="animate-spin" size={16} aria-hidden /> {text}
  </div>
);

export const fieldCls = 'min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-hidden focus:border-saibro-400 focus:ring-2 focus:ring-saibro-100 disabled:bg-stone-50 disabled:text-stone-400';
