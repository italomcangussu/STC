import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Botão do sistema "Quadra".
 *
 * - Uma primária por tela: é a única peça em saibro cheio.
 * - `loading` desabilita e troca o conteúdo por um spinner sem mudar a
 *   largura: o toque repetido não dispara duas vezes e nada pula.
 * - 48 px (`md`, o mínimo do Android; cobre os 44 pt do iOS) ou 52 px (`lg`) de alvo; o rótulo diz o verbo.
 */
export type ButtonVariant = 'primaria' | 'secundaria' | 'fantasma' | 'destrutiva';
export type ButtonSize = 'md' | 'lg';

const base =
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold ' +
    'transition-[transform,background-color,border-color,color,box-shadow] duration-(--dur-estado) ease-saida ' +
    'active:scale-[0.97] active:duration-(--dur-toque) disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100';

const variantes: Record<ButtonVariant, string> = {
    primaria: 'bg-acao text-acao-texto shadow-e1 hover:bg-acao-forte active:bg-acao-forte',
    secundaria: 'border border-linha bg-superficie text-texto shadow-e1 hover:bg-superficie-2 active:bg-superficie-2',
    fantasma: 'text-texto-2 hover:bg-superficie-2 active:bg-superficie-2',
    destrutiva: 'bg-erro text-acao-texto shadow-e1 hover:bg-erro-forte active:bg-erro-forte',
};

const tamanhos: Record<ButtonSize, string> = {
    md: 'min-h-12 rounded-lg px-4 text-sm',
    lg: 'min-h-13 rounded-lg px-5 text-base',
};

export function buttonClass(variant: ButtonVariant = 'primaria', size: ButtonSize = 'md', extra = '') {
    return `${base} ${variantes[variant]} ${tamanhos[size]} ${extra}`.trim();
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    /** Largura total (no celular, o polegar acerta sem mirar). */
    block?: boolean;
    icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primaria', size = 'md', loading = false, block, icon, className = '', children, disabled, type = 'button', ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={buttonClass(variant, size, `${block ? 'w-full' : ''} ${className}`)}
            {...rest}
        >
            <span className={`inline-flex items-center gap-2 ${loading ? 'invisible' : ''}`}>
                {icon}
                {children}
            </span>
            {loading && (
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
                    <Loader2 size={18} className="animate-spin" />
                </span>
            )}
        </button>
    );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Obrigatório: um ícone sozinho não diz o que faz para o leitor de tela. */
    'aria-label': string;
    tom?: 'neutro' | 'acao' | 'erro';
}

/** Botão só de ícone com 48 × 48 de alvo, por menor que seja o ícone. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    { className = '', tom = 'neutro', type = 'button', children, ...rest },
    ref,
) {
    const cor = { neutro: 'text-texto-2 hover:bg-superficie-2', acao: 'text-acao hover:bg-acao-suave', erro: 'text-erro hover:bg-erro-suave' }[tom];
    return (
        <button
            ref={ref}
            type={type}
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-(--dur-estado) ease-saida active:scale-[0.94] disabled:opacity-50 ${cor} ${className}`}
            {...rest}
        >
            {children}
        </button>
    );
});
