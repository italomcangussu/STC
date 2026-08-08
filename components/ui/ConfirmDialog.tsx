import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Diálogo de confirmação para ações que o `undo` não alcança.
 *
 * O critério de uso é o de Norman: **reversível é melhor que confirmação**.
 * Se dá para desfazer, use um toast com ação de desfazer — não este componente.
 * Ele existe só para o que apaga dados de verdade.
 *
 * Para o subconjunto realmente destrutivo (`requireTyped`), pedimos que o
 * usuário digite uma palavra. Não é burocracia: um `confirm()` nativo é
 * respondido no reflexo, e o custo do reflexo errado aqui é perder a tabela
 * inteira de um campeonato em andamento. Digitar quebra o automatismo.
 */
export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    /** O que vai acontecer, em uma frase. */
    description: React.ReactNode;
    /** O que exatamente se perde. Cada item vira uma linha destacada. */
    consequences?: string[];
    confirmLabel: string;
    cancelLabel?: string;
    /**
     * Palavra que o usuário precisa digitar para liberar a confirmação.
     * Use apenas em ações irreversíveis e caras. A comparação ignora
     * maiúsculas e espaços nas pontas — o objetivo é atenção, não datilografia.
     */
    requireTyped?: string;
    /** `danger` para remoção de dados; `warning` para o que só atrapalha. */
    tone?: 'danger' | 'warning';
    /** Trava os botões enquanto a ação roda, evitando duplo envio. */
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const TONES = {
    danger: {
        iconWrap: 'bg-red-50 text-red-500',
        confirm: 'bg-red-600 text-white hover:bg-red-700',
        consequence: 'border-red-100 bg-red-50/60 text-red-700',
        ring: 'focus:ring-red-500',
    },
    warning: {
        iconWrap: 'bg-amber-50 text-amber-500',
        confirm: 'bg-amber-500 text-white hover:bg-amber-600',
        consequence: 'border-amber-100 bg-amber-50/60 text-amber-700',
        ring: 'focus:ring-amber-500',
    },
} as const;

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    title,
    description,
    consequences,
    confirmLabel,
    cancelLabel = 'Cancelar',
    requireTyped,
    tone = 'danger',
    busy = false,
    onConfirm,
    onCancel,
}) => {
    const [typed, setTyped] = useState('');
    const dialogRef = useRef<HTMLDivElement>(null);
    const firstFieldRef = useRef<HTMLInputElement | HTMLButtonElement>(null);
    const titleId = useId();
    const descriptionId = useId();
    const styles = TONES[tone];

    const confirmEnabled = !busy
        && (!requireTyped || typed.trim().toLowerCase() === requireTyped.trim().toLowerCase());

    // Reabrir o diálogo precisa recomeçar do zero: manter o texto digitado da
    // vez anterior devolveria o botão já destravado, anulando a proteção.
    useEffect(() => {
        if (open) setTyped('');
    }, [open]);

    // Devolver o foco para quem abriu o diálogo — sem isso o teclado volta
    // para o topo da página e o usuário perde o lugar.
    useEffect(() => {
        if (!open) return;
        const opener = document.activeElement as HTMLElement | null;
        firstFieldRef.current?.focus();
        return () => opener?.focus?.();
    }, [open]);

    // Enquanto o diálogo está aberto, o fundo não rola. No mobile isso é o que
    // impede a página de deslizar por trás do overlay.
    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previous; };
    }, [open]);

    // Escape é tratado na fase de captura do `document`, e não no elemento: o
    // `StandardModal` escuta `keydown` no `window`, então um Escape sobre o
    // diálogo fecharia também o modal que está atrás dele. Capturar antes e
    // interromper a propagação garante que só o diálogo do topo responde.
    useEffect(() => {
        if (!open || busy) return;
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            onCancel();
        };
        document.addEventListener('keydown', onEscape, true);
        return () => document.removeEventListener('keydown', onEscape, true);
    }, [open, busy, onCancel]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
        // Prender o Tab dentro do diálogo: um botão destrutivo fora de vista,
        // alcançável por teclado, é exatamente o acidente que queremos evitar.
        if (event.key !== 'Tab') return;
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }, []);

    if (!open) return null;

    // Portal com z acima do `StandardModal` (z-999): a confirmação nasce, quase
    // sempre, de um botão que já está dentro de um modal. Renderizada na árvore,
    // ela ficaria atrás dele — o usuário clicaria e a tela pareceria travada.
    return createPortal(
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-1000 flex items-center justify-center p-4"
            onKeyDown={handleKeyDown}
            // Clicar fora fecha, como em qualquer modal — mas só o cancelamento
            // é acessível assim; confirmar exige o botão.
            onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 motion-reduce:animate-none"
            >
                <div className="p-6 pb-5">
                    <div className="flex items-start gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${styles.iconWrap}`}>
                            <AlertTriangle size={24} />
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                            <h3 id={titleId} className="text-lg font-black text-stone-800 leading-tight">{title}</h3>
                            <p id={descriptionId} className="text-sm text-stone-500 leading-relaxed mt-1.5">{description}</p>
                        </div>
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={busy}
                            aria-label="Fechar"
                            className="text-stone-300 hover:text-stone-500 transition-colors disabled:opacity-40 -mt-1 -mr-1 p-1"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {consequences && consequences.length > 0 && (
                        <ul className={`mt-4 rounded-2xl border divide-y text-sm font-bold ${styles.consequence}`}>
                            {consequences.map(item => (
                                <li key={item} className="px-4 py-2.5 border-current/10">{item}</li>
                            ))}
                        </ul>
                    )}

                    {requireTyped && (
                        <label className="block mt-4">
                            <span className="text-xs font-bold text-stone-500">
                                Digite <span className="font-black text-stone-700">{requireTyped}</span> para confirmar
                            </span>
                            <input
                                ref={firstFieldRef as React.RefObject<HTMLInputElement>}
                                value={typed}
                                onChange={e => setTyped(e.target.value)}
                                disabled={busy}
                                autoComplete="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                aria-label={`Digite ${requireTyped} para confirmar`}
                                className={`mt-1.5 w-full min-h-[44px] px-4 rounded-xl border border-stone-200 font-bold text-stone-800 outline-none focus:ring-2 ${styles.ring} disabled:opacity-50`}
                            />
                        </label>
                    )}
                </div>

                <div className="flex gap-2 p-4 pt-0">
                    <button
                        type="button"
                        ref={requireTyped ? undefined : (firstFieldRef as React.RefObject<HTMLButtonElement>)}
                        onClick={onCancel}
                        disabled={busy}
                        className="flex-1 min-h-[44px] rounded-xl font-bold text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors disabled:opacity-40"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={!confirmEnabled}
                        className={`flex-1 min-h-[44px] rounded-xl font-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles.confirm}`}
                    >
                        {busy ? 'Aguarde...' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
