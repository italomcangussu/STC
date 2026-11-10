import type { Reservation } from '../../types';

export type Quando = 'agora' | 'hoje' | 'amanha' | 'semana';

const dia = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hora = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const somaDias = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/**
 * O "seu agora" da Agenda: o próximo horário em que a pessoa joga (criou ou
 * participa), dos próximos 7 dias. `agora` vem de `getNowInFortaleza()`, cujos
 * campos locais já são o relógio do clube. Sem nada na semana, `null`.
 */
export function proximoCompromisso(
    reservas: Reservation[],
    userId: string,
    agora: Date,
): { reserva: Reservation; quando: Quando } | null {
    const hoje = dia(agora);
    const agoraChave = `${hoje} ${hora(agora)}`;
    const limite = dia(somaDias(agora, 7));
    const amanha = dia(somaDias(agora, 1));

    const minhas = reservas
        .filter(r => r.status === 'active')
        .filter(r => r.creatorId === userId || r.participantIds?.includes(userId))
        .filter(r => `${r.date} ${r.endTime}` > agoraChave && r.date < limite)
        .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));

    const reserva = minhas[0];
    if (!reserva) return null;
    const quando: Quando =
        reserva.date === hoje ? (`${hoje} ${reserva.startTime}` <= agoraChave ? 'agora' : 'hoje')
            : reserva.date === amanha ? 'amanha' : 'semana';
    return { reserva, quando };
}
