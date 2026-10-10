import React, { useEffect, useRef, useState } from 'react';
import { LayoutDashboard, Search, X } from 'lucide-react';
import { ADMIN_GROUPS, groupOf, searchSections, type AdminGroup, type AdminSection, type AdminTabId } from './adminSections';
import { AREA_ICON, PANEL_DOM_ID, SECTION_ICON, tabDomId, type PendingBySection } from './adminNavMeta';

const countOfGroup = (g: AdminGroup, pending: PendingBySection) =>
    g.sections.reduce((n, s) => n + (pending[s.id] ?? 0), 0);

const Badge: React.FC<{ n: number; className?: string }> = ({ n, className = '' }) => (
    <span className={`inline-flex min-w-5 items-center justify-center rounded-full bg-saibro-600 px-1.5 text-[10px] font-black leading-5 text-white ${className}`}>
        {n > 99 ? '99+' : n}<span className="sr-only"> pendentes</span>
    </span>
);

/**
 * Navegação em dois níveis, cada um com uma cara própria para ninguém se
 * perder: áreas (blocos com ícone, sempre visíveis) e, dentro da área, as
 * seções (abas sublinhadas). Selos mostram onde há algo esperando o administrador.
 */
export const AdminNav: React.FC<{ active: AdminTabId; onGo: (id: AdminTabId) => void; pending?: PendingBySection }> = ({ active, onGo, pending = {} }) => {
    const group = groupOf(active);
    const activeRef = useRef<HTMLButtonElement>(null);

    // Em telas estreitas a faixa de seções rola; garante que a aberta esteja à vista.
    useEffect(() => {
        // Só o eixo X da faixa: `scrollIntoView` também rolaria a página e deslocaria a tela.
        const el = activeRef.current;
        const strip = el?.parentElement;
        if (el && strip) strip.scrollTo?.({ left: el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
    }, [active]);

    return (
        <nav aria-label="Painel administrativo" className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-lg shadow-stone-900/5">
            <div role="tablist" aria-label="Áreas" className="grid grid-cols-5 gap-0.5 p-1.5">
                {ADMIN_GROUPS.map(g => {
                    const Icon = AREA_ICON[g.id] ?? LayoutDashboard;
                    const on = g.id === group.id;
                    const n = countOfGroup(g, pending);
                    return (
                        <button
                            key={g.id}
                            type="button"
                            role="tab"
                            aria-selected={on}
                            onClick={() => onGo(on ? active : g.sections[0].id)}
                            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1.5 transition-colors active:scale-95 ${on ? 'bg-saibro-600 text-white shadow-md shadow-saibro-200' : 'text-stone-500 hover:bg-stone-100'}`}
                        >
                            <Icon size={20} aria-hidden />
                            <span className="w-full truncate text-center text-[10px] font-bold leading-tight tracking-tight min-[420px]:text-[11px]">{g.label}</span>
                            {n > 0 && !on && <Badge n={n} className="absolute right-1 top-0.5 scale-90" />}
                        </button>
                    );
                })}
            </div>

            {group.sections.length > 1 && (
                <div role="tablist" aria-label={group.label} className="admin-tab-strip flex gap-1 overflow-x-auto overflow-y-hidden border-t border-stone-100 px-2 scrollbar-hide">
                    {group.sections.map(s => {
                        const on = s.id === active;
                        const n = pending[s.id] ?? 0;
                        return (
                            <button
                                key={s.id}
                                ref={on ? activeRef : undefined}
                                id={tabDomId(s.id)}
                                type="button"
                                role="tab"
                                aria-selected={on}
                                aria-controls={PANEL_DOM_ID}
                                onClick={() => onGo(s.id)}
                                className={`relative flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-bold transition-colors ${on ? 'text-saibro-700 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-saibro-600' : 'text-stone-500 hover:text-stone-800'}`}
                            >
                                {s.label}
                                {n > 0 && <Badge n={n} />}
                            </button>
                        );
                    })}
                </div>
            )}
        </nav>
    );
};

/** Título único da página: ícone, nome da seção e uma linha dizendo para que ela serve. */
export const AdminSectionHeading: React.FC<{ section: AdminSection }> = ({ section }) => {
    const Icon = SECTION_ICON[section.id];
    return (
        <div className="flex items-center gap-3 px-1 pb-3 pt-5">
            <div className="shrink-0 rounded-2xl bg-saibro-100 p-2.5 text-saibro-700"><Icon size={22} aria-hidden /></div>
            <div className="min-w-0">
                <h1 className="truncate text-xl font-black tracking-tight text-stone-800 md:text-2xl">{section.label}</h1>
                <p className="text-sm text-stone-500">{section.hint}</p>
            </div>
        </div>
    );
};

/** "O que você quer fazer?": busca as seções por nome, descrição e palavras-chave, com teclado. */
export const AdminSearchBox: React.FC<{ onGo: (id: AdminTabId) => void }> = ({ onGo }) => {
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const results = searchSections(query);
    const listId = 'admin-search-results';

    useEffect(() => { setCursor(0); }, [query]);

    const pick = (id: AdminTabId) => {
        setQuery('');
        onGo(id);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') { setQuery(''); return; }
        if (!results.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % results.length); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + results.length) % results.length); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(results[cursor].id); }
    };

    return (
        <div className="relative z-30 max-w-xl">
            <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden />
            <input
                type="search"
                inputMode="search"
                enterKeyHint="go"
                role="combobox"
                aria-expanded={!!query}
                aria-controls={listId}
                aria-activedescendant={query && results.length ? `${listId}-${results[cursor].id}` : undefined}
                aria-label="Buscar seção do painel"
                autoComplete="off"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="O que você quer fazer? (ex.: aluno)"
                className="min-h-12 w-full min-w-0 appearance-none rounded-2xl bg-white py-2.5 pl-10 pr-10 text-sm text-stone-700 outline-hidden focus:ring-2 focus:ring-saibro-300 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
                <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Limpar busca"
                    className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100"
                ><X size={16} /></button>
            )}
            {query && (
                <ul id={listId} role="listbox" aria-label="Seções encontradas" className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl border border-stone-100 bg-white shadow-xl">
                    {results.length === 0 ? (
                        <li className="px-4 py-3 text-sm text-stone-400">Nada encontrado. Tente “aluno”, “mensalidade” ou “reserva”.</li>
                    ) : results.map((r, i) => {
                        const Icon = SECTION_ICON[r.id];
                        return (
                            <li
                                key={r.id}
                                id={`${listId}-${r.id}`}
                                role="option"
                                aria-selected={i === cursor}
                                onMouseEnter={() => setCursor(i)}
                                onClick={() => pick(r.id)}
                                className={`flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 ${i === cursor ? 'bg-saibro-50' : ''}`}
                            >
                                <Icon size={18} className="shrink-0 text-saibro-600" aria-hidden />
                                <span className="min-w-0">
                                    <span className="block text-sm font-bold text-stone-700">{r.label}</span>
                                    <span className="block truncate text-xs text-stone-400">{groupOf(r.id).label} · {r.hint}</span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};
