import React from 'react';
import { btnGhost } from './ui';

const BORDER = { saibro: 'border-saibro-200', red: 'border-red-200', emerald: 'border-emerald-200' } as const;
export type PanelTone = keyof typeof BORDER;

/** Quadro de uma ação em andamento dentro de uma folha (pagar, cancelar…): a borda diz a gravidade, o título diz a ação. */
export const ActionPanel: React.FC<{ tone?: PanelTone; title?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ tone = 'saibro', title, className = '', children }) => (
  <div className={`space-y-3 rounded-2xl border ${BORDER[tone]} p-3 ${className}`}>
    {title && <p className={`text-sm font-black ${tone === 'red' ? 'text-red-700' : ''}`}>{title}</p>}
    {children}
  </div>
);

/** Rodapé do quadro: "Voltar" à esquerda, a ação principal ao lado. */
export const PanelActions: React.FC<{ onBack: () => void; children: React.ReactNode }> = ({ onBack, children }) => (
  <div className="flex gap-2"><button className={btnGhost} onClick={onBack}>Voltar</button>{children}</div>
);
