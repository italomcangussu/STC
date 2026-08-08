/**
 * `canScheduleMatch` decide se o sócio consegue marcar o horário do jogo dele.
 * Estava dentro do `Championships.tsx` — 1.682 linhas, 2,41% de cobertura — com
 * comentários que confessavam a dúvida ("Or false? Assuming true...").
 *
 * Os testes abaixo tornam essas decisões explícitas: onde a regra libera por
 * falta de dado, e onde ela bloqueia por ter dado suficiente para bloquear.
 */

import { describe, expect, it } from 'vitest';
import { canScheduleMatch } from '../lib/championship/scheduling';
import type { ChampionshipRound, Match } from '../types';

const EU = 'u1';
const RIVAL = 'u2';

const rodada = (n: number, id = `r${n}`): ChampionshipRound =>
    ({ id, round_number: n, championship_id: 'c1', name: `Rodada ${n}`, status: 'active' } as ChampionshipRound);

const partida = (over: Partial<Match> = {}): Match => ({
    id: 'm1',
    round_id: 'r1',
    playerAId: EU,
    playerBId: RIVAL,
    status: 'pending',
    ...over,
} as Match);

const RODADAS = [rodada(1), rodada(2), rodada(3)];

const pode = (over: {
    match?: Partial<Match>;
    userId?: string;
    rounds?: ChampionshipRound[];
    matches?: Match[];
} = {}) => canScheduleMatch({
    match: { ...partida(), ...over.match } as Match,
    userId: over.userId ?? EU,
    rounds: over.rounds ?? RODADAS,
    matches: over.matches ?? [],
});

describe('canScheduleMatch — quem pode marcar', () => {
    it('libera o atleta que joga a partida', () => {
        expect(pode({ match: { round_id: 'r1' } })).toBe(true);
    });

    it('libera também o segundo jogador da partida', () => {
        expect(pode({ match: { round_id: 'r1' }, userId: RIVAL })).toBe(true);
    });

    it('bloqueia quem não está na partida — não se marca jogo dos outros', () => {
        expect(pode({ match: { round_id: 'r1' }, userId: 'u9' })).toBe(false);
    });

    it('bloqueia usuário sem id, em vez de deixar passar', () => {
        expect(pode({ match: { round_id: 'r1' }, userId: '' })).toBe(false);
    });
});

describe('canScheduleMatch — a regra sequencial', () => {
    it('libera a primeira rodada sem olhar para trás', () => {
        expect(pode({ match: { round_id: 'r1' } })).toBe(true);
    });

    it('bloqueia a rodada 2 enquanto a partida da rodada 1 não terminou', () => {
        const anterior = partida({ id: 'm0', round_id: 'r1', status: 'pending' });

        expect(pode({ match: { id: 'm2', round_id: 'r2' }, matches: [anterior] })).toBe(false);
    });

    it('libera a rodada 2 quando a partida da rodada 1 terminou', () => {
        const anterior = partida({ id: 'm0', round_id: 'r1', status: 'finished' });

        expect(pode({ match: { id: 'm2', round_id: 'r2' }, matches: [anterior] })).toBe(true);
    });

    it('olha só a rodada imediatamente anterior, não todas as anteriores', () => {
        const r1Pendente = partida({ id: 'm0', round_id: 'r1', status: 'pending' });
        const r2Encerrada = partida({ id: 'm1', round_id: 'r2', status: 'finished' });

        expect(pode({
            match: { id: 'm3', round_id: 'r3' },
            matches: [r1Pendente, r2Encerrada],
        })).toBe(true);
    });

    it('ignora a partida de outro atleta na rodada anterior', () => {
        const deOutros = partida({ id: 'm0', round_id: 'r1', playerAId: 'u8', playerBId: 'u9', status: 'pending' });

        expect(pode({ match: { id: 'm2', round_id: 'r2' }, matches: [deOutros] })).toBe(true);
    });
});

describe('canScheduleMatch — dado faltando libera, de propósito', () => {
    // Nenhum destes casos tem informação suficiente para impedir alguém de
    // jogar. Bloquear aqui transformaria um buraco de cadastro em atleta parado.

    it('libera quando o atleta não tem partida na rodada anterior — folga ou entrada tardia', () => {
        expect(pode({ match: { id: 'm2', round_id: 'r2' }, matches: [] })).toBe(true);
    });

    it('libera quando a rodada anterior não existe no cadastro', () => {
        expect(pode({
            match: { id: 'm2', round_id: 'r2' },
            rounds: [rodada(2)],
        })).toBe(true);
    });

    it('bloqueia quando a própria rodada da partida não existe — aí não dá para saber nada', () => {
        expect(pode({ match: { round_id: 'r-fantasma' } })).toBe(false);
    });
});
