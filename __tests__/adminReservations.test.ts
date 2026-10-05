import { describe, it, expect } from 'vitest';
import { filterReservations, ReservationRow } from '../lib/adminReservations';

const row = (o: Partial<ReservationRow>): ReservationRow => ({
    id: 'x', type: 'Play', date: '2026-10-05', startTime: '08:00', endTime: '09:00',
    courtName: 'Quadra 1', people: 'João', ...o,
});
const base = { period: 'all' as const, type: 'all', query: '', showCancelled: false, today: '2026-10-05' };

describe('filterReservations', () => {
    const rows = [
        row({ id: 'a', date: '2026-10-04' }),
        row({ id: 'b', date: '2026-10-05', startTime: '10:00' }),
        row({ id: 'c', date: '2026-10-05', startTime: '07:00', type: 'Aula' }),
        row({ id: 'd', date: '2026-10-06', status: 'cancelled' }),
        row({ id: 'e', date: '2026-10-07', people: 'José Álvaro' }),
    ];
    it('hoje e próximas em ordem crescente', () => {
        expect(filterReservations(rows, { ...base, period: 'today' }).map(r => r.id)).toEqual(['c', 'b']);
        expect(filterReservations(rows, { ...base, period: 'upcoming' }).map(r => r.id)).toEqual(['c', 'b', 'e']);
    });
    it('passadas em ordem decrescente e canceladas opcionais', () => {
        expect(filterReservations(rows, { ...base, period: 'past' }).map(r => r.id)).toEqual(['a']);
        expect(filterReservations(rows, { ...base, showCancelled: true }).map(r => r.id)).toContain('d');
    });
    it('busca sem acento e filtro por tipo', () => {
        expect(filterReservations(rows, { ...base, query: 'alvaro' }).map(r => r.id)).toEqual(['e']);
        expect(filterReservations(rows, { ...base, type: 'Aula' }).map(r => r.id)).toEqual(['c']);
    });
});
