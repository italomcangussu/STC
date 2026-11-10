import React from 'react';

/**
 * Chip (filtro ligado/desligado) e Segmented (uma escolha entre 2–4 visões).
 *
 * O selecionado se mostra pela forma (fundo e borda), não só pela cor do
 * texto. Faixas com muitos chips rolam na horizontal com `faixa-rolavel`,
 * que trava o eixo vertical.
 */
export const Chip: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; icon?: React.ReactNode }
> = ({ selected = false, icon, className = '', children, type = 'button', ...rest }) => (
    <button
        type={type}
        aria-pressed={selected}
        className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-[transform,background-color,border-color,color] duration-(--dur-estado) ease-saida active:scale-[0.97] ${
            selected ? 'border-acao bg-acao-suave text-acao-forte' : 'border-linha bg-superficie text-texto-2 hover:border-linha-forte'
        } ${className}`}
        {...rest}
    >
        {icon}
        {children}
    </button>
);

export interface SegmentedOption<T extends string> {
    value: T;
    label: React.ReactNode;
}

export function Segmented<T extends string>({
    options,
    value,
    onChange,
    label,
    className = '',
}: {
    options: ReadonlyArray<SegmentedOption<T>>;
    value: T;
    onChange: (v: T) => void;
    /** Nome do grupo para o leitor de tela. */
    label: string;
    className?: string;
}) {
    return (
        <div role="radiogroup" aria-label={label} className={`flex rounded-lg bg-superficie-2 p-1 ${className}`}>
            {options.map(o => {
                const on = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(o.value)}
                        className={`min-h-11 flex-1 rounded-md px-3 text-sm font-semibold transition-[background-color,color,box-shadow] duration-(--dur-estado) ease-saida ${
                            on ? 'bg-superficie text-texto shadow-e1' : 'text-texto-2 hover:text-texto'
                        }`}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}
