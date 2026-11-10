import React from 'react';
import { AlertTriangle, Check, Circle, Info, X } from 'lucide-react';

/**
 * Selo de estado: ícone + texto, nunca só cor (daltônico e sol na tela).
 * Promovido de `components/admin/ui.tsx`, com a mesma API de tons.
 */
export type StatusTone = 'good' | 'bad' | 'muted' | 'warn' | 'info';

const tons: Record<StatusTone, { cls: string; Icone: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }> }> = {
    good: { cls: 'bg-sucesso-suave text-sucesso', Icone: Check },
    bad: { cls: 'bg-erro-suave text-erro', Icone: X },
    warn: { cls: 'bg-aviso-suave text-aviso', Icone: AlertTriangle },
    info: { cls: 'bg-info-suave text-info', Icone: Info },
    muted: { cls: 'bg-superficie-2 text-texto-2', Icone: Circle },
};

export const StatusPill: React.FC<{ tone: StatusTone; children: React.ReactNode; icon?: boolean; className?: string }> = ({
    tone,
    children,
    icon = true,
    className = '',
}) => {
    const { cls, Icone } = tons[tone];
    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-meta ${cls} ${className}`}>
            {icon && <Icone size={12} strokeWidth={2.5} aria-hidden />}
            {children}
        </span>
    );
};
