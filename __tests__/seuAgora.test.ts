import { describe, it, expect } from 'vitest';
import { proximoCompromisso } from '../lib/agenda/seuAgora';
import type { Reservation } from '../types';

const r = (o: Partial<Reservation>): Reservation => ({
    id: o.id ?? 'r', date: '2026-11-10', startTime: '18:00', endTime: '19:00', courtId: 'c1',
    creatorId: 'outro', participantIds: [], status: 'active', ...o,
});
const agora = new Date(2026, 10, 10, 17, 0); // 10/11/2026 17:00 (relógio de Fortaleza)

describe('proximoCompromisso', () => {
    it('acha o próximo jogo de quem participa, hoje', () => {
        const p = proximoCompromisso([r({ id: 'a', participantIds: ['eu'] })], 'eu', agora);
        expect(p?.reserva.id).toBe('a');
        expect(p?.quando).toBe('hoje');
    });

    it('diz "agora" durante o horário e ignora o que já acabou', () => {
        const lista = [
            r({ id: 'acabou', creatorId: 'eu', startTime: '15:00', endTime: '16:00' }),
            r({ id: 'rolando', creatorId: 'eu', startTime: '16:30', endTime: '17:30' }),
        ];
        const p = proximoCompromisso(lista, 'eu', agora);
        expect(p?.reserva.id).toBe('rolando');
        expect(p?.quando).toBe('agora');
    });

    it('pula canceladas e as dos outros, e escolhe a mais cedo', () => {
        const lista = [
            r({ id: 'depois', participantIds: ['eu'], date: '2026-11-12' }),
            r({ id: 'cancelada', participantIds: ['eu'], status: 'cancelled' }),
            r({ id: 'dos-outros', participantIds: ['fulano'] }),
            r({ id: 'amanha', participantIds: ['eu'], date: '2026-11-11', startTime: '07:00', endTime: '08:00' }),
        ];
        const p = proximoCompromisso(lista, 'eu', agora);
        expect(p?.reserva.id).toBe('amanha');
        expect(p?.quando).toBe('amanha');
    });

    it('não mostra nada além de 7 dias', () => {
        expect(proximoCompromisso([r({ participantIds: ['eu'], date: '2026-11-18' })], 'eu', agora)).toBeNull();
    });
});
