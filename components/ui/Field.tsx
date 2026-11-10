import React, { useId } from 'react';

/**
 * Campo do sistema "Quadra": rótulo → campo → ajuda ou erro.
 *
 * - O rótulo é obrigatório e fica sempre visível (placeholder some ao digitar
 *   e não é rótulo).
 * - 16 px de fonte: abaixo disso o iPhone dá zoom ao focar.
 * - O erro é ligado ao campo por `aria-describedby` e marca `aria-invalid`.
 *
 *   <Field label="Telefone" hint="Com DDD" error={erro}>
 *     <Input inputMode="tel" autoComplete="tel" value={v} onChange={…} />
 *   </Field>
 */

interface FieldCtx {
    id: string;
    describedBy?: string;
    invalid: boolean;
}
const Ctx = React.createContext<FieldCtx | null>(null);

export const Field: React.FC<{
    label: React.ReactNode;
    hint?: React.ReactNode;
    error?: React.ReactNode;
    /** Mostra "opcional" ao lado do rótulo. Obrigatório é o padrão e não ganha marca. */
    optional?: boolean;
    children: React.ReactNode;
    className?: string;
}> = ({ label, hint, error, optional, children, className = '' }) => {
    const id = useId();
    const helpId = `${id}-ajuda`;
    const describedBy = error || hint ? helpId : undefined;
    return (
        <Ctx.Provider value={{ id, describedBy, invalid: !!error }}>
            <div className={`min-w-0 space-y-1.5 ${className}`}>
                <label htmlFor={id} className="block text-sm font-semibold text-texto-2">
                    {label}
                    {optional && <span className="ml-1 font-normal text-texto-3">(opcional)</span>}
                </label>
                {children}
                {error ? (
                    <p id={helpId} role="alert" className="text-meta text-erro">{error}</p>
                ) : hint ? (
                    <p id={helpId} className="text-meta font-normal text-texto-3">{hint}</p>
                ) : null}
            </div>
        </Ctx.Provider>
    );
};

const campo =
    'block min-h-11 w-full min-w-0 rounded-lg border bg-superficie px-3.5 py-2.5 text-base text-texto ' +
    'placeholder:text-texto-3 transition-[border-color,box-shadow] duration-(--dur-estado) ease-saida ' +
    'focus:outline-none focus-visible:outline-none focus:border-acao focus:ring-3 focus:ring-acao/15 ' +
    'disabled:cursor-not-allowed disabled:bg-superficie-2 disabled:text-texto-3';

function useCampo(props: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: React.AriaAttributes['aria-invalid'] }) {
    const ctx = React.useContext(Ctx);
    const invalid = ctx?.invalid || props['aria-invalid'] === true || props['aria-invalid'] === 'true';
    return {
        id: props.id ?? ctx?.id,
        'aria-describedby': props['aria-describedby'] ?? ctx?.describedBy,
        'aria-invalid': invalid || undefined,
        cor: invalid ? 'border-erro' : 'border-linha-forte',
    };
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
    { className = '', ...rest },
    ref,
) {
    const { cor, ...a11y } = useCampo(rest);
    return <input ref={ref} {...rest} {...a11y} className={`${campo} ${cor} ${className}`} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
    { className = '', rows = 3, ...rest },
    ref,
) {
    const { cor, ...a11y } = useCampo(rest);
    return <textarea ref={ref} rows={rows} {...rest} {...a11y} className={`${campo} ${cor} resize-y ${className}`} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
    { className = '', children, ...rest },
    ref,
) {
    const { cor, ...a11y } = useCampo(rest);
    return (
        <select
            ref={ref}
            {...rest}
            {...a11y}
            className={`${campo} ${cor} appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='16'%20height='16'%20fill='none'%20stroke='%2357534e'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='m4%206%204%204%204-4'/%3E%3C/svg%3E")] bg-size-[16px] bg-position-[right_0.875rem_center] bg-no-repeat pr-10 ${className}`}
        >
            {children}
        </select>
    );
});
