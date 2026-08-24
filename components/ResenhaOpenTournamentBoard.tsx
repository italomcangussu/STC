import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Clock, Loader2, Minus, Plus, RotateCcw, Share2 } from 'lucide-react';
import {
    buildConnectorPath,
    buildResenhaBracketLayout,
    detectNewlyFinished,
    formatMatchDay,
    getCurrentPhaseForClass,
    getClassMatches,
    getMatchState,
    getMatchWinnerSide,
    playedScoreSlots,
    type LayoutConnector,
    type LayoutMatch,
    type MatchState,
} from '../lib/resenhaOpenBracketLayout';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';
import { getOfficialMatchTime } from '../lib/resenhaOpenOfficialBracket';
import {
    buildBracketImageName,
    captureNodeToPng,
    createExportHost,
    shareOrDownload,
    waitForPaint,
} from '../lib/bracketImageExport';
import { notify } from '../lib/notifications';

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
    /**
     * Marca o quadro como sendo do Resenha Open. Governa as duas coisas que
     * dependem de ser ele e não do nome da classe — que '4ª Classe' e
     * '5ª Classe' não distinguem, porque qualquer campeonato as usa:
     * a sequência fixa de fases e os horários oficiais impressos.
     */
    isResenhaOpen?: boolean;
    /**
     * Desenha uma cópia para exportação: uma classe fixa, em tamanho real, sem
     * os controles que só servem para navegar na tela. Usado pela captura, que
     * monta o quadro fora da tela — o que está visível nunca é a chave inteira.
     */
    exportClass?: string;
}

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.2;
const ZOOM_STEP = 0.1;

/** Curva de mola usada em todo movimento do quadro. */
const SPRING = 'cubic-bezier(0.32,0.72,0,1)';

/** Quanto tempo o quadro fica contando a história de um avanço. */
const ADVANCE_MS = 1400;

export const ResenhaOpenTournamentBoard: React.FC<Props> = ({ bracket, championshipName, onMatchSelect, isResenhaOpen = false, exportClass }) => {
    // As classes saem do próprio quadro: as duas do Resenha primeiro, para
    // preservar a ordem de sempre, e depois as demais, que só existem em
    // campeonatos criados pelo Criador.
    const availableClasses = useMemo(() => {
        const noQuadro = [...new Set(
            bracket.map(match => match.bracket_class).filter((c): c is string => !!c)
        )];
        const conhecidas = (['4ª Classe', '5ª Classe'] as string[]).filter(c => noQuadro.includes(c));
        return [...conhecidas, ...noQuadro.filter(c => !conhecidas.includes(c)).sort()];
    }, [bracket]);

    const exporting = !!exportClass;
    const [chosenClass, setSelectedClass] = useState<string>(availableClasses[0] ?? '4ª Classe');
    const selectedClass = exportClass ?? chosenClass;
    const [zoomLevel, setZoom] = useState(0.85);
    const zoom = exporting ? 1 : zoomLevel;
    const [exportando, setExportando] = useState(false);
    const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
    const viewportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (exporting) return;
        if (availableClasses.length > 0 && !availableClasses.includes(selectedClass)) {
            setSelectedClass(availableClasses[0]);
        }
    }, [availableClasses, selectedClass, exporting]);

    // ── Avanço do vencedor ───────────────────────────────────────────────────
    // Guardar o quadro anterior é o que permite saber que uma partida acabou de
    // encerrar — e não que ela já estava encerrada quando a tela abriu.
    const [advancingNumbers, setAdvancingNumbers] = useState<Set<number>>(() => new Set());
    const previousBracket = useRef<BracketMatchWithPhase[]>([]);

    useEffect(() => {
        const encerradasAgora = detectNewlyFinished(previousBracket.current, bracket);
        previousBracket.current = bracket;
        if (encerradasAgora.length === 0) return;

        const numeros = new Set(
            bracket.filter(m => encerradasAgora.includes(m.id)).map(m => m.match_number)
        );
        setAdvancingNumbers(numeros);
        const timer = setTimeout(() => setAdvancingNumbers(new Set()), ADVANCE_MS);
        return () => clearTimeout(timer);
    }, [bracket]);

    const classMatches = useMemo(
        () => getClassMatches(bracket, selectedClass),
        [bracket, selectedClass],
    );
    const layout = useMemo(
        () => buildResenhaBracketLayout(classMatches, selectedClass, isResenhaOpen),
        [classMatches, selectedClass, isResenhaOpen],
    );
    const currentPhase = useMemo(
        () => getCurrentPhaseForClass(bracket, selectedClass, isResenhaOpen),
        [bracket, selectedClass, isResenhaOpen],
    );

    // `useCallback` aqui não é enfeite: sem ele a função nasce nova a cada
    // render, e o efeito abaixo — que precisa dela nas dependências — passaria
    // a rolar o quadro em **todo** render. Presa a `layout` e `zoom`, ela só
    // muda quando a posição de destino realmente muda.
    const centerPhase = useCallback((phase: string, behavior: ScrollBehavior = 'smooth') => {
        const phaseLayout = layout.phases.find(item => item.phase === phase);
        if (!viewportRef.current || !phaseLayout) return;
        viewportRef.current.scrollTo({
            left: Math.max(0, phaseLayout.x * zoom - viewportRef.current.clientWidth / 3),
            top: 0,
            behavior,
        });
    }, [layout, zoom]);

    useEffect(() => {
        if (exporting) return;
        requestAnimationFrame(() => centerPhase(currentPhase, 'auto'));
    }, [currentPhase, centerPhase, exporting]);

    const handleClassChange = (className: string) => {
        setSelectedClass(className);
        setSelectedMatchId(null);
        requestAnimationFrame(() => {
            const nextPhase = getCurrentPhaseForClass(bracket, className, isResenhaOpen);
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
            // Buscar pelo atributo em vez de guardar refs: o callback de ref
            // nascia novo a cada render e o React desmontava e remontava a
            // referência de todos os cartões junto.
            const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nextMatchId) : nextMatchId;
            const node = viewportRef.current?.querySelector<HTMLElement>(`[data-match-id="${escaped}"]`);
            node?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
        });
    };

    const updateZoom = (delta: number) => {
        setZoom(current => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + delta).toFixed(2)))));
    };

    /**
     * Exporta todas as classes de uma vez.
     *
     * Cada classe é montada fora da tela em tamanho real e fotografada em
     * sequência — não em paralelo: html2canvas mede layout, e várias cópias
     * disputando a mesma thread dão medidas erradas.
     */
    const handleExport = async () => {
        if (exportando) return;
        setExportando(true);
        try {
            const files: File[] = [];
            for (const className of availableClasses) {
                const host = createExportHost();
                const root = createRoot(host);
                try {
                    root.render(
                        <ResenhaOpenTournamentBoard
                            bracket={bracket}
                            championshipName={championshipName}
                            isResenhaOpen={isResenhaOpen}
                            exportClass={className}
                        />
                    );
                    await waitForPaint();
                    files.push(await captureNodeToPng(host, buildBracketImageName(championshipName, className)));
                } finally {
                    root.unmount();
                    host.remove();
                }
            }

            const resultado = await shareOrDownload(files, {
                title: championshipName,
                text: `Tabela de Confrontos — ${championshipName}`,
            });

            if (resultado === 'downloaded') {
                notify.success(
                    files.length === 1 ? 'Imagem salva.' : `${files.length} imagens salvas.`,
                    {
                        description: files.length === 1
                            ? 'A chave foi baixada.'
                            : 'Uma imagem por classe. Se o navegador pedir permissão para vários downloads, aceite.',
                    }
                );
            }
        } catch (error) {
            notify.failure(error, 'Não foi possível exportar a chave.', {
                event: 'bracket_image_export_failed',
                championshipName,
            });
        } finally {
            setExportando(false);
        }
    };

    if (availableClasses.length === 0) {
        return null;
    }

    const cards = layout.phases.flatMap(phase =>
        phase.matches.map(layoutMatch => ({ layoutMatch, phaseLabel: phase.label }))
    );

    return (
        // No celular o quadro sangra até as bordas: o padding do contêiner da
        // página custava mais largura útil do que a moldura valia.
        <div className={exporting
            // Na cópia de exportação o quadro não sangra nem se limita: ele tem
            // o tamanho que tiver, que é o ponto de exportar.
            ? 'w-max p-6 bg-[#061320]'
            : 'w-auto -mx-4 px-0 py-3 sm:w-full sm:max-w-7xl sm:mx-auto sm:px-[max(0.75rem,env(safe-area-inset-left))]'}>
            <section className="relative rounded-none border-x-0 sm:rounded-[1.75rem] sm:border-x bg-[#061320] text-white shadow-2xl shadow-slate-950/30 overflow-hidden border border-white/10">
                <div className="px-3 sm:px-6 pt-5 pb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">Tabela de Confrontos</p>
                        <h2 className="text-xl sm:text-2xl font-black tracking-tight">{championshipName}</h2>
                        {/* Sem as abas de classe, o título é o único lugar que
                            diz de qual classe é esta imagem. */}
                        {exporting && (
                            <p className="mt-1 text-sm font-black uppercase tracking-[0.18em] text-sky-200/80">{selectedClass}</p>
                        )}
                    </div>

                    {!exporting && (
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                            <BracketClassSwitch
                                availableClasses={availableClasses}
                                selectedClass={selectedClass}
                                onChange={handleClassChange}
                            />
                            <div className="flex items-center gap-3">
                                <ZoomControls
                                    zoom={zoom}
                                    onZoomIn={() => updateZoom(ZOOM_STEP)}
                                    onZoomOut={() => updateZoom(-ZOOM_STEP)}
                                    onReset={() => {
                                        setZoom(0.85);
                                        requestAnimationFrame(() => centerPhase(currentPhase));
                                    }}
                                />
                                <ExportButton
                                    busy={exportando}
                                    classCount={availableClasses.length}
                                    onExport={handleExport}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div
                    ref={viewportRef}
                    data-bracket-viewport
                    className={exporting
                        ? 'relative px-6 pb-6'
                        : 'relative overflow-auto overscroll-contain px-2 sm:px-6 pb-[max(2.75rem,env(safe-area-inset-bottom))] cursor-grab active:cursor-grabbing'}
                    style={exporting ? undefined : { WebkitOverflowScrolling: 'touch' }}
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
                                transition: `transform 260ms ${SPRING}`,
                            }}
                        >
                            <PhaseHeaders layout={layout} />
                            <ConnectorLayer connectors={layout.connectors} advancingNumbers={advancingNumbers} />
                            {/* A chave da classe remonta os cartões, e é isso que
                                faz a entrada escalonada tocar de novo a cada troca. */}
                            <React.Fragment key={selectedClass}>
                                {cards.map(({ layoutMatch, phaseLabel }, index) => (
                                    <BracketMatchCard
                                        key={layoutMatch.match.id}
                                        layoutMatch={layoutMatch}
                                        phaseLabel={phaseLabel}
                                        selected={selectedMatchId === layoutMatch.match.id}
                                        onSelect={() => handleSelectMatch(layoutMatch.match.id)}
                                        showOfficialTimes={isResenhaOpen}
                                        advancing={advancingNumbers.has(layoutMatch.match.match_number)}
                                        landingSlot={landingSlotFor(layoutMatch.match, advancingNumbers)}
                                        enterDelayMs={Math.min(index * 45, 360)}
                                    />
                                ))}
                            </React.Fragment>
                        </div>
                    </div>
                </div>

                {/**
                 * A dica mora fora do contêiner que rola. Dentro dele, o
                 * `backdrop-blur` repintava a cada quadro do arrasto — o custo
                 * de GPU mais caro que este componente tinha, e o único que
                 * aparecia como engasgo no celular.
                 */}
                {!exporting && (
                <div className="pointer-events-none absolute left-3 sm:left-8 bottom-3 inline-flex whitespace-nowrap rounded-full border border-white/10 bg-[#061320]/85 px-3 py-2 text-xs font-bold text-slate-300 backdrop-blur-md">
                    {/* A frase inteira não cabe em 375 px: quebrava em duas linhas
                        e a segunda sumia atrás do `overflow-hidden` da moldura. */}
                    <span className="sm:hidden">Arraste • Zoom • Toque num jogo</span>
                    <span className="hidden sm:inline">Arraste para navegar • Use zoom para ajustar • Toque em um jogo para destacar</span>
                </div>
                )}
            </section>
        </div>
    );
};

/** Em qual vaga deste cartão o vencedor está pousando agora, se em alguma. */
function landingSlotFor(match: BracketMatchWithPhase, advancingNumbers: Set<number>): 'a' | 'b' | null {
    if (advancingNumbers.size === 0) return null;
    if (match.player_a_source_match_number != null && advancingNumbers.has(match.player_a_source_match_number)) return 'a';
    if (match.player_b_source_match_number != null && advancingNumbers.has(match.player_b_source_match_number)) return 'b';
    return null;
}

const ExportButton: React.FC<{
    busy: boolean;
    classCount: number;
    onExport: () => void;
}> = ({ busy, classCount, onExport }) => (
    <button
        type="button"
        onClick={onExport}
        disabled={busy}
        aria-label={classCount > 1 ? `Exportar ${classCount} imagens, uma por classe` : 'Exportar imagem da chave'}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-saibro-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-orange-950/30 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:brightness-110 active:scale-[0.97] disabled:opacity-60"
    >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
        {/* A contagem aparece antes do clique de propósito: se o quadro só
            enxergar uma classe, isso fica visível aqui e não depois, na
            dúvida entre "não capturou" e "não entregou". */}
        {busy ? 'Gerando…' : classCount > 1 ? `Exportar ${classCount} imagens` : 'Exportar imagem'}
    </button>
);

const BracketClassSwitch: React.FC<{
    availableClasses: string[];
    selectedClass: string;
    onChange: (className: string) => void;
}> = ({ availableClasses, selectedClass, onChange }) => (
    <div className="inline-flex rounded-full border border-white/10 bg-[#0d2338] p-1 shadow-inner" aria-label="Selecionar classe do chaveamento">
        {availableClasses.map(className => (
            <button
                key={className}
                type="button"
                aria-pressed={selectedClass === className}
                onClick={() => onChange(className)}
                className={`rounded-full px-4 py-2 text-xs font-black transition-[background-color,color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${
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
        <span className="min-w-14 border-x border-white/10 px-3 py-2 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
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
                className="absolute text-xs font-black uppercase tracking-[0.18em] text-sky-200/80"
                style={{ left: phase.x, top: 26, width: layout.cardWidth }}
            >
                {phase.label}
            </div>
        ))}
    </>
);

const ConnectorLayer: React.FC<{
    connectors: LayoutConnector[];
    advancingNumbers: Set<number>;
}> = ({ connectors, advancingNumbers }) => (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {connectors.map(connector => {
            const drawing = advancingNumbers.has(connector.fromMatchNumber);
            const d = buildConnectorPath(connector);
            // Folgado de propósito: o traçado real varia com a curva, e um
            // comprimento maior que o real só faz a linha começar invisível.
            const length = Math.abs(connector.endX - connector.startX) + Math.abs(connector.endY - connector.startY) + 120;

            return (
                <g key={connector.id}>
                    <path
                        d={d}
                        fill="none"
                        // Hierarquia por peso, não por opacidade: a linha
                        // inativa é fina e sólida em vez de grossa e
                        // translúcida — some do caminho do olho sem sumir.
                        stroke={connector.active ? '#ea580c' : '#2f5479'}
                        strokeWidth={connector.active ? 4 : 3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={drawing ? 'bracket-line-draw' : undefined}
                        style={drawing ? ({ strokeDasharray: length, ['--bracket-line-length' as string]: `${length}` } as React.CSSProperties) : undefined}
                    />
                    {/* Um ponto só, na chegada, e só quando alguém de fato
                        avançou. Os dois pontos brancos de antes eram o mais
                        claro do vão e disputavam atenção com os cartões. */}
                    {connector.active && (
                        <circle cx={connector.endX} cy={connector.endY} r={3.5} fill="#ea580c" />
                    )}
                </g>
            );
        })}
    </svg>
);

/** Cor e rótulo da faixa superior, que é onde o estado do jogo passa a morar. */
const HEADER_BY_STATE: Record<MatchState, { bar: string; label: string; meta: string }> = {
    finished: { bar: 'bg-saibro-600', label: 'text-white', meta: 'text-white/80' },
    live: { bar: 'bg-saibro-800', label: 'text-orange-100', meta: 'text-orange-200' },
    pending: { bar: 'bg-slate-300', label: 'text-slate-700', meta: 'text-slate-600' },
};

const BracketMatchCard: React.FC<{
    layoutMatch: LayoutMatch;
    phaseLabel: string;
    selected: boolean;
    onSelect: () => void;
    showOfficialTimes: boolean;
    advancing: boolean;
    landingSlot: 'a' | 'b' | null;
    enterDelayMs: number;
}> = ({ layoutMatch, phaseLabel, selected, onSelect, showOfficialTimes, advancing, landingSlot, enterDelayMs }) => {
    const { match, x, y } = layoutMatch;
    const state = getMatchState(match);
    const winnerSide = getMatchWinnerSide(match);
    const slots = playedScoreSlots(match.score_a, match.score_b);
    const accessibleName = `Jogo ${match.match_number}, ${match.player_a_label} contra ${match.player_b_label}`;
    const chrome = HEADER_BY_STATE[state];
    const matchDay = formatMatchDay(match.scheduled_date);

    const officialTime = showOfficialTimes
        ? getOfficialMatchTime(match.bracket_class ?? '', match.match_number)
        : null;
    const realTime = match.scheduled_time ?? null;
    const displayTime = realTime ? formatMatchTime(realTime) : (officialTime ? formatMatchTime(officialTime) : null);

    return (
        <button
            type="button"
            data-match-id={match.id}
            aria-label={accessibleName}
            aria-pressed={selected}
            onClick={onSelect}
            className={`bracket-card-in absolute overflow-visible rounded-2xl text-left outline-none transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:ring-4 focus-visible:ring-orange-300/70 ${
                selected ? 'scale-[1.03] ring-4 ring-orange-300/60' : ''
            }`}
            style={{ left: x, top: y, width: 280, height: 88, animationDelay: `${enterDelayMs}ms` }}
        >
            {/* O pulso mora na casca interna, e não no botão: os dois animam a
                mesma propriedade, e no mesmo elemento um apagaria o outro. */}
            <div
                className={`h-full overflow-hidden rounded-2xl border bg-slate-50 text-slate-900 ${landingSlot ? 'bracket-slot-pulse' : ''} ${
                    state === 'live'
                        ? 'border-orange-300/60 shadow-xl shadow-black/25 ring-4 ring-saibro-600/15'
                        : state === 'pending'
                            ? 'border-white/35 bg-slate-100 shadow-lg shadow-black/20'
                            : 'border-white/70 shadow-xl shadow-black/25'
                }`}
            >
                {/* Faixa de estado: o número do jogo e o horário deixam de ser
                    selos pendurados fora da caixa, que colidiam entre si. */}
                {/* 20 px de faixa em vez de 16: a 9 px o jogo, a data e o
                    horário viravam um friso ilegível a 85% de zoom. */}
                <div className={`flex h-5 items-center justify-between px-2.5 ${chrome.bar}`}>
                    {/* Quando o jogo tem data, ela ocupa este lugar no lugar do
                        nome da fase — que já está escrito como título da coluna,
                        logo acima. A data é o que ninguém sabe de cor. */}
                    <span className={`truncate text-[11px] font-black uppercase tracking-[0.1em] ${chrome.label}`}>
                        J{match.match_number} · {matchDay ?? phaseLabel}
                    </span>
                    <MatchStateTag state={state} isWalkover={!!match.is_walkover} time={displayTime} tone={chrome.meta} />
                </div>

                <div className="grid h-[68px] grid-cols-[1fr_84px]">
                    <div className="min-w-0">
                        <PlayerRow
                            label={match.player_a_label}
                            pending={!match.registration_a_id}
                            won={winnerSide === 'a'}
                            lost={winnerSide === 'b'}
                            divider
                            railAnimated={advancing && winnerSide === 'a'}
                            landing={landingSlot === 'a'}
                        />
                        <PlayerRow
                            label={match.player_b_label}
                            pending={!match.registration_b_id}
                            won={winnerSide === 'b'}
                            lost={winnerSide === 'a'}
                            railAnimated={advancing && winnerSide === 'b'}
                            landing={landingSlot === 'b'}
                        />
                    </div>
                    <ScorePanel slots={slots} state={state} match={match} advancing={advancing} />
                </div>
            </div>
        </button>
    );
};

const MatchStateTag: React.FC<{
    state: MatchState;
    isWalkover: boolean;
    time: string | null;
    tone: string;
}> = ({ state, isWalkover, time, tone }) => {
    if (isWalkover) {
        return <span className={`text-[11px] font-black uppercase tracking-[0.1em] ${tone}`}>W.O.</span>;
    }
    if (state === 'live') {
        return (
            <span className={`bracket-breathe inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.1em] ${tone}`}>
                <span className="h-2 w-2 rounded-full bg-orange-300" />
                Ao vivo
            </span>
        );
    }
    if (time) {
        // Sem `uppercase`: "19h30" é a grafia da hora em português, e "19H30"
        // parece defeito.
        return <span className={`text-[11px] font-black tabular-nums tracking-[0.02em] ${tone}`}>{time}</span>;
    }
    return <span className={`text-[11px] font-black uppercase tracking-[0.1em] ${tone}`}>{state === 'finished' ? 'Encerrado' : 'A definir'}</span>;
};

const PlayerRow: React.FC<{
    label: string;
    pending: boolean;
    won: boolean;
    lost: boolean;
    divider?: boolean;
    railAnimated: boolean;
    landing: boolean;
}> = ({ label, pending, won, lost, divider, railAnimated, landing }) => (
    <div className={`flex h-[34px] min-w-0 items-center gap-2 ${divider ? 'border-b border-slate-200' : ''} ${lost ? 'bracket-loser-fade' : ''}`}>
        {/* O trilho substitui o "V" e o troféu, que diziam a mesma coisa duas vezes. */}
        <span
            aria-hidden="true"
            className={`h-[34px] w-[3px] shrink-0 ${won ? 'bg-saibro-600' : 'bg-transparent'} ${railAnimated ? 'bracket-rail-grow' : ''}`}
        />
        <span
            className={`truncate pr-2 text-[13px] ${landing ? 'bracket-land-in' : ''} ${
                pending
                    ? 'font-semibold italic text-slate-400'
                    : lost
                        ? 'font-semibold text-slate-500'
                        : 'font-black text-slate-950'
            }`}
        >
            {label}
        </span>
    </div>
);

const ScorePanel: React.FC<{
    slots: ReturnType<typeof playedScoreSlots>;
    state: MatchState;
    match: BracketMatchWithPhase;
    advancing: boolean;
}> = ({ slots, state, match, advancing }) => {
    if (slots.length === 0) {
        // Antes eram seis traços, que faziam todo jogo por disputar parecer ter
        // dados. Um relógio diz a mesma coisa sem fingir placar.
        return (
            <div
                data-testid="aguardando"
                className="grid place-items-center border-l border-slate-200 bg-slate-200/60 text-slate-400"
            >
                <Clock size={17} strokeWidth={2} aria-hidden="true" />
            </div>
        );
    }

    const live = state === 'live';

    return (
        <div
            className={`grid border-l ${live ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-slate-100'}`}
            style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))`, gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }}
        >
            {slots.map(slot => (
                <ScoreCell
                    key={`a-${slot.index}`}
                    value={slot.a}
                    won={slot.a !== null && slot.b !== null && slot.a > slot.b}
                    live={live}
                    borderBottom
                    turning={advancing}
                    ariaLabel={`Placar set ${slot.index + 1}: ${match.player_a_label} ${slot.a}, ${match.player_b_label} ${slot.b}`}
                />
            ))}
            {slots.map(slot => (
                <ScoreCell
                    key={`b-${slot.index}`}
                    value={slot.b}
                    won={slot.a !== null && slot.b !== null && slot.b > slot.a}
                    live={live}
                    turning={advancing}
                    ariaLabel=""
                    hiddenLabel
                />
            ))}
        </div>
    );
};

const ScoreCell: React.FC<{
    value: number | null;
    won: boolean;
    live: boolean;
    borderBottom?: boolean;
    turning: boolean;
    ariaLabel: string;
    hiddenLabel?: boolean;
}> = ({ value, won, live, borderBottom, turning, ariaLabel, hiddenLabel }) => (
    <span
        aria-hidden={hiddenLabel ? 'true' : undefined}
        aria-label={hiddenLabel ? undefined : ariaLabel}
        className={`grid place-items-center border-l tabular-nums text-[15px] first:border-l-0 ${
            live ? 'border-orange-200' : 'border-slate-200'
        } ${borderBottom ? 'border-b' : ''} ${
            won ? 'font-black text-saibro-600' : 'font-bold text-slate-400'
        } ${turning && won ? 'bracket-cell-turn' : ''}`}
    >
        {value ?? '-'}
    </span>
);
