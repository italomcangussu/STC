import React from 'react';
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
   */
  closeOnBackdrop?: boolean;
}

/**
 * Formulário em folha: sobe da borda inferior no celular (o polegar alcança os
 * botões do rodapé) e vira modal centralizado a partir do tablet. Cabeçalho e
 * rodapé ficam fixos; só o miolo rola, e nunca na horizontal.
 */
export const Sheet: React.FC<SheetProps> = ({ open, onClose, title, subtitle, children, footer, wide, closeOnBackdrop = true }) => (
  <StandardModal isOpen={open} onClose={onClose} verticalAlign="end" padding="p-0 sm:p-4" ariaLabel={title} closeOnBackdrop={closeOnBackdrop}>
    <div className={`flex max-h-[92dvh] w-screen max-w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:w-[92vw] sm:rounded-3xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
      <header className="flex items-start justify-between gap-3 border-b border-stone-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-black text-stone-800">{title}</h2>
          {subtitle && <p className="text-xs text-stone-500">{subtitle}</p>}
        </div>
        <button onClick={onClose} aria-label="Fechar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100"><X size={20} /></button>
      </header>
      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-5 py-4">{children}</div>
      {footer && <footer className="flex flex-col-reverse gap-2 border-t border-stone-100 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">{footer}</footer>}
    </div>
  </StandardModal>
);
