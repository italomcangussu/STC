import React from 'react';
import { CheckCircle2, Lock, SearchX, Sparkles, WifiOff } from 'lucide-react';

/**
 * Os cinco vazios. Cada um diz o que houve e qual é a saída; tela em branco
 * não existe.
 *
 * - `primeira-vez`: nada ainda; convida a criar (a ação é a saída).
 * - `tudo-feito`: a lista zerou por mérito ("Nenhum desafio pendente").
 * - `sem-resultado`: o filtro/busca não achou; oferece limpar.
 * - `sem-permissao`: existe, mas não para este papel; diz com quem falar.
 * - `erro`: não carregou; diz a causa e oferece tentar de novo.
 */
export type EmptyKind = 'primeira-vez' | 'tudo-feito' | 'sem-resultado' | 'sem-permissao' | 'erro';

const icones: Record<EmptyKind, React.ReactNode> = {
    'primeira-vez': <Sparkles size={28} />,
    'tudo-feito': <CheckCircle2 size={28} />,
    'sem-resultado': <SearchX size={28} />,
    'sem-permissao': <Lock size={28} />,
    erro: <WifiOff size={28} />,
};

export const EmptyState: React.FC<{
    kind?: EmptyKind;
    title: React.ReactNode;
    hint?: React.ReactNode;
    /** A saída: um `<Button>` (criar, limpar filtro, tentar de novo). */
    action?: React.ReactNode;
    icon?: React.ReactNode;
    /** Sem moldura, para quando já está dentro de um card. */
    bare?: boolean;
    className?: string;
}> = ({ kind = 'primeira-vez', title, hint, action, icon, bare, className = '' }) => (
    <div
        role={kind === 'erro' ? 'alert' : 'status'}
        className={`flex flex-col items-center gap-2 px-4 py-10 text-center ${bare ? '' : 'rounded-card border border-dashed border-linha'} ${className}`}
    >
        <span className={kind === 'erro' ? 'text-erro' : kind === 'tudo-feito' ? 'text-sucesso' : 'text-texto-3'} aria-hidden>
            {icon ?? icones[kind]}
        </span>
        <p className="text-base font-semibold text-texto">{title}</p>
        {hint && <p className="max-w-sm text-sm text-texto-2">{hint}</p>}
        {action && <div className="mt-2">{action}</div>}
    </div>
);
