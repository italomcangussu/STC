import React from 'react';
import { Search, X } from 'lucide-react';
import { useAdminEmbedded } from './AdminEmbedContext';

/**
 * Peças comuns das telas do painel admin. Existem para que a mesma coisa
 * (buscar, filtrar, criar) tenha a mesma cara e o mesmo tamanho de toque em
 * todas as áreas, em vez de cada tela reinventar o seu botão e o seu chip.
 */

/** Botão de ação principal (Novo aluno, Novo aviso…). Largura total no celular: o polegar acerta sem mirar. */
export const adminBtnPrimary =
    'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-saibro-600 px-4 py-2 text-sm font-bold text-white shadow-sm shadow-saibro-200 transition active:scale-95 hover:bg-saibro-700 disabled:opacity-50 sm:w-auto';

export const adminBtnGhost =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-600 transition active:scale-95 hover:bg-stone-50 disabled:opacity-50';

/**
 * Cabeçalho de tela. Dentro do painel o título já está no topo da página, então
 * só as ações aparecem; fora dele (rota própria) a tela se apresenta sozinha.
 * Título e ações nunca disputam a mesma linha: no celular empilham.
 */
export const AdminPageHeader: React.FC<{
    icon?: React.ReactNode;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
}> = ({ icon, title, subtitle, actions }) => {
    const embedded = useAdminEmbedded();
    if (embedded && !actions) return null;
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {!embedded && (
                <div className="min-w-0">
                    <h1 className="flex items-center gap-2 text-xl font-black tracking-tight text-stone-800 md:text-2xl">
                        {icon}<span className="min-w-0">{title}</span>
                    </h1>
                    {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
                </div>
            )}
            {actions && <div className={`flex flex-wrap gap-2 ${embedded ? 'sm:ml-auto' : ''}`}>{actions}</div>}
        </div>
    );
};

/** Campo de busca padrão: 44 px de altura, botão de limpar e teclado de busca no iOS. */
export const AdminSearch: React.FC<{
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    label: string;
    className?: string;
}> = ({ value, onChange, placeholder, label, className = '' }) => (
    <div className={`relative ${className}`}>
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden />
        <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            autoComplete="off"
            className="min-h-11 w-full min-w-0 appearance-none rounded-xl border border-stone-200 bg-white py-2 pl-10 pr-10 text-sm text-stone-700 outline-hidden focus:border-saibro-400 focus:ring-2 focus:ring-saibro-100 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
            <button
                type="button"
                onClick={() => onChange('')}
                aria-label="Limpar busca"
                className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            >
                <X size={16} />
            </button>
        )}
    </div>
);

export interface ChipItem<T extends string> {
    id: T;
    label: React.ReactNode;
}

/** Filtro por chips: alvo de 44 px, quebra de linha em vez de rolar para o lado. */
export function ChipGroup<T extends string>({ items, value, onChange, label, className = '' }: {
    items: ReadonlyArray<ChipItem<T>>;
    value: T;
    onChange: (id: T) => void;
    label: string;
    className?: string;
}) {
    return (
        <div role="group" aria-label={label} className={`flex flex-wrap gap-2 ${className}`}>
            {items.map(i => {
                const on = i.id === value;
                return (
                    <button
                        key={i.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(i.id)}
                        className={`min-h-11 rounded-full border px-4 text-sm font-bold transition-colors ${on ? 'border-saibro-300 bg-saibro-50 text-saibro-700' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'}`}
                    >
                        {i.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Estado vazio padrão das listas do painel. */
export const AdminEmpty: React.FC<{ title: string; hint?: string; icon?: React.ReactNode }> = ({ title, hint, icon }) => (
    <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-stone-200 px-4 py-10 text-center">
        {icon && <div className="text-stone-300" aria-hidden>{icon}</div>}
        <p className="text-sm font-bold text-stone-600">{title}</p>
        {hint && <p className="max-w-sm text-xs text-stone-400">{hint}</p>}
    </div>
);

/** Campo de formulário do painel: 44 px de altura, `min-w-0` para nunca estourar a coluna do grid. */
export const adminInputCls =
    'min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-800 outline-hidden placeholder:text-stone-300 focus:border-saibro-400 focus:ring-2 focus:ring-saibro-100 disabled:bg-stone-50 disabled:text-stone-400';

/**
 * Rótulo + campo + dica/erro. O `<label>` envolve o campo, então tocar no texto
 * foca o campo e leitores de tela leem o nome certo, sem `id`/`htmlFor` soltos.
 */
export const AdminField: React.FC<{
    label: React.ReactNode;
    hint?: React.ReactNode;
    error?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}> = ({ label, hint, error, children, className = '' }) => (
    <label className={`block min-w-0 space-y-1 ${className}`}>
        <span className="text-[11px] font-black uppercase tracking-wider text-stone-400">{label}</span>
        {children}
        {error ? (
            <span role="alert" className="block text-xs font-medium text-red-600">{error}</span>
        ) : hint ? (
            <span className="block text-xs text-stone-400">{hint}</span>
        ) : null}
    </label>
);

/** Selo de estado (Ativo/Inativo, Pago…). Cor + texto: nunca só cor. */
export const StatusPill: React.FC<{ tone: 'good' | 'bad' | 'muted' | 'warn'; children: React.ReactNode }> = ({ tone, children }) => {
    const cls = { good: 'bg-emerald-100 text-emerald-700', bad: 'bg-red-100 text-red-700', muted: 'bg-stone-100 text-stone-500', warn: 'bg-amber-100 text-amber-800' }[tone];
    return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${cls}`}>{children}</span>;
};

/** Bloco de número no topo de uma tela: grande, com legenda curta. */
export const StatTile: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
    <div className="min-w-0 rounded-2xl border border-stone-100 bg-stone-50/70 p-3">
        <p className="truncate text-[11px] font-black uppercase tracking-wider text-stone-400">{label}</p>
        <p className="text-2xl font-black tabular-nums text-stone-800">{value}</p>
        {hint && <p className="truncate text-xs text-stone-400">{hint}</p>}
    </div>
);
