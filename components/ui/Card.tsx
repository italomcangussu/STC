import React from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * Card: superfície branca, borda de 1 px, raio 14 e sombra de contato.
 * Clicável só como `<button>` (nunca `div onClick`): ganha foco, teclado e
 * a resposta ao toque. Card dentro de card não existe; agrupe com espaço.
 */
type CardBase = { className?: string; children: React.ReactNode; padding?: 'none' | 'sm' | 'md' };
type CardEstatico = CardBase & React.HTMLAttributes<HTMLDivElement> & { as?: 'div' | 'section' | 'article' };
type CardBotao = CardBase & React.ButtonHTMLAttributes<HTMLButtonElement> & { as: 'button' };

const pad = { none: '', sm: 'p-3', md: 'p-4' };
const superficie = 'rounded-card border border-linha bg-superficie shadow-e1';

export function Card(props: CardEstatico | CardBotao) {
    const { className = '', padding = 'md', children } = props;
    if (props.as === 'button') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { as: _as, padding: _p, className: _c, children: _ch, type = 'button', ...rest } = props;
        return (
            <button
                type={type}
                className={`${superficie} ${pad[padding]} block w-full text-left transition-[transform,box-shadow] duration-(--dur-estado) ease-saida hover:shadow-e2 active:scale-[0.98] active:duration-(--dur-toque) ${className}`}
                {...rest}
            >
                {children}
            </button>
        );
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { as: Tag = 'div', padding: _p, className: _c, children: _ch, ...rest } = props as CardEstatico;
    return (
        <Tag className={`${superficie} ${pad[padding]} ${className}`} {...rest}>
            {children}
        </Tag>
    );
}

/**
 * Linha de lista com 56 px: início (avatar/ícone), título e meta, valor à
 * direita em `tabular-nums`. Com `onClick` vira botão e mostra a seta.
 */
export const ListRow: React.FC<{
    leading?: React.ReactNode;
    title: React.ReactNode;
    meta?: React.ReactNode;
    value?: React.ReactNode;
    onClick?: () => void;
    className?: string;
    /** Destaque de "agora"/"você" (fundo saibro-50). */
    destaque?: boolean;
}> = ({ leading, title, meta, value, onClick, className = '', destaque }) => {
    const miolo = (
        <>
            {leading && <span className="shrink-0">{leading}</span>}
            <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold text-texto" title={typeof title === 'string' ? title : undefined}>{title}</span>
                {meta && <span className="block truncate text-meta font-normal text-texto-3">{meta}</span>}
            </span>
            {value != null && <span className="shrink-0 text-base font-bold tabular-nums text-texto">{value}</span>}
            {onClick && <ChevronRight size={18} className="shrink-0 text-texto-3" aria-hidden />}
        </>
    );
    const cls = `flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left ${destaque ? 'bg-acao-suave' : ''} ${className}`;
    if (!onClick) return <div className={cls}>{miolo}</div>;
    return (
        <button type="button" onClick={onClick} className={`${cls} transition-colors duration-(--dur-estado) hover:bg-superficie-2 active:bg-superficie-2`}>
            {miolo}
        </button>
    );
};
