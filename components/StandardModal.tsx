import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * StandardModal - Componente base padronizado para todos os modais do app
 * 
 * Características:
 * - Renderizado via Portal no document.body
 * - Z-index global z-999
 * - Backdrop escuro com blur
 * - Bloqueio de scroll do body
 * - Animação de entrada suave
 * - Fechamento ao clicar no backdrop (opcional)
 * 
 * @example
 * <StandardModal isOpen={showModal} onClose={() => setShowModal(false)}>
 *   <div className="bg-white rounded-3xl p-6">
 *     <h2>Meu Modal</h2>
 *   </div>
 * </StandardModal>
 */

interface StandardModalProps {
    /** Controla se o modal está visível */
    isOpen: boolean;
    /** Callback executado ao fechar o modal */
    onClose: () => void;
    /** Conteúdo do modal */
    children: React.ReactNode;
    /** Permite fechar ao clicar no backdrop (padrão: true) */
    closeOnBackdrop?: boolean;
    /** Classes CSS adicionais para o container do modal */
    containerClassName?: string;
    /** Alinhamento vertical do modal (padrão: 'center') */
    verticalAlign?: 'start' | 'center' | 'end';
}

export const StandardModal: React.FC<StandardModalProps> = ({
    isOpen,
    onClose,
    children,
    closeOnBackdrop = true,
    containerClassName = '',
    verticalAlign = 'center'
}) => {
    // Bloquear scroll do body quando modal está aberto
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = 'unset';
            };
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const alignmentClass = 
        verticalAlign === 'start' ? 'items-start' :
        verticalAlign === 'end' ? 'items-end' :
        'items-center';

    return createPortal(
        <div 
            className={`fixed inset-0 z-999 bg-stone-900/60 backdrop-blur-md flex ${alignmentClass} justify-center p-4 animate-in fade-in duration-300 ${containerClassName}`}
            onClick={closeOnBackdrop ? onClose : undefined}
        >
            <div 
                className="animate-in zoom-in-95 duration-300"
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>,
        document.body
    );
};

/**
 * useStandardModal - Hook para gerenciar estado de modais
 * 
 * @example
 * const { isOpen, open, close, toggle } = useStandardModal();
 * 
 * <button onClick={open}>Abrir Modal</button>
 * <StandardModal isOpen={isOpen} onClose={close}>
 *   ...
 * </StandardModal>
 */
export const useStandardModal = (initialState = false) => {
    const [isOpen, setIsOpen] = React.useState(initialState);

    return {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen(prev => !prev)
    };
};
