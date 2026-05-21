import type { BracketMatchWithPhase } from './resenhaOpenService';

type OfficialMatchInput = {
    className: '4ª Classe' | '5ª Classe';
    matchNumber: number;
    phase: string;
    playerA?: string;
    playerB?: string;
    sourceA?: number;
    sourceB?: number;
    time?: string;
};

const phaseDate: Record<string, string> = {
    preliminar: '2026-05-19',
    oitavas: '2026-05-22',
    quartas: '2026-05-23',
    semifinal: '2026-05-23',
    final: '2026-05-23',
};

const officialMatches: OfficialMatchInput[] = [
    { className: '5ª Classe', matchNumber: 1, phase: 'oitavas', playerA: 'Davi Arcelino', playerB: 'Williams Santos', time: '17:00' },
    { className: '5ª Classe', matchNumber: 2, phase: 'oitavas', playerA: 'Lucas Rodrigues', playerB: 'Macel Ponte', time: '18:00' },
    { className: '5ª Classe', matchNumber: 3, phase: 'oitavas', playerA: 'Mailson Freitas', playerB: 'Diego Parente', time: '19:00' },
    { className: '5ª Classe', matchNumber: 4, phase: 'oitavas', playerA: 'Thiago Freitas', playerB: 'Derlan', time: '20:00' },
    { className: '5ª Classe', matchNumber: 5, phase: 'oitavas', playerA: 'Marcelino', playerB: 'Victor Luceti', time: '21:00' },
    { className: '5ª Classe', matchNumber: 6, phase: 'oitavas', playerA: 'Mardes Souza', playerB: 'Vinicius Cangussú', time: '22:00' },
    { className: '5ª Classe', matchNumber: 7, phase: 'oitavas', playerA: 'Ricardo Barroso', playerB: 'Romário Soares', time: '23:00' },
    { className: '5ª Classe', matchNumber: 8, phase: 'oitavas', playerA: 'Helder Filho', playerB: 'Ítalo Cangussú', time: '00:00' },
    { className: '5ª Classe', matchNumber: 9, phase: 'quartas', sourceA: 1, sourceB: 2, time: '17:00' },
    { className: '5ª Classe', matchNumber: 10, phase: 'quartas', sourceA: 3, sourceB: 4, time: '18:00' },
    { className: '5ª Classe', matchNumber: 11, phase: 'quartas', sourceA: 5, sourceB: 6, time: '19:00' },
    { className: '5ª Classe', matchNumber: 12, phase: 'quartas', sourceA: 7, sourceB: 8, time: '20:00' },
    { className: '5ª Classe', matchNumber: 13, phase: 'semifinal', sourceA: 9, sourceB: 10, time: '17:00' },
    { className: '5ª Classe', matchNumber: 14, phase: 'semifinal', sourceA: 11, sourceB: 12, time: '18:00' },
    { className: '5ª Classe', matchNumber: 15, phase: 'final', sourceA: 13, sourceB: 14, time: '20:00' },
    { className: '4ª Classe', matchNumber: 1, phase: 'preliminar', playerA: 'Hernades', playerB: 'Claudio', time: '17:00' },
    { className: '4ª Classe', matchNumber: 2, phase: 'preliminar', playerA: 'Derlan', playerB: 'Joaquim', time: '18:00' },
    { className: '4ª Classe', matchNumber: 3, phase: 'preliminar', playerA: 'Isamael', playerB: 'Frederico', time: '19:00' },
    { className: '4ª Classe', matchNumber: 4, phase: 'preliminar', playerA: 'Hermeson', playerB: 'Francielton', time: '20:00' },
    { className: '4ª Classe', matchNumber: 5, phase: 'oitavas', playerA: 'Thieslley', sourceB: 1, time: '17:00' },
    { className: '4ª Classe', matchNumber: 6, phase: 'oitavas', playerA: 'Miguel', playerB: 'Henrique', time: '18:00' },
    { className: '4ª Classe', matchNumber: 7, phase: 'oitavas', playerA: 'Bruno', playerB: 'Diego Memória', time: '21:00' },
    { className: '4ª Classe', matchNumber: 8, phase: 'oitavas', playerA: 'Gustavo', sourceB: 2, time: '19:00' },
    { className: '4ª Classe', matchNumber: 9, phase: 'oitavas', playerA: 'Rafael', sourceB: 3, time: '20:00' },
    { className: '4ª Classe', matchNumber: 10, phase: 'oitavas', playerA: 'Ednaldo', playerB: 'Mário', time: '22:00' },
    { className: '4ª Classe', matchNumber: 11, phase: 'oitavas', playerA: 'Tiago', playerB: 'Marcelo' },
    { className: '4ª Classe', matchNumber: 12, phase: 'oitavas', playerA: 'Josiel', sourceB: 4, time: '21:00' },
    { className: '4ª Classe', matchNumber: 13, phase: 'quartas', sourceA: 5, sourceB: 6, time: '17:00' },
    { className: '4ª Classe', matchNumber: 14, phase: 'quartas', sourceA: 7, sourceB: 8, time: '18:00' },
    { className: '4ª Classe', matchNumber: 15, phase: 'quartas', sourceA: 9, sourceB: 10, time: '19:00' },
    { className: '4ª Classe', matchNumber: 16, phase: 'quartas', sourceA: 11, sourceB: 12, time: '20:00' },
    { className: '4ª Classe', matchNumber: 17, phase: 'semifinal', sourceA: 13, sourceB: 14, time: '17:00' },
    { className: '4ª Classe', matchNumber: 18, phase: 'semifinal', sourceA: 15, sourceB: 16, time: '18:00' },
    { className: '4ª Classe', matchNumber: 19, phase: 'final', sourceA: 17, sourceB: 18, time: '20:00' },
];

const officialTimeMap = new Map(
    officialMatches.map(m => [`${m.className}:${m.matchNumber}`, m.time ?? null])
);

export function getOfficialMatchTime(className: string, matchNumber: number): string | null {
    return officialTimeMap.get(`${className}:${matchNumber}`) ?? null;
}

const registrationId = (match: OfficialMatchInput, side: 'a' | 'b') => (
    match[side === 'a' ? 'playerA' : 'playerB']
        ? `official-${match.className}-${match.matchNumber}-${side}`
        : null
);

const sourceLabel = (source?: number) => source != null ? `Vencedor Jogo ${source}` : '?';

export function getOfficialResenhaOpenBracket(): BracketMatchWithPhase[] {
    return officialMatches.map((match): BracketMatchWithPhase => ({
        id: `official-${match.className}-${match.matchNumber}`,
        match_number: match.matchNumber,
        registration_a_id: registrationId(match, 'a'),
        registration_b_id: registrationId(match, 'b'),
        player_a_label: match.playerA ?? sourceLabel(match.sourceA),
        player_b_label: match.playerB ?? sourceLabel(match.sourceB),
        player_a_source_match_number: match.sourceA,
        player_b_source_match_number: match.sourceB,
        status: 'pending',
        winner_registration_id: null,
        is_walkover: false,
        round_phase: match.phase,
        bracket_class: match.className,
        scheduled_date: phaseDate[match.phase] ?? null,
        scheduled_time: match.time ? `${match.time}:00` : null,
        score_a: [],
        score_b: [],
    }));
}
