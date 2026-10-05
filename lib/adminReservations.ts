export type ReservationPeriod = 'today' | 'upcoming' | 'past' | 'all';

export interface ReservationRow {
    id: string;
    type: string;
    date: string;
    startTime: string;
    endTime: string;
    status?: string;
    courtName: string;
    people: string;
}

export interface ReservationFilters {
    period: ReservationPeriod;
    type: string;
    query: string;
    showCancelled: boolean;
    today: string;
}

const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const filterReservations = (rows: ReservationRow[], f: ReservationFilters): ReservationRow[] => {
    const q = normalize(f.query.trim());
    const filtered = rows.filter(r => {
        if (!f.showCancelled && r.status === 'cancelled') return false;
        if (f.type !== 'all' && r.type !== f.type) return false;
        if (f.period === 'today' && r.date !== f.today) return false;
        if (f.period === 'upcoming' && r.date < f.today) return false;
        if (f.period === 'past' && r.date >= f.today) return false;
        if (q && !normalize(`${r.courtName} ${r.people} ${r.type}`).includes(q)) return false;
        return true;
    });
    const dir = f.period === 'past' || f.period === 'all' ? -1 : 1;
    return filtered.sort((a, b) =>
        dir * (`${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)));
};
