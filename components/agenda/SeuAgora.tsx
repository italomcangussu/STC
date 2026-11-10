import React from 'react';
import { ChevronRight, Clock } from 'lucide-react';
import type { Court, Reservation } from '../../types';
import { proximoCompromisso, type Quando } from '../../lib/agenda/seuAgora';

const diaCurto = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

const ROTULO: Record<Quando, string> = {
    agora: 'Em quadra agora',
    hoje: 'Seu jogo hoje',
    amanha: 'Seu jogo amanhã',
    semana: 'Seu próximo jogo',
};

/**
 * "O seu agora": antes da grade, o próximo horário da pessoa nesta semana,
 * para ela não precisar procurar o próprio nome na agenda. Sem nada na
 * semana, não ocupa espaço.
 */
export const SeuAgora: React.FC<{
    reservas: Reservation[];
    quadras: Court[];
    userId: string;
    agora: Date;
    onAbrir: (r: Reservation) => void;
}> = ({ reservas, quadras, userId, agora, onAbrir }) => {
    const proximo = proximoCompromisso(reservas, userId, agora);
    if (!proximo) return null;
    const { reserva, quando } = proximo;
    const quadra = quadras.find(c => c.id === reserva.courtId)?.name ?? 'Quadra';
    const rotulo = quando === 'semana' ? `${ROTULO.semana} · ${diaCurto(reserva.date)}` : ROTULO[quando];

    return (
        <button
            type="button"
            onClick={() => onAbrir(reserva)}
            className="animate-in fade-in flex w-full min-h-16 items-center gap-3 rounded-card border border-acao/20 bg-acao-suave p-4 text-left active:scale-[0.99] transition-transform"
        >
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${quando === 'agora' ? 'bg-acao text-acao-texto' : 'bg-superficie text-acao'}`}>
                <Clock size={20} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-meta font-bold uppercase tracking-wider text-acao-forte">{rotulo}</span>
                <span className="block text-base font-bold text-texto tabular-nums">
                    {reserva.startTime}–{reserva.endTime} · {quadra}
                </span>
                {reserva.type && <span className="block text-sm text-texto-2">{reserva.type}</span>}
            </span>
            <ChevronRight size={20} className="shrink-0 text-texto-3" aria-hidden />
        </button>
    );
};
