import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Minus, Plus, RotateCcw, Trophy } from 'lucide-react';
import {
    buildResenhaBracketLayout,
    getCurrentPhaseForClass,
    getClassMatches,
    getMatchWinnerSide,
    normalizeScoreSlots,
    type LayoutConnector,
    type LayoutMatch,
} from '../lib/resenhaOpenBracketLayout';
import type { BracketMatchWithPhase, ResenhaClass } from '../lib/resenhaOpenService';
import { getOfficialMatchTime } from '../lib/resenhaOpenOfficialBracket';

function formatMatchTime(raw: string): string {
    const parts = raw.split(':');
    const h = parts[0] ?? '00';
    const m = parts[1] ?? '00';
    return `${h}h${m}`;
}

interface Props {
    bracket: BracketMatchWithPhase[];
    championshipName: string;
    onMatchSelect?: (match: BracketMatchWithPhase) => void;
}

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.2;
const ZOOM_STEP = 0.1;

export const ResenhaOpenTournamentBoard: React.FC<Props> = ({ bracket, championshipName, onMatchSelect }) => {
    const availableClasses = useMemo(
        () => (['4ª Classe', '5ª Classe'] as ResenhaClass[]).filter(
            className => bracket.some(match => match.bracket_class === className),
        ),
        [bracket],
    );
    const [selectedClass, setSelectedClass] = useState<ResenhaClass>(availableClasses[0] ?? '4ª Classe');
    const [zoom, setZoom] = useState(0.85);
    const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const matchRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    useEffect(() => {
        if (availableClasses.length > 0 && !availableClasses.includes(selectedClass)) {
            setSelectedClass(availableClasses[0]);
        }
    }, [availableClasses, selectedClass]);

    const classMatches = useMemo(
        () => getClassMatches(bracket, selectedClass),
        [bracket, selectedClass],
    );
    const layout = useMemo(
        () => buildResenhaBracketLayout(classMatches, selectedClass),
        [classMatches, selectedClass],
    );
    const currentPhase = useMemo(
        () => getCurrentPhaseForClass(bracket, selectedClass),
        [bracket, selectedClass],
    );

    const centerPhase = (phase: string, behavior: ScrollBehavior = 'smooth') => {
        const phaseLayout = layout.phases.find(item => item.phase === phase);
        if (!viewportRef.current || !phaseLayout) return;
        viewportRef.current.scrollTo({
            left: Math.max(0, phaseLayout.x * zoom - viewportRef.current.clientWidth / 3),
            top: 0,
            behavior,
        });
    };

    useEffect(() => {
        requestAnimationFrame(() => centerPhase(currentPhase, 'auto'));
    }, [currentPhase, layout, zoom]);

    const handleClassChange = (className: ResenhaClass) => {
        setSelectedClass(className);
        setSelectedMatchId(null);
        requestAnimationFrame(() => {
            const nextPhase = getCurrentPhaseForClass(bracket, className);
            centerPhase(nextPhase);
        });
    };

    const handleSelectMatch = (matchId: string) => {
        const nextMatchId = selectedMatchId === matchId ? null : matchId;
        setSelectedMatchId(nextMatchId);
        if (!nextMatchId) return;

        const selected = classMatches.find(match => match.id === nextMatchId);
        if (selected) onMatchSelect?.(selected);

        requestAnimationFrame(() => {
            matchRefs.current[nextMatchId]?.scrollIntoView({
                block: 'center',
                inline: 'center',
                behavior: 'smooth',
            });
        });
    };

    const updateZoom = (delta: number) => {
        setZoom(current => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + delta).toFixed(2)))));
    };

    if (availableClasses.length === 0) {
        return null;
    }

    return (
        <div className="w-full max-w-7xl mx-auto px-[max(0.75rem,env(safe-area-inset-left))] py-3">
            <section className="rounded-[1.75rem] bg-[#061320] text-white shadow-2xl shadow-slate-950/30 overflow-hidden border border-white/10">
                <div className="px-4 sm:px-6 pt-5 pb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">Tabela de Confrontos</p>
                        <h2 className="text-xl sm:text-2xl font-black tracking-tight">{championshipName}</h2>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                        <BracketClassSwitch
                            availableClasses={availableClasses}
                            selectedClass={selectedClass}
                            onChange={handleClassChange}
                        />
                        <ZoomControls
                            zoom={zoom}
                            onZoomIn={() => updateZoom(ZOOM_STEP)}
                            onZoomOut={() => updateZoom(-ZOOM_STEP)}
                            onReset={() => {
                                setZoom(0.85);
                                requestAnimationFrame(() => centerPhase(currentPhase));
                            }}
                        />
                    </div>
                </div>

                <div
                    ref={viewportRef}
                    className="relative overflow-auto overscroll-contain px-4 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] cursor-grab active:cursor-grabbing"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                >
                    <div
                        className="relative rounded-3xl border border-white/10 bg-linear-to-br from-[#071b2d] via-[#081827] to-[#050b16] shadow-inner"
                        style={{
                            width: layout.width * zoom,
                            height: layout.height * zoom,
                            minWidth: '100%',
                        }}
                    >
                        <div
                            className="absolute origin-top-left"
                            style={{
                                width: layout.width,
                                height: layout.height,
                                transform: `scale(${zoom})`,
                            }}
                        >
                            <PhaseHeaders layout={layout} />
                            <ConnectorLayer connectors={layout.connectors} />
                            {layout.phases.flatMap(phase => phase.matches).map(layoutMatch => (
                                <BracketMatchCard
                                    key={layoutMatch.match.id}
                                    layoutMatch={layoutMatch}
                                    selected={selectedMatchId === layoutMatch.match.id}
                                    refCallback={node => {
                                        matchRefs.current[layoutMatch.match.id] = node;
                                    }}
                                    onSelect={() => handleSelectMatch(layoutMatch.match.id)}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="sticky left-4 bottom-3 mt-3 inline-flex rounded-full border border-white/10 bg-[#061320]/85 px-3 py-2 text-[11px] font-bold text-slate-300 backdrop-blur-md">
                        Arraste para navegar • Use zoom para ajustar • Toque em um jogo para destacar
                    </div>
                </div>
            </section>
        </div>
    );
};

const BracketClassSwitch: React.FC<{
    availableClasses: ResenhaClass[];
    selectedClass: ResenhaClass;
    onChange: (className: ResenhaClass) => void;
}> = ({ availableClasses, selectedClass, onChange }) => (
    <div className="inline-flex rounded-full border border-white/10 bg-[#0d2338] p-1 shadow-inner" aria-label="Selecionar classe do chaveamento">
        {availableClasses.map(className => (
            <button
                key={className}
                type="button"
                aria-pressed={selectedClass === className}
                onClick={() => onChange(className)}
                className={`rounded-full px-4 py-2 text-xs font-black transition-all ${
                    selectedClass === className
                        ? 'bg-saibro-600 text-white shadow-lg shadow-orange-950/30'
                        : 'text-slate-300 hover:text-white'
                }`}
            >
                {className}
            </button>
        ))}
    </div>
);

const ZoomControls: React.FC<{
    zoom: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
}> = ({ zoom, onZoomIn, onZoomOut, onReset }) => (
    <div className="inline-flex items-center overflow-hidden rounded-full border border-white/10 bg-[#0d2338] text-xs font-black text-slate-200 shadow-inner">
        <button type="button" aria-label="Reduzir zoom" onClick={onZoomOut} className="p-2 hover:bg-white/10">
            <Minus size={14} />
        </button>
        <span className="min-w-14 border-x border-white/10 px-3 py-2 text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Aumentar zoom" onClick={onZoomIn} className="p-2 hover:bg-white/10">
            <Plus size={14} />
        </button>
        <button type="button" aria-label="Resetar zoom" onClick={onReset} className="border-l border-white/10 p-2 hover:bg-white/10">
            <RotateCcw size={14} />
        </button>
    </div>
);

const PhaseHeaders: React.FC<{ layout: ReturnType<typeof buildResenhaBracketLayout> }> = ({ layout }) => (
    <>
        {layout.phases.map(phase => (
            <div
                key={phase.phase}
                className="absolute text-[10px] font-black uppercase tracking-[0.18em] text-sky-200/80"
                style={{ left: phase.x, top: 26, width: layout.cardWidth }}
            >
                {phase.label}
            </div>
        ))}
    </>
);

const ConnectorLayer: React.FC<{ connectors: LayoutConnector[] }> = ({ connectors }) => (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {connectors.map(connector => {
            const midX = connector.startX + Math.max(52, (connector.endX - connector.startX) / 2);
            const d = `M ${connector.startX} ${connector.startY} H ${midX} Q ${midX + 18} ${connector.startY} ${midX + 18} ${(connector.startY + connector.endY) / 2} Q ${midX + 18} ${connector.endY} ${midX + 36} ${connector.endY} H ${connector.endX}`;
            return (
                <g key={connector.id}>
                    <path
                        d={d}
                        fill="none"
                        stroke={connector.active ? '#f06423' : '#4f8fc9'}
                        strokeWidth={connector.active ? 5 : 4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={connector.active ? 0.95 : 0.45}
                    />
                    <circle cx={connector.startX} cy={connector.startY} r={5} fill="#f8fafc" opacity={connector.active ? 1 : 0.7} />
                    <circle cx={connector.endX} cy={connector.endY} r={5} fill="#f8fafc" opacity={connector.active ? 1 : 0.7} />
                </g>
            );
        })}
    </svg>
);

const BracketMatchCard: React.FC<{
    layoutMatch: LayoutMatch;
    selected: boolean;
    onSelect: () => void;
    refCallback: (node: HTMLButtonElement | null) => void;
}> = ({ layoutMatch, selected, onSelect, refCallback }) => {
    const { match, x, y } = layoutMatch;
    const winnerSide = getMatchWinnerSide(match);
    const scoreSlots = normalizeScoreSlots(match.score_a, match.score_b);
    const pendingA = !match.registration_a_id;
    const pendingB = !match.registration_b_id;
    const accessibleName = `Jogo ${match.match_number}, ${match.player_a_label} contra ${match.player_b_label}`;

    const officialTime = getOfficialMatchTime(match.bracket_class ?? '', match.match_number);
    const realTime = match.scheduled_time ?? null;
    const isScheduled = Boolean(realTime && realTime !== (officialTime ? `${officialTime}:00` : null));
    const displayTime = realTime ? formatMatchTime(realTime) : (officialTime ? formatMatchTime(officialTime) : null);

    return (
        <button
            ref={refCallback}
            type="button"
            aria-label={accessibleName}
            aria-pressed={selected}
            onClick={onSelect}
            className={`absolute overflow-visible rounded-2xl text-left outline-none transition-all focus-visible:ring-4 focus-visible:ring-orange-300/70 ${
                selected ? 'scale-[1.03] ring-4 ring-orange-300/60' : ''
            }`}
            style={{ left: x, top: y, width: 280, height: 84 }}
        >
            {displayTime && (
                <span
                    className={`absolute left-1/2 -translate-x-1/2 -top-5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black whitespace-nowrap shadow ${
                        isScheduled
                            ? 'bg-orange-500 text-white'
                            : 'bg-slate-700/80 text-slate-200'
                    }`}
                >
                    {isScheduled && <Clock size={9} className="shrink-0" />}
                    {displayTime}
                </span>
            )}
            <div className="h-full overflow-hidden rounded-2xl border border-white/70 bg-slate-50 text-slate-900 shadow-xl shadow-black/25">
                <div className="h-1 bg-saibro-600" />
                <div className="grid h-[80px] grid-cols-[1fr_92px]">
                    <div className="min-w-0">
                        <PlayerRow
                            label={match.player_a_label}
                            pending={pendingA}
                            won={winnerSide === 'a'}
                            lost={winnerSide === 'b'}
                        />
                        <PlayerRow
                            label={match.player_b_label}
                            pending={pendingB}
                            won={winnerSide === 'b'}
                            lost={winnerSide === 'a'}
                        />
                    </div>
                    <div className="grid grid-cols-3 grid-rows-2 border-l border-slate-200 bg-slate-100">
                        {scoreSlots.map(slot => (
                            <ScoreCell
                                key={`a-${slot.index}`}
                                value={slot.a}
                                won={slot.a !== null && slot.b !== null && slot.a > slot.b}
                                borderBottom
                                ariaLabel={slot.played
                                    ? `Placar set ${slot.index + 1}: ${match.player_a_label} ${slot.a}, ${match.player_b_label} ${slot.b}`
                                    : `Placar set ${slot.index + 1}: não disputado`}
                            />
                        ))}
                        {scoreSlots.map(slot => (
                            <ScoreCell
                                key={`b-${slot.index}`}
                                value={slot.b}
                                won={slot.a !== null && slot.b !== null && slot.b > slot.a}
                                ariaLabel={slot.played
                                    ? `Placar set ${slot.index + 1}: ${match.player_a_label} ${slot.a}, ${match.player_b_label} ${slot.b}`
                                    : `Placar set ${slot.index + 1}: não disputado`}
                                hiddenLabel
                            />
                        ))}
                    </div>
                </div>
            </div>
            <span className="absolute -left-2 -top-2 rounded-full bg-slate-950 px-2 py-1 text-[10px] font-black text-white shadow-lg">
                J{match.match_number}
            </span>
            {match.is_walkover && (
                <span className="absolute -right-2 -top-2 rounded-full bg-red-600 px-2 py-1 text-[10px] font-black text-white shadow-lg">W.O.</span>
            )}
            {winnerSide && (
                <Trophy className="absolute -right-2 -bottom-2 rounded-full bg-green-600 p-1 text-white shadow-lg" size={22} />
            )}
        </button>
    );
};

const PlayerRow: React.FC<{ label: string; pending: boolean; won: boolean; lost: boolean }> = ({ label, pending, won, lost }) => (
    <div className={`flex h-10 min-w-0 items-center gap-2 border-b border-slate-200 px-3 last:border-b-0 ${lost ? 'text-slate-400' : 'text-slate-950'}`}>
        <span className={`truncate text-[13px] font-black ${pending ? 'italic text-slate-400' : ''}`}>
            {label}
        </span>
        {won && <span className="ml-auto text-[11px] font-black text-green-600">V</span>}
    </div>
);

const ScoreCell: React.FC<{
    value: number | null;
    won: boolean;
    borderBottom?: boolean;
    ariaLabel: string;
    hiddenLabel?: boolean;
}> = ({ value, won, borderBottom, ariaLabel, hiddenLabel }) => (
    <span
        aria-hidden={hiddenLabel ? 'true' : undefined}
        aria-label={hiddenLabel ? undefined : ariaLabel}
        className={`grid place-items-center border-l border-slate-200 first:border-l-0 text-xs font-black ${
            borderBottom ? 'border-b' : ''
        } ${won ? 'bg-saibro-600 text-white' : value === null ? 'text-slate-300' : 'text-slate-700'}`}
    >
        {value ?? '-'}
    </span>
);
