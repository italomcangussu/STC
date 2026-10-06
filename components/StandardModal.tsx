import React, { useEffect, useRef } from 'react';
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
    /** Descreve o modal para leitores de tela quando não há título visível com id. */
    ariaLabel?: string;
    /**
     * Respiro entre o modal e a borda da tela. Existe como prop, e não como
     * `containerClassName`, porque duas classes de padding no mesmo elemento
     * dependem da ordem em que o Tailwind as emite — e quem escreve não
     * controla essa ordem. Bottom sheets usam `p-0 sm:p-4`.
     */
    padding?: string;
}

export const StandardModal: React.FC<StandardModalProps> = ({
    isOpen,
    onClose,
    children,
    closeOnBackdrop = true,
    containerClassName = '',
    verticalAlign = 'center',
    ariaLabel,
    padding = 'p-4'
}) => {
    const panelRef = useRef<HTMLDivElement>(null);

    // Bloquear scroll do body e escutar tecla Escape para fechar modal
    useEffect(() => {
        if (!isOpen) return;

        document.body.style.overflow = 'hidden';

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = 'unset';
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    // Levar o foco para dentro ao abrir e devolvê-lo a quem abriu ao fechar.
    // Sem isso o Tab continua percorrendo a página atrás do modal, e ao fechar
    // o teclado volta para o topo — o usuário perde o lugar onde estava.
    useEffect(() => {
        if (!isOpen) return;
        const opener = document.activeElement as HTMLElement | null;
        const panel = panelRef.current;
        // Um campo com `autoFocus` já se apossou do foco; não roubamos de volta.
        if (panel && !panel.contains(document.activeElement)) panel.focus();
        return () => opener?.focus?.();
    }, [isOpen]);

    if (!isOpen) return null;

    const alignmentClass = 
        verticalAlign === 'start' ? 'items-start' :
        verticalAlign === 'end' ? 'items-end' :
        'items-center';

    return createPortal(
        <div 
            className={`fixed inset-0 z-999 bg-stone-900/60 backdrop-blur-md flex ${alignmentClass} justify-center ${padding} animate-in fade-in duration-200 ease-out motion-reduce:animate-none ${containerClassName}`}
            onClick={closeOnBackdrop ? onClose : undefined}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
        >
            {/* `my-auto` em vez de só `items-center`: com `items-center` um modal mais alto que a tela estoura
                igualmente para cima e para baixo e o topo fica fora do alcance da rolagem; margem automática
                centraliza quando cabe e cola no topo (com rolagem) quando não cabe. */}
            <div
                ref={panelRef}
                tabIndex={-1}
                className={`max-w-full min-w-0 animate-in zoom-in-95 duration-180 ease-out motion-reduce:animate-none outline-none ${verticalAlign === 'center' ? 'my-auto' : ''}`}
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
// eslint-disable-next-line react-refresh/only-export-components
export const useStandardModal = (initialState = false) => {
    const [isOpen, setIsOpen] = React.useState(initialState);

    return {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen(prev => !prev)
    };
};
