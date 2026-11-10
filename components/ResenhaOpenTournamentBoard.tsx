import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Clock, Loader2, LocateFixed, Minus, Plus, RotateCcw, Share2 } from 'lucide-react';
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
import { temaDaClasse } from '../lib/bracketTheme';
import { PHASE_FOCUS_FRACTION, findMyMatches, phaseAtScroll, sideOfUser } from '../lib/bracketNavigation';

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
    /** Quem está vendo. Com ele, o quadro acha e destaca os jogos da pessoa. */
    currentUserId?: string;
}

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.2;
const ZOOM_STEP = 0.1;

/** Curva de mola usada em todo movimento do quadro. */
const SPRING = 'cubic-bezier(0.32,0.72,0,1)';

/** Quanto tempo o quadro fica contando a história de um avanço. */
const ADVANCE_MS = 1400;

export const ResenhaOpenTournamentBoard: React.FC<Props> = ({ bracket, championshipName, onMatchSelect, isResenhaOpen = false, exportClass, currentUserId }) => {
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
            left: Math.max(0, phaseLayout.x * zoom - viewportRef.current.clientWidth * PHASE_FOCUS_FRACTION),
            top: 0,
            behavior,
        });
    }, [layout, zoom]);

    useEffect(() => {
        if (exporting) return;
        requestAnimationFrame(() => centerPhase(currentPhase, 'auto'));
    }, [currentPhase, centerPhase, exporting]);

    // ── Fase em foco ─────────────────────────────────────────────────────────
    // O chip acompanha o arrasto: quem rola o quadro de lado sabe sempre em
    // que fase está, sem ler o título da coluna, que some ao rolar para baixo.
    const [focusedPhase, setFocusedPhase] = useState<string | null>(null);
    const scrollFrame = useRef<number | null>(null);

    const syncFocusedPhase = useCallback(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        setFocusedPhase(phaseAtScroll(layout.phases, { scrollLeft: viewport.scrollLeft, zoom, viewportWidth: viewport.clientWidth }));
    }, [layout, zoom]);

    useEffect(() => {
        syncFocusedPhase();
    }, [syncFocusedPhase]);

    useEffect(() => () => {
        if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    }, []);

    const handleViewportScroll = () => {
        if (scrollFrame.current != null) return;
        scrollFrame.current = requestAnimationFrame(() => {
            scrollFrame.current = null;
            syncFocusedPhase();
        });
    };

    // ── Meu jogo ─────────────────────────────────────────────────────────────
    // O atleta abre a chave para achar o próprio jogo. Em vez de ler o quadro
    // inteiro, um toque leva ao próximo; tocar de novo passa ao seguinte, para
    // quem joga mais de uma classe.
    const myMatches = useMemo(
        () => findMyMatches(bracket, currentUserId, availableClasses),
        [bracket, currentUserId, availableClasses],
    );
    const myMatchCursor = useRef(0);
    const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

    // Roda depois da centralização automática da troca de classe (efeito
    // acima), para o jogo não ser empurrado para fora da tela por ela.
    useEffect(() => {
        if (!pendingFocusId) return;
        const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(pendingFocusId) : pendingFocusId;
        const node = viewportRef.current?.querySelector<HTMLElement>(`[data-match-id="${escaped}"]`);
        if (!node) return;
        setPendingFocusId(null);
        requestAnimationFrame(() => {
            node.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
        });
    }, [pendingFocusId, classMatches]);

    const goToMyMatch = () => {
        if (myMatches.length === 0) return;
        const target = myMatches[myMatchCursor.current % myMatches.length];
        myMatchCursor.current += 1;
        if (target.bracket_class && target.bracket_class !== selectedClass) {
            setSelectedClass(target.bracket_class);
        }
        setSelectedMatchId(target.id);
        setPendingFocusId(target.id);
    };

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
        <div className={`chave-${temaDaClasse(selectedClass)} ${exporting
            // Na cópia de exportação o quadro não sangra nem se limita: ele tem
            // o tamanho que tiver, que é o ponto de exportar.
            ? 'w-max p-6 bg-(--chave-fundo)'
            : 'w-auto -mx-4 px-0 py-3 sm:w-full sm:max-w-7xl sm:mx-auto sm:px-[max(0.75rem,env(safe-area-inset-left))]'}`}>
            <section className="relative rounded-none border-x-0 sm:rounded-3xl sm:border-x bg-(--chave-fundo) text-(--chave-texto) shadow-2xl shadow-slate-950/30 overflow-hidden border border-(--chave-borda)">
                {exporting ? (
                    // Na imagem não há página em volta: o título é o único
                    // lugar que diz de que campeonato e classe ela é.
                    <div className="px-6 pt-5 pb-4">
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-(--chave-apoio)">Tabela de Confrontos</p>
                        <h2 className="text-2xl font-extrabold tracking-tight">{championshipName}</h2>
                        <p className="mt-1 text-sm font-bold text-(--chave-texto-2)">{selectedClass}</p>
                    </div>
                ) : (
                    // Na tela, o nome do campeonato já está no topo da página:
                    // repeti-lo aqui empurrava o primeiro jogo para fora da dobra.
                    <div className="flex flex-col gap-3 px-3 pt-4 pb-3 sm:px-6">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex items-center gap-2">
                                <BracketClassSwitch
                                    availableClasses={availableClasses}
                                    selectedClass={selectedClass}
                                    onChange={handleClassChange}
                                />
                                <ExportButton
                                    busy={exportando}
                                    classCount={availableClasses.length}
                                    onExport={handleExport}
                                />
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <ZoomControls
                                    zoom={zoom}
                                    onZoomIn={() => updateZoom(ZOOM_STEP)}
                                    onZoomOut={() => updateZoom(-ZOOM_STEP)}
                                    onReset={() => {
                                        setZoom(0.85);
                                        requestAnimationFrame(() => centerPhase(currentPhase));
                                    }}
                                />
                                {myMatches.length > 0 && (
                                    <MyMatchButton count={myMatches.length} onClick={goToMyMatch} />
                                )}
                            </div>
                        </div>
                        <PhaseStrip
                            phases={layout.phases}
                            focusedPhase={focusedPhase}
                            currentPhase={currentPhase}
                            onPick={phase => centerPhase(phase)}
                        />
                    </div>
                )}

                <div
                    ref={viewportRef}
                    data-bracket-viewport
                    onScroll={exporting ? undefined : handleViewportScroll}
                    className={exporting
                        ? 'relative px-6 pb-6'
                        : 'relative overflow-auto overscroll-contain px-2 sm:px-6 pb-[max(2.75rem,env(safe-area-inset-bottom))] cursor-grab active:cursor-grabbing'}
                    style={exporting ? undefined : { WebkitOverflowScrolling: 'touch' }}
                >
                    <div
                        className="relative rounded-3xl border border-(--chave-borda) bg-(--chave-fundo)"
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
                                        mySide={sideOfUser(layoutMatch.match, currentUserId)}
                                        enterDelayMs={Math.min(index * 45, 360)}
                                        width={layout.cardWidth}
                                        height={layout.cardHeight}
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
                <div className="pointer-events-none absolute left-3 sm:left-8 bottom-3 inline-flex whitespace-nowrap rounded-full border border-(--chave-borda) bg-(--chave-superficie) px-3 py-2 text-xs font-bold text-(--chave-texto-2)">
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

/**
 * Exportar é ação de vez em quando, não da tela: no celular vira só o ícone,
 * em contorno, para não disputar com a troca de classe nem com "Meu jogo".
 */
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
        className="inline-flex size-13 shrink-0 items-center justify-center gap-2 rounded-full border border-(--chave-borda) text-sm font-bold text-(--chave-texto-2) transition-[transform,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-(--chave-foco) active:scale-[0.97] disabled:opacity-60 sm:w-auto sm:px-5"
    >
        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Share2 size={18} aria-hidden="true" />}
        {/* A contagem aparece antes do clique de propósito: se o quadro só
            enxergar uma classe, isso fica visível aqui e não depois. */}
        <span className="hidden sm:inline">
            {busy ? 'Gerando…' : classCount > 1 ? `Exportar ${classCount} imagens` : 'Exportar imagem'}
        </span>
    </button>
);

const BracketClassSwitch: React.FC<{
    availableClasses: string[];
    selectedClass: string;
    onChange: (className: string) => void;
}> = ({ availableClasses, selectedClass, onChange }) => (
    // Selecionado em destaque neutro, não em laranja: o laranja fica para o
    // que é da pessoa (Meu jogo) e para o caminho de quem já venceu.
    <div className="flex min-w-0 flex-1 rounded-full border border-(--chave-borda) bg-(--chave-superficie) p-1 lg:flex-none" aria-label="Selecionar classe do chaveamento">
        {availableClasses.map(className => (
            <button
                key={className}
                type="button"
                aria-pressed={selectedClass === className}
                onClick={() => onChange(className)}
                className={`h-11 min-w-0 flex-1 truncate rounded-full px-4 text-sm font-bold transition-[background-color,color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] lg:flex-none ${
                    selectedClass === className
                        ? 'bg-(--chave-ativo) text-(--chave-ativo-texto) shadow-sm'
                        : 'text-(--chave-texto-2) hover:text-(--chave-texto)'
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
    <div className="inline-flex items-center overflow-hidden rounded-full border border-(--chave-borda) bg-(--chave-superficie) text-sm font-bold text-(--chave-texto-2)">
        <button type="button" aria-label="Reduzir zoom" onClick={onZoomOut} className="grid size-11 shrink-0 place-items-center hover:bg-(--chave-foco)">
            <Minus size={16} aria-hidden="true" />
        </button>
        <span className="min-w-14 border-x border-(--chave-borda) px-2 text-center tabular-nums text-(--chave-texto)" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Aumentar zoom" onClick={onZoomIn} className="grid size-11 shrink-0 place-items-center hover:bg-(--chave-foco)">
            <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Resetar zoom" onClick={onReset} className="grid size-11 shrink-0 place-items-center border-l border-(--chave-borda) hover:bg-(--chave-foco)">
            <RotateCcw size={16} aria-hidden="true" />
        </button>
    </div>
);

/** A ação do atleta na chave: ir direto ao próprio jogo. */
const MyMatchButton: React.FC<{ count: number; onClick: () => void }> = ({ count, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={count > 1 ? `Ir para os meus jogos, ${count} pela frente` : 'Ir para o meu jogo'}
        className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-saibro-700 px-4 text-sm font-bold text-white shadow-md transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:brightness-110 active:scale-[0.97]"
    >
        <LocateFixed size={16} aria-hidden="true" />
        {count > 1 ? `Meus jogos (${count})` : 'Meu jogo'}
    </button>
);

/**
 * As fases como atalhos. No celular só uma coluna cabe na tela; sem isto, ir
 * da qualificatória à final era arrastar às cegas. O chip em foco segue o
 * arrasto, e o ponto laranja marca a fase que está sendo jogada agora.
 */
const PhaseStrip: React.FC<{
    phases: ReturnType<typeof buildResenhaBracketLayout>['phases'];
    focusedPhase: string | null;
    currentPhase: string;
    onPick: (phase: string) => void;
}> = ({ phases, focusedPhase, currentPhase, onPick }) => {
    const stripRef = useRef<HTMLDivElement>(null);

    // Mantém o chip em foco à vista, rolando só a faixa — scrollIntoView
    // rolaria a página inteira junto.
    useEffect(() => {
        const strip = stripRef.current;
        const chip = strip?.querySelector<HTMLElement>('[aria-current="true"]');
        if (!strip || !chip) return;
        const fora = chip.offsetLeft < strip.scrollLeft || chip.offsetLeft + chip.offsetWidth > strip.scrollLeft + strip.clientWidth;
        if (fora) strip.scrollTo?.({ left: chip.offsetLeft - 12, behavior: 'smooth' });
    }, [focusedPhase]);

    if (phases.length < 2) return null;

    return (
        <nav aria-label="Fases da chave">
            <div ref={stripRef} className="-mx-3 flex gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-none px-3 [scrollbar-width:none] sm:mx-0 sm:px-0">
                {phases.map(phase => {
                    const focused = phase.phase === focusedPhase;
                    const playing = phase.phase === currentPhase;
                    return (
                        <button
                            key={phase.phase}
                            type="button"
                            aria-current={focused ? 'true' : undefined}
                            onClick={() => onPick(phase.phase)}
                            className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm transition-[background-color,color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                                focused ? 'bg-(--chave-foco) font-bold text-(--chave-texto)' : 'font-semibold text-(--chave-texto-2) hover:text-(--chave-texto)'
                            }`}
                        >
                            {playing && <span className="size-2 rounded-full bg-(--chave-conector-vivo)" aria-hidden="true" />}
                            {phase.label}
                            <span className="tabular-nums text-(--chave-apoio)" aria-hidden="true">{phase.matches.length}</span>
                            <span className="sr-only">, {phase.matches.length} {phase.matches.length === 1 ? 'jogo' : 'jogos'}</span>
                            {playing && <span className="sr-only">, em andamento</span>}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};

const PhaseHeaders: React.FC<{ layout: ReturnType<typeof buildResenhaBracketLayout> }> = ({ layout }) => (
    <>
        {layout.phases.map(phase => (
            <div
                key={phase.phase}
                className="absolute text-xs font-bold uppercase tracking-[0.08em] text-(--chave-apoio)"
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
            // A cor vem do tema por `style`: atributo de apresentação do SVG
            // não resolve `var()` em todo navegador.
            const stroke = connector.active ? 'var(--chave-conector-vivo)' : 'var(--chave-conector)';

            return (
                <g key={connector.id}>
                    <path
                        d={d}
                        fill="none"
                        // Hierarquia por peso, não por opacidade: a linha
                        // inativa é fina e sólida em vez de grossa e
                        // translúcida — some do caminho do olho sem sumir.
                        strokeWidth={connector.active ? 3 : 2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={drawing ? 'bracket-line-draw' : undefined}
                        style={drawing
                            ? ({ stroke, strokeDasharray: length, ['--bracket-line-length' as string]: `${length}` } as React.CSSProperties)
                            : { stroke }}
                    />
                    {/* Um ponto só, na chegada, e só quando alguém de fato
                        avançou. */}
                    {connector.active && (
                        <circle cx={connector.endX} cy={connector.endY} r={3.5} style={{ fill: 'var(--chave-conector-vivo)' }} />
                    )}
                </g>
            );
        })}
    </svg>
);

/**
 * Card de jogo (sistema da chave): topo de 32 px com o jogo e o estado, duas
 * linhas de 44 px por jogador. O topo é neutro; o estado fala pelo selo.
 */
const BracketMatchCard: React.FC<{
    layoutMatch: LayoutMatch;
    phaseLabel: string;
    selected: boolean;
    onSelect: () => void;
    showOfficialTimes: boolean;
    advancing: boolean;
    landingSlot: 'a' | 'b' | null;
    mySide: 'a' | 'b' | null;
    enterDelayMs: number;
    width: number;
    height: number;
}> = ({ width, height, layoutMatch, phaseLabel, selected, onSelect, showOfficialTimes, advancing, landingSlot, mySide, enterDelayMs }) => {
    const { match, x, y } = layoutMatch;
    const state = getMatchState(match);
    const winnerSide = getMatchWinnerSide(match);
    const slots = playedScoreSlots(match.score_a, match.score_b);
    const accessibleName = `Jogo ${match.match_number}, ${match.player_a_label} contra ${match.player_b_label}`;
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
            className={`bracket-card-in absolute overflow-visible rounded-2xl text-left outline-none transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:ring-4 focus-visible:ring-saibro-300 ${
                selected ? 'scale-[1.03] ring-4 ring-saibro-300' : mySide ? 'ring-2 ring-saibro-500' : ''
            }`}
            style={{ left: x, top: y, width, height, animationDelay: `${enterDelayMs}ms` }}
        >
            {/* O pulso mora na casca interna, e não no botão: os dois animam a
                mesma propriedade, e no mesmo elemento um apagaria o outro. */}
            <div
                className={`h-full overflow-hidden rounded-2xl border border-(--chave-card-borda) bg-white text-stone-900 shadow-lg shadow-black/20 ${landingSlot ? 'bracket-slot-pulse' : ''}`}
            >
                <div className="flex h-8 items-center justify-between gap-2 border-b border-stone-100 bg-(--chave-card-topo) px-3">
                    {/* Quando o jogo tem data, ela ocupa o lugar do nome da
                        fase — que já é o título da coluna. A data é o que
                        ninguém sabe de cor. */}
                    <span className="truncate text-xs font-bold uppercase tracking-[0.06em] text-(--chave-card-topo-texto)">
                        J{match.match_number} · {matchDay ?? phaseLabel}
                    </span>
                    <MatchStateTag state={state} isWalkover={!!match.is_walkover} time={displayTime} />
                </div>

                <div className="grid grid-cols-[1fr_84px]">
                    <div className="min-w-0">
                        <PlayerRow
                            label={match.player_a_label}
                            pending={!match.registration_a_id}
                            won={winnerSide === 'a'}
                            lost={winnerSide === 'b'}
                            divider
                            winAnimated={advancing && winnerSide === 'a'}
                            landing={landingSlot === 'a'}
                            mine={mySide === 'a'}
                        />
                        <PlayerRow
                            label={match.player_b_label}
                            pending={!match.registration_b_id}
                            won={winnerSide === 'b'}
                            lost={winnerSide === 'a'}
                            winAnimated={advancing && winnerSide === 'b'}
                            landing={landingSlot === 'b'}
                            mine={mySide === 'b'}
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
}> = ({ state, isWalkover, time }) => {
    if (isWalkover) {
        return <span className="shrink-0 text-xs font-bold uppercase tracking-[0.06em] text-stone-600">W.O.</span>;
    }
    if (state === 'live') {
        return (
            <span className="bracket-breathe inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-saibro-50 px-2 text-xs font-bold text-saibro-800 ring-1 ring-saibro-200">
                <span className="size-1.5 rounded-full bg-saibro-600" aria-hidden="true" />
                Ao vivo
            </span>
        );
    }
    if (time) {
        // Sem `uppercase`: "19h30" é a grafia da hora em português, e "19H30"
        // parece defeito.
        return <span className="shrink-0 text-xs font-bold tabular-nums text-stone-600">{time}</span>;
    }
    return <span className="shrink-0 text-xs font-semibold text-(--chave-card-topo-texto)">{state === 'finished' ? 'Encerrado' : 'A definir'}</span>;
};

const PlayerRow: React.FC<{
    label: string;
    pending: boolean;
    won: boolean;
    lost: boolean;
    divider?: boolean;
    winAnimated: boolean;
    landing: boolean;
    mine?: boolean;
}> = ({ label, pending, won, lost, divider, winAnimated, landing, mine }) => (
    <div className={`flex h-11 min-w-0 items-center gap-1 pl-2 ${divider ? 'border-b border-stone-100' : ''} ${lost ? 'bracket-loser-fade' : ''}`}>
        {/* O check do vencedor: verde de quadra, e o nome não muda de cor. */}
        <span className="grid size-5 shrink-0 place-items-center" aria-hidden={!won}>
            {won && (
                <Check
                    size={14}
                    strokeWidth={3}
                    className={`text-court-green ${winAnimated ? 'bracket-land-in' : ''}`}
                    role="img"
                    aria-label="Vencedor"
                />
            )}
        </span>
        <span
            className={`truncate pr-2 text-sm ${landing ? 'bracket-land-in' : ''} ${
                pending
                    ? 'font-medium italic text-stone-500'
                    : lost
                        ? 'font-medium text-stone-500'
                        : mine
                            ? 'font-bold text-saibro-800'
                            : won
                                ? 'font-bold text-stone-900'
                                : 'font-semibold text-stone-900'
            }`}
        >
            {label}
        </span>
        {mine && (
            <span className="mr-2 ml-auto inline-flex h-6 shrink-0 items-center rounded-full bg-saibro-100 px-2 text-xs font-bold text-saibro-800">
                Você
            </span>
        )}
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
                className="grid place-items-center border-l border-stone-100 bg-stone-50 text-stone-500"
            >
                <Clock size={16} strokeWidth={2} aria-hidden="true" />
            </div>
        );
    }

    const live = state === 'live';

    return (
        <div
            className={`grid border-l ${live ? 'border-saibro-200 bg-saibro-50' : 'border-stone-100 bg-stone-50'}`}
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
        className={`grid place-items-center border-l tabular-nums text-sm first:border-l-0 ${
            live ? 'border-saibro-200' : 'border-stone-100'
        } ${borderBottom ? 'border-b' : ''} ${
            won ? (live ? 'font-extrabold text-saibro-800' : 'font-extrabold text-stone-900') : 'font-semibold text-stone-500'
        } ${turning && won ? 'bracket-cell-turn' : ''}`}
    >
        {value ?? '-'}
    </span>
);
