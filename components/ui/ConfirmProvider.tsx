import React, { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { ConfirmContext, type ConfirmAsk, type ConfirmOptions } from '../../hooks/useConfirm';

/**
 * Mantém o único `<ConfirmDialog>` da aplicação e liga o `useConfirm` a ele.
 * Um só diálogo montado, em vez de um por tela, é o que permite que a chamada
 * volte a ser uma linha — veja o porquê em `hooks/useConfirm.ts`.
 */
export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [options, setOptions] = useState<ConfirmOptions | null>(null);
    const resolveRef = useRef<((answer: boolean) => void) | null>(null);

    const ask = useCallback<ConfirmAsk>(next => new Promise<boolean>(resolve => {
        // Um segundo pedido com o primeiro ainda aberto deixaria a promise
        // anterior pendente para sempre, e com ela o `await` de quem chamou.
        // Tratamos como cancelamento: o pedido antigo perdeu a vez.
        resolveRef.current?.(false);
        resolveRef.current = resolve;
        setOptions(next);
    }), []);

    const settle = useCallback((answer: boolean) => {
        resolveRef.current?.(answer);
        resolveRef.current = null;
        setOptions(null);
    }, []);

    return (
        <ConfirmContext.Provider value={ask}>
            {children}
            {options && (
                <ConfirmDialog
                    {...options}
                    open
                    onConfirm={() => settle(true)}
                    onCancel={() => settle(false)}
                />
            )}
        </ConfirmContext.Provider>
    );
};
