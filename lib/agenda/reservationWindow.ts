// A Agenda não precisa do histórico inteiro de reservas para abrir: o passado distante só é lido
// quando a pessoa navega até ele. Datas aqui são sempre 'YYYY-MM-DD', que comparam bem como texto.
import { addDays, formatDate } from '../../utils';

export const HISTORY_DAYS = 60;

export type AgendaView = 'day' | 'week' | 'month';

/** Primeiro dia carregado ao abrir a Agenda. O futuro não tem limite. */
export const defaultHistoryStart = (today: Date): string => formatDate(addDays(today, -HISTORY_DAYS));

/** Primeiro dia que a tela mostra para a data e a visão escolhidas. */
export function firstDayShown(current: Date, view: AgendaView): string {
    if (view === 'day') return formatDate(current);
    if (view === 'week') return formatDate(addDays(current, -current.getDay()));
    return formatDate(new Date(current.getFullYear(), current.getMonth(), 1));
}

/**
 * Novo começo do histórico quando a tela passa a mostrar algo anterior ao que foi carregado;
 * `null` quando o carregado já cobre. Recua até o dia 1 do mês para não pedir de novo a cada dia.
 */
export function extendedHistoryStart(loadedFrom: string, shownFrom: string): string | null {
    if (shownFrom >= loadedFrom) return null;
    return `${shownFrom.slice(0, 7)}-01`;
}
