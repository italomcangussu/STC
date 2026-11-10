import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { StandardModal } from '../StandardModal';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Largura maior a partir do tablet (formulários com duas colunas). */
  wide?: boolean;
  /**
   * Tocar no fundo fecha? Em formulário com dados digitados o padrão deveria ser
   * `false`: um toque errado fora da folha não pode jogar fora o que foi preenchido.
   * Vale também para arrastar a alça para baixo.
   */
  closeOnBackdrop?: boolean;
}

/** Quanto arrastar (px) para a folha fechar ao soltar. */
const LIMIAR_FECHAR = 96;

/**
 * Formulário em folha: sobe da borda inferior no celular (o polegar alcança os
 * botões do rodapé) e vira modal centralizado a partir do tablet. Cabeçalho e
 * rodapé ficam fixos; só o miolo rola, e nunca na horizontal.
 *
 * No celular, a alça e o cabeçalho arrastam a folha para baixo; passou de
 * 96 px, ela fecha (se `closeOnBackdrop`); senão volta no lugar.
 */
export const Sheet: React.FC<SheetProps> = ({ open, onClose, title, subtitle, children, footer, wide, closeOnBackdrop = true }) => {
  const folha = useRef<HTMLDivElement>(null);
  const inicio = useRef<number | null>(null);

  const mover = (dy: number) => {
    const el = folha.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = `translateY(${Math.max(0, dy)}px)`;
  };
  const soltar = (dy: number) => {
    const el = folha.current;
    inicio.current = null;
    if (!el) return;
    el.style.transition = 'transform var(--dur-contexto) var(--ease-folha)';
    if (closeOnBackdrop && dy > LIMIAR_FECHAR) {
      onClose();
    } else {
      el.style.transform = '';
    }
  };
  const arraste = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      inicio.current = e.clientY;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (inicio.current != null) mover(e.clientY - inicio.current);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (inicio.current != null) soltar(e.clientY - inicio.current);
    },
    onPointerCancel: () => soltar(0),
  };

  return (
    <StandardModal isOpen={open} onClose={onClose} verticalAlign="end" padding="p-0 sm:p-4" ariaLabel={title} closeOnBackdrop={closeOnBackdrop}>
      <div
        ref={folha}
        className={`anim-folha flex max-h-[92dvh] w-screen max-w-full flex-col overflow-hidden rounded-t-folha bg-superficie shadow-e3 sm:w-[92vw] sm:rounded-folha ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div {...arraste} className="touch-none">
          <div className="flex justify-center pt-2 sm:hidden" aria-hidden>
            <span className="h-1.5 w-10 rounded-full bg-linha" />
          </div>
          <header className="flex items-start justify-between gap-3 border-b border-linha px-5 pb-3 pt-2 sm:pt-4">
            <div className="min-w-0 pt-2">
              <h2 className="text-lg font-bold text-texto">{title}</h2>
              {subtitle && <p className="text-sm text-texto-2">{subtitle}</p>}
            </div>
            <button onClick={onClose} aria-label="Fechar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-texto-2 hover:bg-superficie-2"><X size={20} /></button>
          </header>
        </div>
        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-col-reverse gap-2 border-t border-linha px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">{footer}</footer>}
      </div>
    </StandardModal>
  );
};
