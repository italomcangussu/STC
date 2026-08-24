import type { BracketMatchWithPhase, ResenhaClass } from './resenhaOpenService';

export type ScoreSlot = {
    index: number;
    a: number | null;
    b: number | null;
    played: boolean;
};

export type WinnerSide = 'a' | 'b' | null;
export type ConnectorSlot = 'a' | 'b';

export interface LayoutMatch {
    match: BracketMatchWithPhase;
    x: number;
    y: number;
    centerY: number;
    phase: string;
}

export interface LayoutConnector {
    id: string;
    fromMatchNumber: number;
    toMatchNumber: number;
    toSlot: ConnectorSlot;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    /**
     * Onde a linha dobra. Sai do destino, e não da origem, de propósito: assim
     * os dois jogos que alimentam a mesma chave dobram no **mesmo** x, e as
     * duas ligações se somam numa única haste vertical — o desenho de chave de
     * torneio de sempre, em que a haste é o que diz "estes dois viram aquele".
     */
    spineX: number;
    active: boolean;
}

export interface BracketPhaseLayout {
    phase: string;
    label: string;
    x: number;
    matches: LayoutMatch[];
}

export interface BracketLayout {
    className: string;
    width: number;
    height: number;
    cardWidth: number;
    cardHeight: number;
    phases: BracketPhaseLayout[];
    matchesByNumber: Map<number, LayoutMatch>;
    connectors: LayoutConnector[];
}

export const PHASE_LABELS: Record<string, string> = {
    preliminar: 'Preliminar',
    qualify: 'Qualificatórias',
    '16avos': '16 avos',
    oitavas: 'Oitavas',
    quartas: 'Quartas',
    semifinal: 'Semifinal',
    final: 'Final',
};

export const PHASES_BY_CLASS: Record<ResenhaClass, string[]> = {
    '4ª Classe': ['preliminar', 'oitavas', 'quartas', 'semifinal', 'final'],
    '5ª Classe': ['oitavas', 'quartas', 'semifinal', 'final'],
};

/**
 * Ordem das colunas quando o quadro não é do Resenha, cujas classes têm
 * sequência fixa. Sai da numeração dos jogos, que é atribuída fase a fase na
 * ordem em que elas acontecem — assim vale para qualquer vocabulário de fase,
 * inclusive os do Criador ('qualify', '16avos'), sem lista para manter.
 */
export function derivePhaseOrder(matches: BracketMatchWithPhase[]): string[] {
    const primeiroJogoDaFase = new Map<string, number>();

    for (const match of matches) {
        if (!match.round_phase) continue;
        const atual = primeiroJogoDaFase.get(match.round_phase);
        if (atual == null || match.match_number < atual) {
            primeiroJogoDaFase.set(match.round_phase, match.match_number);
        }
    }

    return [...primeiroJogoDaFase.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([phase]) => phase);
}

const isResenhaClass = (className: string): className is ResenhaClass =>
    className in PHASES_BY_CLASS;

/**
 * Sequência de fases da classe.
 *
 * A lista fixa do Resenha depende de ser o Resenha, não do nome da classe:
 * '4ª Classe' e '5ª Classe' são nomes que qualquer campeonato usa, e aplicá-la
 * a um campeonato do Criador desenhava uma coluna 'preliminar' vazia e engolia
 * a fase 'qualify', que não está na lista.
 */
export function phaseOrderFor(
    matches: BracketMatchWithPhase[],
    className: string,
    resenhaOpen = false,
): string[] {
    if (resenhaOpen && isResenhaClass(className)) return PHASES_BY_CLASS[className];
    return derivePhaseOrder(matches);
}

const CARD_WIDTH = 280;
const CARD_HEIGHT = 88;

/**
 * Folga mínima entre uma coluna e a seguinte para a curva de ligação caber sem
 * dobrar feio. É o freio de quem for apertar o quadro mais adiante.
 */
export const MIN_CONNECTOR_RUN = 72;

/**
 * Vão entre as fases.
 *
 * Era 180 px — 64% da largura do cartão, um corredor vazio que o olho
 * atravessava sem ler nada e que empurrava o quadro para 1724 px de largura.
 * Em 112 as fases leem como vizinhas, a curva continua folgada, e o quadro
 * inteiro encolhe ~12%.
 */
export const PHASE_COLUMN_GAP = 112;
const COLUMN_GAP = PHASE_COLUMN_GAP;
const ROW_GAP = 30;
const BOARD_PADDING_X = 32;
const BOARD_PADDING_Y = 76;

export function normalizeScoreSlots(scoreA: number[] = [], scoreB: number[] = []): ScoreSlot[] {
    return Array.from({ length: 3 }, (_, index) => {
        const a = typeof scoreA[index] === 'number' ? scoreA[index] : null;
        const b = typeof scoreB[index] === 'number' ? scoreB[index] : null;
        return { index, a, b, played: a !== null || b !== null };
    });
}

export function getMatchWinnerSide(match: BracketMatchWithPhase): WinnerSide {
    if (!match.winner_registration_id) return null;
    if (match.winner_registration_id === match.registration_a_id) return 'a';
    if (match.winner_registration_id === match.registration_b_id) return 'b';
    return null;
}

export function getClassMatches(
    bracket: BracketMatchWithPhase[],
    className: string,
): BracketMatchWithPhase[] {
    return bracket
        .filter(match => match.bracket_class === className)
        .sort((a, b) => a.match_number - b.match_number);
}

export function getCurrentPhaseForClass(
    matches: BracketMatchWithPhase[],
    className: string,
    resenhaOpen = false,
): string {
    const classMatches = getClassMatches(matches, className);
    const phaseOrder = phaseOrderFor(classMatches, className, resenhaOpen);
    if (classMatches.length === 0 || phaseOrder.length === 0) return phaseOrder[0] ?? '';

    const hasPlayableParticipants = (match: BracketMatchWithPhase) =>
        Boolean(match.registration_a_id || match.player_a_source_match_number) &&
        Boolean(match.registration_b_id || match.player_b_source_match_number);

    const pendingPlayable = classMatches.filter(match =>
        match.status !== 'finished' && hasPlayableParticipants(match),
    );

    for (const phase of phaseOrder) {
        if (pendingPlayable.some(match => match.round_phase === phase)) return phase;
    }

    if (classMatches.every(match => match.status === 'finished')) {
        return phaseOrder[phaseOrder.length - 1];
    }

    return phaseOrder[0];
}

/**
 * Altura de cada jogo de uma fase.
 *
 * A regra vem do desenho clássico de chave: **o jogo fica na altura do meio
 * entre os dois que o alimentam**. É isso que faz um par de irmãos ler como par
 * sem depender da linha — antes todas as fases empilhavam do topo com o mesmo
 * passo, e quem vinha de onde só se descobria seguindo o traço com o olho.
 *
 * Quem não tem origem conhecida (a primeira fase, ou um convidado direto numa
 * fase adiantada) cai na posição sequencial. A varredura final empurra para
 * baixo o que ficaria sobreposto, preservando a ordem: quadros irregulares —
 * uma qualificatória de um jogo só alimentando quartas de quatro — são a
 * regra aqui, não a exceção.
 */
function resolvePhaseY(
    phaseMatches: BracketMatchWithPhase[],
    posicionados: Map<number, LayoutMatch>,
): number[] {
    const desejadas = phaseMatches.map((match, rowIndex) => {
        const origens = [match.player_a_source_match_number, match.player_b_source_match_number]
            .filter((n): n is number => n != null)
            .map(n => posicionados.get(n)?.centerY)
            .filter((c): c is number => c != null);

        if (origens.length === 0) {
            return BOARD_PADDING_Y + rowIndex * (CARD_HEIGHT + ROW_GAP);
        }

        const centro = origens.reduce((soma, c) => soma + c, 0) / origens.length;
        return centro - CARD_HEIGHT / 2;
    });

    let piso = BOARD_PADDING_Y;
    return desejadas.map(y => {
        const posicao = Math.max(y, piso);
        piso = posicao + CARD_HEIGHT + ROW_GAP;
        return posicao;
    });
}

export function buildResenhaBracketLayout(
    matches: BracketMatchWithPhase[],
    className: string,
    resenhaOpen = false,
): BracketLayout {
    const phaseOrder = phaseOrderFor(matches, className, resenhaOpen);
    const phases: BracketPhaseLayout[] = [];
    const matchesByNumber = new Map<number, LayoutMatch>();

    phaseOrder.forEach((phase, phaseIndex) => {
        const phaseMatches = matches
            .filter(match => match.round_phase === phase)
            .sort((a, b) => a.match_number - b.match_number);

        const x = BOARD_PADDING_X + phaseIndex * (CARD_WIDTH + COLUMN_GAP);
        const phaseLayout: BracketPhaseLayout = {
            phase,
            label: PHASE_LABELS[phase] ?? phase,
            x,
            matches: [],
        };

        const ys = resolvePhaseY(phaseMatches, matchesByNumber);

        phaseMatches.forEach((match, rowIndex) => {
            const y = ys[rowIndex];
            const layoutMatch = {
                match,
                x,
                y,
                centerY: y + CARD_HEIGHT / 2,
                phase,
            };
            phaseLayout.matches.push(layoutMatch);
            matchesByNumber.set(match.match_number, layoutMatch);
        });

        phases.push(phaseLayout);
    });

    const connectors: LayoutConnector[] = [];
    for (const destination of matchesByNumber.values()) {
        const sources: Array<{ slot: ConnectorSlot; matchNumber?: number }> = [
            { slot: 'a', matchNumber: destination.match.player_a_source_match_number },
            { slot: 'b', matchNumber: destination.match.player_b_source_match_number },
        ];

        for (const source of sources) {
            if (source.matchNumber == null) continue;
            const origin = matchesByNumber.get(source.matchNumber);
            if (!origin) continue;
            connectors.push({
                id: `${origin.match.match_number}-${destination.match.match_number}-${source.slot}`,
                fromMatchNumber: origin.match.match_number,
                toMatchNumber: destination.match.match_number,
                toSlot: source.slot,
                startX: origin.x + CARD_WIDTH,
                startY: origin.centerY,
                endX: destination.x,
                endY: destination.centerY,
                spineX: destination.x - COLUMN_GAP / 2,
                active: Boolean(origin.match.winner_registration_id),
            });
        }
    }

    // A altura sai das posições reais: com as fases centradas, uma coluna de
    // dois jogos pode terminar mais embaixo do que uma de quatro.
    const phaseHeights = phases.map(phase =>
        phase.matches.reduce((maior, m) => Math.max(maior, m.y + CARD_HEIGHT), 0) - BOARD_PADDING_Y,
    );
    const width = BOARD_PADDING_X * 2 + phaseOrder.length * CARD_WIDTH + Math.max(0, phaseOrder.length - 1) * COLUMN_GAP;
    const height = BOARD_PADDING_Y * 2 + Math.max(CARD_HEIGHT, ...phaseHeights);

    return {
        className,
        width,
        height,
        cardWidth: CARD_WIDTH,
        cardHeight: CARD_HEIGHT,
        phases,
        matchesByNumber,
        connectors,
    };
}

// ── Estado do cartão ─────────────────────────────────────────────────────────

export type MatchState = 'finished' | 'live' | 'pending';

/**
 * Em que pé está a partida, para o cartão saber que cara ter.
 *
 * "Ao vivo" não é um valor guardado no banco — sai de haver placar lançado numa
 * partida que ainda não encerrou. É a leitura possível com os dados de hoje, e
 * é ela que dá ao quadro o único estado que faltava: o jogo que está
 * acontecendo agora, hoje indistinguível de um que só acontece amanhã.
 */
export function getMatchState(match: BracketMatchWithPhase): MatchState {
    if (match.status === 'finished') return 'finished';
    return playedScoreSlots(match.score_a, match.score_b).length > 0 ? 'live' : 'pending';
}

/**
 * Só os sets que existem. O quadro antigo desenhava três colunas fixas e
 * preenchia o que sobrava com traços — seis por cartão pendente, o que fazia
 * todo jogo por disputar parecer ter dados.
 */
export function playedScoreSlots(scoreA: number[] = [], scoreB: number[] = []): ScoreSlot[] {
    return normalizeScoreSlots(scoreA, scoreB).filter(slot => slot.played);
}

/**
 * Partidas que encerraram entre duas cargas do quadro — o gatilho da animação
 * de avanço.
 *
 * A primeira carga nunca conta: sem essa guarda, abrir um campeonato já
 * decidido animaria a chave inteira de uma vez.
 */
export function detectNewlyFinished(
    before: Pick<BracketMatchWithPhase, 'id' | 'status'>[],
    after: Pick<BracketMatchWithPhase, 'id' | 'status'>[]
): string[] {
    if (before.length === 0) return [];

    const antes = new Map(before.map(m => [m.id, m.status]));
    return after
        .filter(m => m.status === 'finished' && antes.get(m.id) === 'pending')
        .map(m => m.id);
}

const DIAS_ABREVIADOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/**
 * Dia do jogo em forma curta — "Qua 26/08" — para caber na faixa do cartão.
 *
 * O `T00:00:00` não é decorativo: `new Date('2026-08-26')` é meia-noite **UTC**,
 * que em Fortaleza (UTC−3) já é dia 25. Sem ele, todo jogo apareceria um dia
 * antes do que é.
 */
export function formatMatchDay(scheduledDate: string | null | undefined): string | null {
    if (!scheduledDate) return null;

    const date = new Date(`${scheduledDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;

    const dia = String(date.getDate()).padStart(2, '0');
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    return `${DIAS_ABREVIADOS[date.getDay()]} ${dia}/${mes}`;
}


/**
 * Traçado da ligação entre dois jogos.
 *
 * Uma curva cúbica única. Antes eram dois arcos quadráticos emendados com raio
 * fixo de 18 px: com o vão de 180 px passava, mas em vão curto a emenda vira um
 * bico. O cúbico se acomoda a qualquer distância, e quando os dois jogos estão
 * na mesma altura vira uma reta — que é o desenho honesto para esse caso.
 */
/** Raio do canto onde a linha dobra. Suave o bastante para casar com os cartões. */
const CORNER_RADIUS = 10;

/**
 * Traçado da ligação entre dois jogos: cotovelo, não diagonal.
 *
 * Sai na horizontal do jogo de origem, dobra na haste vertical e entra na
 * horizontal do jogo seguinte. Como a haste fica no mesmo x para os dois
 * irmãos, as duas ligações se somam no desenho de chave de sempre — e é a
 * haste, não a curva, que diz "estes dois viram aquele".
 *
 * Uma curva diagonal ligava os pontos certos e não dizia isso: dois traços
 * paralelos chegando no mesmo lugar não formam par nenhum.
 */
export function buildConnectorPath(
    connector: Pick<LayoutConnector, 'startX' | 'startY' | 'endX' | 'endY' | 'spineX'>
): string {
    const { startX, startY, endX, endY } = connector;
    const spineX = Math.min(Math.max(connector.spineX, startX), endX);

    if (startY === endY) {
        return `M ${startX} ${startY} H ${endX}`;
    }

    const descendo = endY > startY;
    const raio = Math.min(CORNER_RADIUS, Math.abs(endY - startY) / 2, Math.abs(spineX - startX), Math.abs(endX - spineX));
    const passo = descendo ? raio : -raio;

    return [
        `M ${startX} ${startY}`,
        `H ${spineX - raio}`,
        `Q ${spineX} ${startY} ${spineX} ${startY + passo}`,
        `V ${endY - passo}`,
        `Q ${spineX} ${endY} ${spineX + raio} ${endY}`,
        `H ${endX}`,
    ].join(' ');
}
