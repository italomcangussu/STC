import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface AgendaLoadErrorProps {
    onRetry: () => void;
}

// Sem isto, falha de leitura aparecia como "Nenhuma reserva", e a pessoa achava que a reserva sumiu.
export const AgendaLoadError: React.FC<AgendaLoadErrorProps> = ({ onRetry }) => (
    <div role="alert" className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
        <AlertTriangle size={20} className="shrink-0" />
        <p className="flex-1 text-sm font-medium">Não consegui carregar a agenda. As reservas abaixo podem estar desatualizadas.</p>
        <button
            onClick={onRetry}
            className="shrink-0 rounded-xl bg-red-600 px-3 py-2 text-sm font-bold text-white active:scale-95 transition-transform"
        >
            Tentar de novo
        </button>
    </div>
);
