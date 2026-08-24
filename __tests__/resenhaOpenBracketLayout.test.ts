import { describe, expect, it } from 'vitest';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';
import {
    buildConnectorPath,
    buildResenhaBracketLayout,
    derivePhaseOrder,
    detectNewlyFinished,
    formatMatchDay,
    MIN_CONNECTOR_RUN,
    PHASE_COLUMN_GAP,
    getCurrentPhaseForClass,
    getMatchState,
    getMatchWinnerSide,
    normalizeScoreSlots,
    phaseOrderFor,
    playedScoreSlots,
} from '../lib/resenhaOpenBracketLayout';

const match = (overrides: Partial<BracketMatchWithPhase>): BracketMatchWithPhase => ({
    id: `m-${overrides.match_number ?? 1}`,
    match_number: overrides.match_number ?? 1,
    registration_a_id: overrides.registration_a_id ?? 'a1',
    registration_b_id: overrides.registration_b_id ?? 'b1',
    player_a_label: overrides.player_a_label ?? 'Player A',
    player_b_label: overrides.player_b_label ?? 'Player B',
    status: overrides.status ?? 'pending',
    winner_registration_id: overrides.winner_registration_id ?? null,
    is_walkover: overrides.is_walkover ?? false,
    round_phase: overrides.round_phase ?? 'oitavas',
    bracket_class: overrides.bracket_class ?? '5ª Classe',
    player_a_source_match_number: overrides.player_a_source_match_number,
    player_b_source_match_number: overrides.player_b_source_match_number,
    score_a: overrides.score_a,
    score_b: overrides.score_b,
});

describe('resenhaOpenBracketLayout', () => {
    it('normalizes score slots to exactly three set columns', () => {
        expect(normalizeScoreSlots([6, 6], [4, 3])).toEqual([
            { a: 6, b: 4, index: 0, played: true },
            { a: 6, b: 3, index: 1, played: true },
            { a: null, b: null, index: 2, played: false },
        ]);
    });

    it('detects the winner side from winner_registration_id', () => {
        expect(getMatchWinnerSide(match({ winner_registration_id: 'a1', status: 'finished' }))).toBe('a');
        expect(getMatchWinnerSide(match({ winner_registration_id: 'b1', status: 'finished' }))).toBe('b');
        expect(getMatchWinnerSide(match({ winner_registration_id: null, status: 'pending' }))).toBe(null);
    });

    it('builds 5ª Classe columns and connectors from match centers', () => {
        const layout = buildResenhaBracketLayout([
            match({ match_number: 1, round_phase: 'oitavas' }),
            match({ match_number: 2, round_phase: 'oitavas', registration_a_id: 'a2', registration_b_id: 'b2' }),
            match({
                match_number: 9,
                round_phase: 'quartas',
                registration_a_id: null,
                registration_b_id: null,
                player_a_source_match_number: 1,
                player_b_source_match_number: 2,
            }),
        ], '5ª Classe', true);

        expect(layout.phases.map(phase => phase.phase)).toEqual(['oitavas', 'quartas', 'semifinal', 'final']);
        expect(layout.matchesByNumber.get(1)?.centerY).toBe(layout.matchesByNumber.get(1)!.y + layout.cardHeight / 2);
        expect(layout.connectors).toContainEqual(expect.objectContaining({
            fromMatchNumber: 1,
            toMatchNumber: 9,
            toSlot: 'a',
            startX: layout.matchesByNumber.get(1)!.x + layout.cardWidth,
            startY: layout.matchesByNumber.get(1)!.centerY,
            endY: layout.matchesByNumber.get(9)!.centerY,
        }));
    });

    it('builds 4ª Classe from preliminar through final', () => {
        const layout = buildResenhaBracketLayout([
            match({ bracket_class: '4ª Classe', match_number: 1, round_phase: 'preliminar' }),
            match({ bracket_class: '4ª Classe', match_number: 5, round_phase: 'oitavas', player_b_source_match_number: 1 }),
            match({ bracket_class: '4ª Classe', match_number: 13, round_phase: 'quartas', player_a_source_match_number: 5 }),
            match({ bracket_class: '4ª Classe', match_number: 17, round_phase: 'semifinal', player_a_source_match_number: 13 }),
            match({ bracket_class: '4ª Classe', match_number: 19, round_phase: 'final', player_a_source_match_number: 17 }),
        ], '4ª Classe', true);

        expect(layout.phases.map(phase => phase.phase)).toEqual(['preliminar', 'oitavas', 'quartas', 'semifinal', 'final']);
    });

    it('selects the earliest pending playable phase', () => {
        const matches = [
            match({
                id: 'j13',
                match_number: 13,
                round_phase: 'quartas',
                bracket_class: '4ª Classe',
                registration_a_id: 'a',
                registration_b_id: 'b',
                status: 'pending',
            }),
            match({
                id: 'j17',
                match_number: 17,
                round_phase: 'semifinal',
                bracket_class: '4ª Classe',
                registration_a_id: null,
                registration_b_id: null,
                player_a_source_match_number: 13,
                player_b_source_match_number: 14,
                status: 'pending',
            }),
        ];

        expect(getCurrentPhaseForClass(matches, '4ª Classe')).toBe('quartas');
    });

    it('selects the final when all class matches are finished', () => {
        const matches = [
            match({
                id: 'j13',
                match_number: 13,
                round_phase: 'quartas',
                bracket_class: '4ª Classe',
                registration_a_id: 'a',
                registration_b_id: 'b',
                status: 'finished',
            }),
            match({
                id: 'j19',
                match_number: 19,
                round_phase: 'final',
                bracket_class: '4ª Classe',
                registration_a_id: 'c',
                registration_b_id: 'd',
                status: 'finished',
            }),
        ];

        expect(getCurrentPhaseForClass(matches, '4ª Classe')).toBe('final');
    });
});

/**
 * As classes do Resenha têm sequência fixa; as do Criador não têm lista alguma,
 * e a ordem das colunas precisa sair dos dados.
 */
describe('ordem das fases fora do Resenha', () => {
    const quadroDoCriador = [
        match({ match_number: 5, round_phase: 'quartas', bracket_class: '3ª Classe' }),
        match({ match_number: 1, round_phase: 'qualify', bracket_class: '3ª Classe' }),
        match({ match_number: 9, round_phase: 'final', bracket_class: '3ª Classe' }),
        match({ match_number: 7, round_phase: 'semifinal', bracket_class: '3ª Classe' }),
        match({ match_number: 6, round_phase: 'quartas', bracket_class: '3ª Classe' }),
    ];

    it('ordena as fases pelo primeiro jogo de cada uma', () => {
        expect(derivePhaseOrder(quadroDoCriador)).toEqual(['qualify', 'quartas', 'semifinal', 'final']);
    });

    it('ignora partidas sem fase', () => {
        expect(derivePhaseOrder([
            match({ match_number: 1, round_phase: '' }),
            match({ match_number: 2, round_phase: 'final' }),
        ])).toEqual(['final']);
    });

    it('mantém a sequência fixa das classes do Resenha, mesmo sem jogos em uma fase', () => {
        expect(phaseOrderFor([match({ match_number: 1, round_phase: 'final' })], '4ª Classe', true))
            .toEqual(['preliminar', 'oitavas', 'quartas', 'semifinal', 'final']);
    });

    it('não aplica a lista do Resenha a outro campeonato com o mesmo nome de classe', () => {
        // '4ª Classe' existe nos dois. Aplicar a lista fixa aqui desenhava uma
        // coluna 'preliminar' vazia e engolia a fase 'qualify', que não está nela.
        const quadroDoCriador4a = [
            match({ match_number: 1, round_phase: 'qualify', bracket_class: '4ª Classe' }),
            match({ match_number: 2, round_phase: 'quartas', bracket_class: '4ª Classe' }),
            match({ match_number: 6, round_phase: 'semifinal', bracket_class: '4ª Classe' }),
            match({ match_number: 8, round_phase: 'final', bracket_class: '4ª Classe' }),
        ];

        expect(phaseOrderFor(quadroDoCriador4a, '4ª Classe'))
            .toEqual(['qualify', 'quartas', 'semifinal', 'final']);

        const layout = buildResenhaBracketLayout(quadroDoCriador4a, '4ª Classe');
        expect(layout.phases.map(p => p.phase)).toEqual(['qualify', 'quartas', 'semifinal', 'final']);
        expect(layout.phases.every(p => p.matches.length > 0)).toBe(true);
        expect(layout.matchesByNumber.get(1)).toBeDefined();
    });

    it('deriva dos dados quando a classe não é do Resenha', () => {
        expect(phaseOrderFor(quadroDoCriador, '3ª Classe'))
            .toEqual(['qualify', 'quartas', 'semifinal', 'final']);
    });

    it('desenha uma coluna por fase presente, na ordem derivada', () => {
        const layout = buildResenhaBracketLayout(quadroDoCriador, '3ª Classe');
        expect(layout.phases.map(p => p.phase)).toEqual(['qualify', 'quartas', 'semifinal', 'final']);
        expect(layout.phases.find(p => p.phase === 'quartas')?.matches).toHaveLength(2);
        expect(layout.phases[0].label).toBe('Qualificatórias');
    });
});

// ── Cartão Vivo: estado, sets visíveis e detecção de avanço ──────────────────

describe('getMatchState', () => {
    const base = (over: any = {}) => ({
        id: 'm', match_number: 1, registration_a_id: 'ra', registration_b_id: 'rb',
        player_a_label: 'A', player_b_label: 'B', status: 'pending',
        winner_registration_id: null, round_phase: 'quartas', score_a: [], score_b: [],
        ...over,
    }) as any;

    it('encerrado quando a partida tem vencedor', () => {
        expect(getMatchState(base({ status: 'finished', winner_registration_id: 'ra' }))).toBe('finished');
    });

    /**
     * "Ao vivo" não existe no banco: sai de placar lançado numa partida que
     * ainda não encerrou. É a única leitura honesta com os dados que temos.
     */
    it('ao vivo quando há placar mas a partida não encerrou', () => {
        expect(getMatchState(base({ score_a: [6], score_b: [3] }))).toBe('live');
    });

    it('a jogar quando não há placar nenhum', () => {
        expect(getMatchState(base())).toBe('pending');
    });

    it('placar zerado não conta como jogo em andamento', () => {
        expect(getMatchState(base({ score_a: [], score_b: [] }))).toBe('pending');
    });

    it('W.O. conta como encerrado mesmo sem placar', () => {
        expect(getMatchState(base({ status: 'finished', is_walkover: true, winner_registration_id: 'rb' }))).toBe('finished');
    });
});

describe('playedScoreSlots', () => {
    it('devolve só os sets disputados — dois sets, duas colunas', () => {
        expect(playedScoreSlots([6, 6], [1, 3])).toEqual([
            { index: 0, a: 6, b: 1, played: true },
            { index: 1, a: 6, b: 3, played: true },
        ]);
    });

    it('inclui o terceiro set quando ele existe', () => {
        expect(playedScoreSlots([6, 4, 10], [4, 6, 8])).toHaveLength(3);
    });

    it('devolve vazio sem placar — o cartão mostra relógio, não traços', () => {
        expect(playedScoreSlots([], [])).toEqual([]);
    });

    it('não engole um set em andamento com placar parcial', () => {
        expect(playedScoreSlots([6, 3], [4, 2])).toHaveLength(2);
    });
});

describe('detectNewlyFinished', () => {
    const m = (id: string, status: string) => ({ id, status }) as any;

    it('acha a partida que acabou de encerrar', () => {
        const antes = [m('j4', 'pending'), m('j5', 'pending')];
        const depois = [m('j4', 'pending'), m('j5', 'finished')];

        expect(detectNewlyFinished(antes, depois)).toEqual(['j5']);
    });

    it('ignora quem já estava encerrado', () => {
        const antes = [m('j5', 'finished')];
        const depois = [m('j5', 'finished')];

        expect(detectNewlyFinished(antes, depois)).toEqual([]);
    });

    /**
     * Primeira carga não é avanço: sem isso o quadro inteiro animaria ao abrir.
     */
    it('não trata a primeira carga como avanço', () => {
        expect(detectNewlyFinished([], [m('j5', 'finished')])).toEqual([]);
    });

    it('acha mais de uma quando duas encerram entre duas cargas', () => {
        const antes = [m('j4', 'pending'), m('j5', 'pending')];
        const depois = [m('j4', 'finished'), m('j5', 'finished')];

        expect(detectNewlyFinished(antes, depois).sort()).toEqual(['j4', 'j5']);
    });
});

describe('formatMatchDay', () => {
    it('devolve dia da semana abreviado e data curta', () => {
        expect(formatMatchDay('2026-08-26')).toBe('Qua 26/08');
    });

    it('acentua o sábado', () => {
        expect(formatMatchDay('2026-08-22')).toBe('Sáb 22/08');
    });

    it('mantém o zero à esquerda no dia', () => {
        expect(formatMatchDay('2026-08-01')).toBe('Sáb 01/08');
    });

    /**
     * `new Date('2026-08-26')` cai em meia-noite UTC, que em Fortaleza (UTC-3)
     * é o dia 25. A data do jogo não pode andar para trás por causa disso.
     */
    it('não anda um dia para trás por fuso', () => {
        expect(formatMatchDay('2026-08-26')).toContain('26/08');
    });

    it('devolve null sem data marcada', () => {
        expect(formatMatchDay(null)).toBeNull();
        expect(formatMatchDay(undefined)).toBeNull();
        expect(formatMatchDay('')).toBeNull();
    });

    it('devolve null para data inválida em vez de "NaN/NaN"', () => {
        expect(formatMatchDay('nao-e-data')).toBeNull();
    });
});

// ── Ligação entre as chaves ──────────────────────────────────────────────────

describe('espaçamento entre colunas', () => {
    /**
     * O vão entre as fases existe para a curva caber, não para sobrar. Apertar
     * abaixo do mínimo faz a ligação sair torta — este teste é o freio.
     */
    it('deixa espaço suficiente para a curva desenhar', () => {
        expect(PHASE_COLUMN_GAP).toBeGreaterThanOrEqual(MIN_CONNECTOR_RUN);
    });

    it('mantém o vão menor que o cartão, para as fases lerem como vizinhas', () => {
        const layout = buildResenhaBracketLayout(
            [match({ match_number: 1, round_phase: 'oitavas' })], '5ª Classe', true
        );
        expect(PHASE_COLUMN_GAP).toBeLessThan(layout.cardWidth);
    });

    it('toda ligação real tem a folga mínima', () => {
        const layout = buildResenhaBracketLayout([
            match({ match_number: 1, round_phase: 'oitavas' }),
            match({ match_number: 2, round_phase: 'oitavas', registration_a_id: 'a2', registration_b_id: 'b2' }),
            match({
                match_number: 9, round_phase: 'quartas',
                registration_a_id: null, registration_b_id: null,
                player_a_source_match_number: 1, player_b_source_match_number: 2,
            }),
        ], '5ª Classe', true);
        expect(layout.connectors.length).toBeGreaterThan(0);
        for (const c of layout.connectors) {
            expect(c.endX - c.startX).toBeGreaterThanOrEqual(MIN_CONNECTOR_RUN);
        }
    });
});

describe('buildConnectorPath', () => {
    const conector = (over: Partial<any> = {}) => ({
        id: 'x', fromMatchNumber: 1, toMatchNumber: 2, toSlot: 'a' as const,
        startX: 100, startY: 50, endX: 204, endY: 150, spineX: 152, active: false, ...over,
    });

    it('começa e termina exatamente nos pontos da chave', () => {
        const d = buildConnectorPath(conector());
        expect(d.startsWith('M 100 50')).toBe(true);
        expect(d.trim().endsWith('204')).toBe(true);
    });

    /**
     * Cotovelo, não diagonal: sai na horizontal do jogo, desce na vertical
     * compartilhada e entra na horizontal do jogo seguinte. É o traçado que a
     * referência usa, e é ele que faz dois jogos irmãos lerem como um par.
     */
    it('sai e entra na horizontal, com a virada na vertical', () => {
        const d = buildConnectorPath(conector({ spineX: 152 }));
        expect(d).toContain('H');
        expect(d).toContain('V');
        expect(d).not.toContain('L');
    });

    it('dobra sempre no mesmo x, para os irmãos dividirem a mesma vertical', () => {
        const deCima = buildConnectorPath(conector({ startY: 50, endY: 150, spineX: 152 }));
        const deBaixo = buildConnectorPath(conector({ startY: 250, endY: 150, spineX: 152 }));

        const viradaDe = (d: string) => d.match(/([\d.]+) [\d.]+ V/)?.[1] ?? d.match(/H ([\d.]+)/)?.[1];
        expect(viradaDe(deCima)).toBe(viradaDe(deBaixo));
    });

    it('não estoura para fora do vão entre as colunas', () => {
        const d = buildConnectorPath(conector({ startX: 100, endX: 204, spineX: 152 }));
        const xs = [...d.matchAll(/[MHQ] ([\d.]+)/g)].map(m => Number(m[1]));
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(100);
        expect(Math.max(...xs)).toBeLessThanOrEqual(204);
    });

    it('vira uma reta quando os dois jogos estão na mesma altura', () => {
        const d = buildConnectorPath(conector({ startY: 80, endY: 80, spineX: 152 }));
        expect(d).toBe('M 100 80 H 204');
    });
});

describe('posição vertical das fases', () => {
    const quadro = [
        match({ match_number: 1, round_phase: 'quartas', bracket_class: '5ª Classe' }),
        match({ match_number: 2, round_phase: 'quartas', bracket_class: '5ª Classe' }),
        match({ match_number: 3, round_phase: 'quartas', bracket_class: '5ª Classe' }),
        match({ match_number: 4, round_phase: 'quartas', bracket_class: '5ª Classe' }),
        match({
            match_number: 5, round_phase: 'semifinal', bracket_class: '5ª Classe',
            registration_a_id: null, registration_b_id: null,
            player_a_source_match_number: 1, player_b_source_match_number: 2,
        }),
        match({
            match_number: 6, round_phase: 'semifinal', bracket_class: '5ª Classe',
            registration_a_id: null, registration_b_id: null,
            player_a_source_match_number: 3, player_b_source_match_number: 4,
        }),
        match({
            match_number: 7, round_phase: 'final', bracket_class: '5ª Classe',
            registration_a_id: null, registration_b_id: null,
            player_a_source_match_number: 5, player_b_source_match_number: 6,
        }),
    ];

    /**
     * A lição central da referência: o jogo seguinte fica na altura do meio
     * entre os dois que o alimentam. Antes todas as fases empilhavam do topo
     * com o mesmo passo, e a única pista de quem vinha de onde era a linha.
     */
    it('centra cada jogo entre os dois que o alimentam', () => {
        const layout = buildResenhaBracketLayout(quadro, '5ª Classe', false);
        const c = (n: number) => layout.matchesByNumber.get(n)!.centerY;

        expect(c(5)).toBeCloseTo((c(1) + c(2)) / 2, 5);
        expect(c(6)).toBeCloseTo((c(3) + c(4)) / 2, 5);
        expect(c(7)).toBeCloseTo((c(5) + c(6)) / 2, 5);
    });

    it('mantém a primeira fase empilhada com passo constante', () => {
        const layout = buildResenhaBracketLayout(quadro, '5ª Classe', false);
        const ys = [1, 2, 3, 4].map(n => layout.matchesByNumber.get(n)!.y);
        const passos = ys.slice(1).map((y, i) => y - ys[i]);

        expect(new Set(passos).size).toBe(1);
    });

    it('nunca deixa dois jogos da mesma fase se sobrepondo', () => {
        const layout = buildResenhaBracketLayout(quadro, '5ª Classe', false);
        for (const fase of layout.phases) {
            const ordenados = [...fase.matches].sort((a, b) => a.y - b.y);
            for (let i = 1; i < ordenados.length; i++) {
                expect(ordenados[i].y - ordenados[i - 1].y).toBeGreaterThanOrEqual(layout.cardHeight);
            }
        }
    });

    it('a final fica no meio do quadro, e não colada no topo', () => {
        const layout = buildResenhaBracketLayout(quadro, '5ª Classe', false);
        const final = layout.matchesByNumber.get(7)!;
        const primeiro = layout.matchesByNumber.get(1)!;
        const ultimo = layout.matchesByNumber.get(4)!;

        expect(final.centerY).toBeGreaterThan(primeiro.centerY);
        expect(final.centerY).toBeLessThan(ultimo.centerY);
    });
});
