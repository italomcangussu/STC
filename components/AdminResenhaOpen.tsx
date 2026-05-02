import React, { useState, useEffect, useRef } from 'react';
import {
    Shuffle, Trophy, UserPlus, Loader2, Check, ChevronRight,
    Trash2, User, MapPin, Hash, Star, X, Play, Save, RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
    drawClasse5, buildClasse5Bracket,
    drawClasse4Qualify, drawClasse4PrimeiraFase,
    drawClasse4CabecasDeChave, buildClasse4Bracket,
    type DrawAthlete, type DrawMatch,
} from '../lib/resenhaOpenDraw';
import {
    createResenhaOpenChampionship, createResenhaOpenRounds,
    registerSocio, registerGuest, removeRegistration,
    fetchRegistrations, fetchRegistrationUserMap,
    saveBracket, fetchBracket, activateChampionship,
    recordMatchResult, recordWalkover, resolveAndFinish,
    type ResenhaClass,
} from '../lib/resenhaOpenService';
import type { BracketMatchWithPhase } from '../lib/resenhaOpenService';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminStep = 'setup' | 'registering' | 'drawing' | 'bracket';
type DrawSubStep4 = 'qualify' | 'primeira-fase' | 'cabecas-de-chave' | 'done';

interface Profile { id: string; name: string; category: string | null; }

interface ChampionshipRow { id: string; name: string; status: string; }

// ── Draw animation hook ───────────────────────────────────────────────────────

function useDrawAnimation(
    eligible: DrawAthlete[],
    count: number,
    durationMs = 1800
): { animating: boolean; display: DrawAthlete[]; trigger: (rngResult: DrawAthlete[]) => void } {
    const [animating, setAnimating] = useState(false);
    const [display, setDisplay] = useState<DrawAthlete[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const finalRef = useRef<DrawAthlete[]>([]);

    const trigger = (rngResult: DrawAthlete[]) => {
        finalRef.current = rngResult;
        setAnimating(true);
        let ticks = 0;
        const totalTicks = Math.floor(durationMs / 60);

        timerRef.current = setInterval(() => {
            ticks++;
            // Random-looking shuffle of the eligible list for display
            const shuffled = [...eligible].sort(() => Math.random() - 0.5).slice(0, count);
            setDisplay(shuffled);

            if (ticks >= totalTicks) {
                clearInterval(timerRef.current!);
                setDisplay(finalRef.current);
                setAnimating(false);
            }
        }, 60);
    };

    useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

    return { animating, display, trigger };
}

// ── Component ─────────────────────────────────────────────────────────────────

export const AdminResenhaOpen: React.FC = () => {
    const [classe, setClasse] = useState<ResenhaClass>('4ª Classe');
    const [step, setStep] = useState<AdminStep>('setup');

    // Championship
    const [championships, setChampionships] = useState<ChampionshipRow[]>([]);
    const [selectedChampId, setSelectedChampId] = useState<string>('');
    const [newChampName, setNewChampName] = useState('Resenha Open 2026');
    const [newChampStart, setNewChampStart] = useState('2026-05-20');
    const [newChampEnd, setNewChampEnd] = useState('2026-05-23');
    const [phaseToRoundId, setPhaseToRoundId] = useState<Map<string, string>>(new Map());
    const [saving, setSaving] = useState(false);

    // Athlete registration
    const [athletes, setAthletes] = useState<DrawAthlete[]>([]);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [profileSearch, setProfileSearch] = useState('');
    const [isCabeca, setIsCabeca] = useState(false);
    const [isGuestCabeca, setIsGuestCabeca] = useState(false);
    const [guestName, setGuestName] = useState('');
    const [guestCidade, setGuestCidade] = useState('');
    const [guestIdade, setGuestIdade] = useState('');

    // Draw results
    const [drawMatches, setDrawMatches] = useState<DrawMatch[]>([]);
    const [drawSubStep, setDrawSubStep] = useState<DrawSubStep4>('qualify');
    const [qualifyMatches, setQualifyMatches] = useState<DrawMatch[]>([]);
    const [primeiraFaseMatches, setPrimeiraFaseMatches] = useState<DrawMatch[]>([]);
    const [quartasSeeds, setQuartasSeeds] = useState<{ quartas1: DrawAthlete; quartas2: DrawAthlete; quartas3: DrawAthlete } | null>(null);

    // Bracket
    const [bracket, setBracket] = useState<BracketMatchWithPhase[]>([]);
    const [loadingBracket, setLoadingBracket] = useState(false);

    // ── Load championships ────────────────────────────────────────────────────

    useEffect(() => {
        loadChampionships();
        loadProfiles();
    }, []);

    async function loadChampionships() {
        const { data } = await supabase
            .from('championships')
            .select('id, name, status')
            .in('status', ['active', 'finished'])
            .order('created_at', { ascending: false });
        setChampionships((data ?? []) as ChampionshipRow[]);
    }

    async function loadProfiles() {
        const { data } = await supabase
            .from('profiles')
            .select('id, name, category')
            .in('role', ['socio', 'admin'])
            .order('name');
        setProfiles((data ?? []) as Profile[]);
    }

    async function loadAthletesFromDb() {
        if (!selectedChampId) return;
        const regs = await fetchRegistrations(selectedChampId, classe);
        setAthletes(regs);
    }

    async function loadBracket() {
        if (!selectedChampId) return;
        setLoadingBracket(true);
        try {
            const b = await fetchBracket(selectedChampId);
            setBracket(b);
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setLoadingBracket(false);
        }
    }

    // ── Championship creation ─────────────────────────────────────────────────

    async function handleCreateChampionship() {
        setSaving(true);
        try {
            const id = await createResenhaOpenChampionship({
                name: newChampName,
                classe,
                startDate: newChampStart,
                endDate: newChampEnd,
            });
            const phasMap = await createResenhaOpenRounds(id, classe, () => ({
                startDate: newChampStart,
                endDate: newChampEnd,
            }));
            setSelectedChampId(id);
            setPhaseToRoundId(phasMap);
            await loadChampionships();
            setStep('registering');
            toast.success('Campeonato criado!');
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleSelectChampionship() {
        if (!selectedChampId) return;
        setSaving(true);
        try {
            await loadAthletesFromDb();
            await loadBracket();
            setStep('bracket');
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    }

    // ── Athlete registration ──────────────────────────────────────────────────

    const filteredProfiles = profiles.filter(p =>
        !athletes.some(a => a.id === p.id) && // not already registered
        p.name.toLowerCase().includes(profileSearch.toLowerCase())
    );

    async function handleAddSocio(profile: Profile) {
        if (!selectedChampId) { toast.error('Nenhum campeonato selecionado.'); return; }
        setSaving(true);
        try {
            const regId = await registerSocio({
                championshipId: selectedChampId,
                userId: profile.id,
                classe,
                cabecaDeChave: isCabeca,
            });
            setAthletes(prev => [...prev, {
                id: regId,
                name: profile.name,
                participant_type: 'socio',
                cabeca_de_chave: isCabeca,
            }]);
            setProfileSearch('');
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleAddGuest() {
        if (!guestName.trim()) return;
        if (!selectedChampId) { toast.error('Nenhum campeonato selecionado.'); return; }
        setSaving(true);
        try {
            const regId = await registerGuest({
                championshipId: selectedChampId,
                guestName: guestName.trim(),
                classe,
                guestCidade: guestCidade.trim() || undefined,
                guestIdade: guestIdade ? parseInt(guestIdade) : undefined,
                cabecaDeChave: isGuestCabeca,
            });
            setAthletes(prev => [...prev, {
                id: regId,
                name: guestName.trim(),
                participant_type: 'guest',
                guest_cidade: guestCidade.trim() || null,
                cabeca_de_chave: isGuestCabeca,
            }]);
            setIsGuestCabeca(false);
            setGuestName(''); setGuestCidade(''); setGuestIdade('');
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleRemoveAthlete(id: string) {
        setSaving(true);
        try {
            await removeRegistration(id);
            setAthletes(prev => prev.filter(a => a.id !== id));
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    }

    // ── Draw ──────────────────────────────────────────────────────────────────

    const expectedCount = classe === '5ª Classe' ? 16 : 19;
    const canDraw = athletes.length === expectedCount;

    function goToDraw() {
        setStep('drawing');
        setDrawSubStep('qualify');
        setDrawMatches([]);
        setQualifyMatches([]);
        setPrimeiraFaseMatches([]);
        setQuartasSeeds(null);
    }

    // ── Draw — 5ª Classe ──────────────────────────────────────────────────────

    const [animating5, setAnimating5] = useState(false);
    const [display5, setDisplay5] = useState<DrawMatch[]>([]);
    const anim5Ref = useRef<ReturnType<typeof setInterval> | null>(null);

    function runDraw5() {
        // Calculate result BEFORE touching animation state — if it throws, nothing gets stuck
        let result: DrawMatch[];
        try {
            result = drawClasse5(athletes);
        } catch (e: any) {
            toast.error(e.message);
            return;
        }
        if (anim5Ref.current) clearInterval(anim5Ref.current);
        setAnimating5(true);
        let ticks = 0;
        anim5Ref.current = setInterval(() => {
            ticks++;
            const shuffled = [...athletes].sort(() => Math.random() - 0.5);
            setDisplay5(Array.from({ length: 8 }, (_, i) => ({
                match_number: i + 1,
                registration_a_id: shuffled[i * 2]?.id ?? null,
                registration_b_id: shuffled[i * 2 + 1]?.id ?? null,
                player_a_label: shuffled[i * 2]?.name ?? '',
                player_b_label: shuffled[i * 2 + 1]?.name ?? '',
            })));
            if (ticks >= 30) {
                clearInterval(anim5Ref.current!);
                setDisplay5(result);
                setDrawMatches(buildClasse5Bracket(result));
                setAnimating5(false);
            }
        }, 60);
    }

    // ── Draw — 4ª Classe ──────────────────────────────────────────────────────

    const [animating4, setAnimating4] = useState(false);
    const [displayQualify, setDisplayQualify] = useState<DrawMatch[]>([]);
    const [displayPrimeira, setDisplayPrimeira] = useState<DrawMatch[]>([]);
    const [displayCabecas, setDisplayCabecas] = useState<{ quartas1: DrawAthlete; quartas2: DrawAthlete; quartas3: DrawAthlete } | null>(null);
    const [remainingPool4, setRemainingPool4] = useState<DrawAthlete[]>([]);
    const anim4Ref = useRef<ReturnType<typeof setInterval> | null>(null);

    function runDrawQualify() {
        let qm: DrawMatch[];
        let remainingPool: DrawAthlete[];
        try {
            ({ qualifyMatches: qm, remainingPool } = drawClasse4Qualify(athletes));
        } catch (e: any) {
            toast.error(e.message);
            return;
        }
        const eligible = athletes.filter(a =>
            !a.cabeca_de_chave &&
            (a.participant_type === 'socio' || (a.guest_cidade?.trim().toLowerCase() === 'sobral'))
        );
        if (anim4Ref.current) clearInterval(anim4Ref.current);
        setAnimating4(true);
        let ticks = 0;
        anim4Ref.current = setInterval(() => {
            ticks++;
            const shuffled = [...eligible].sort(() => Math.random() - 0.5).slice(0, 6);
            setDisplayQualify(Array.from({ length: 3 }, (_, i) => ({
                match_number: i + 1,
                registration_a_id: shuffled[i * 2]?.id ?? null,
                registration_b_id: shuffled[i * 2 + 1]?.id ?? null,
                player_a_label: shuffled[i * 2]?.name ?? '',
                player_b_label: shuffled[i * 2 + 1]?.name ?? '',
            })));
            if (ticks >= 30) {
                clearInterval(anim4Ref.current!);
                setDisplayQualify(qm);
                setQualifyMatches(qm);
                setRemainingPool4(remainingPool);
                setAnimating4(false);
            }
        }, 60);
    }

    function runDrawPrimeiraFase() {
        const pool = remainingPool4;
        let pm: DrawMatch[];
        try {
            pm = drawClasse4PrimeiraFase(pool);
        } catch (e: any) {
            toast.error(e.message);
            return;
        }
        if (anim4Ref.current) clearInterval(anim4Ref.current);
        setAnimating4(true);
        let ticks = 0;
        anim4Ref.current = setInterval(() => {
            ticks++;
            const shuffled = [...pool].sort(() => Math.random() - 0.5);
            setDisplayPrimeira(Array.from({ length: 5 }, (_, i) => ({
                match_number: i + 4,
                registration_a_id: shuffled[i * 2]?.id ?? null,
                registration_b_id: shuffled[i * 2 + 1]?.id ?? null,
                player_a_label: shuffled[i * 2]?.name ?? '',
                player_b_label: shuffled[i * 2 + 1]?.name ?? '',
            })));
            if (ticks >= 30) {
                clearInterval(anim4Ref.current!);
                setDisplayPrimeira(pm.filter(m => m.match_number !== 9));
                setPrimeiraFaseMatches(pm);
                setAnimating4(false);
            }
        }, 60);
    }

    function runDrawCabecas() {
        const ccs = athletes.filter(a => a.cabeca_de_chave);
        let seeds: { quartas1: DrawAthlete; quartas2: DrawAthlete; quartas3: DrawAthlete };
        try {
            seeds = drawClasse4CabecasDeChave(ccs);
        } catch (e: any) {
            toast.error(e.message);
            return;
        }
        if (anim4Ref.current) clearInterval(anim4Ref.current);
        setAnimating4(true);
        let ticks = 0;
        anim4Ref.current = setInterval(() => {
            ticks++;
            const shuffled = [...ccs].sort(() => Math.random() - 0.5);
            setDisplayCabecas({ quartas1: shuffled[0], quartas2: shuffled[1], quartas3: shuffled[2] });
            if (ticks >= 30) {
                clearInterval(anim4Ref.current!);
                setDisplayCabecas(seeds);
                setQuartasSeeds(seeds);
                const full = buildClasse4Bracket(qualifyMatches, primeiraFaseMatches, seeds);
                setDrawMatches(full);
                setAnimating4(false);
            }
        }, 60);
    }

    // ── Save bracket ──────────────────────────────────────────────────────────

    async function handleSaveBracket() {
        setSaving(true);
        try {
            const userMap = await fetchRegistrationUserMap(selectedChampId, classe);
            await saveBracket(selectedChampId, classe, drawMatches, phaseToRoundId, userMap);
            await activateChampionship(selectedChampId);
            await loadBracket();
            setStep('bracket');
            toast.success('Chave salva e campeonato ativado!');
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    }

    // ── Record result ─────────────────────────────────────────────────────────

    async function handleResult(matchId: string, winnerRegId: string, isWalkover = false) {
        setSaving(true);
        try {
            if (isWalkover) {
                await recordWalkover(matchId, winnerRegId);
            } else {
                await recordMatchResult(matchId, winnerRegId);
            }
            await loadBracket();
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleFinish() {
        if (!confirm('Encerrar campeonato e apurar pontos?')) return;
        setSaving(true);
        try {
            await resolveAndFinish(selectedChampId);
            toast.success('Campeonato encerrado e pontos apurados!');
            loadChampionships();
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function athleteName(regId: string | null): string {
        if (!regId) return '?';
        return athletes.find(a => a.id === regId)?.name ?? '?';
    }

    const ccCount = athletes.filter(a => a.cabeca_de_chave).length;
    const bracketPhases = [...new Set(bracket.map(m => m.round_phase))];

    const PHASE_LABELS: Record<string, string> = {
        qualify: 'Qualify', primeira_fase: '1ª Fase', segunda_fase: '2ª Fase',
        quartas: 'Quartas de Final', semifinal: 'Semifinais', final: 'Final',
        oitavas: 'Oitavas de Final',
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="p-4 pb-24 space-y-6 max-w-2xl mx-auto">
            {/* Header */}
            <div className="bg-linear-to-br from-saibro-700 to-saibro-500 p-6 rounded-3xl text-white shadow-lg">
                <div className="flex items-center gap-3">
                    <Shuffle size={28} />
                    <div>
                        <h1 className="text-2xl font-black">Sorteador Resenha Open</h1>
                        <p className="text-saibro-100 text-sm">Painel exclusivo de administração</p>
                    </div>
                </div>
            </div>

            {/* Step 1: Setup */}
            {step === 'setup' && (
                <div className="space-y-4">
                    {/* Class selector */}
                    <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                        <h2 className="font-black text-stone-800">Classe</h2>
                        <div className="flex gap-3">
                            {(['4ª Classe', '5ª Classe'] as ResenhaClass[]).map(c => (
                                <button
                                    key={c}
                                    onClick={() => setClasse(c)}
                                    className={`flex-1 py-3 rounded-xl font-bold transition-colors ${classe === c
                                        ? 'bg-saibro-600 text-white'
                                        : 'border border-stone-200 text-stone-600 hover:bg-stone-50'}`}
                                >
                                    {c}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Select existing */}
                    {championships.length > 0 && (
                        <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                            <h2 className="font-black text-stone-800">Campeonato existente</h2>
                            <select
                                value={selectedChampId}
                                onChange={e => setSelectedChampId(e.target.value)}
                                className="w-full p-3 border border-stone-200 rounded-xl text-stone-800 font-medium"
                            >
                                <option value="">Selecionar...</option>
                                {championships.map(c => (
                                    <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
                                ))}
                            </select>
                            <button
                                disabled={!selectedChampId || saving}
                                onClick={handleSelectChampionship}
                                className="w-full py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
                            >
                                {saving ? <Loader2 className="animate-spin" size={18} /> : <ChevronRight size={18} />}
                                Continuar
                            </button>
                        </div>
                    )}

                    {/* Create new */}
                    <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                        <h2 className="font-black text-stone-800">Criar novo campeonato</h2>
                        <input
                            value={newChampName}
                            onChange={e => setNewChampName(e.target.value)}
                            className="w-full p-3 border border-stone-200 rounded-xl text-stone-800"
                            placeholder="Nome do campeonato"
                        />
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Início</label>
                                <input type="date" value={newChampStart} onChange={e => setNewChampStart(e.target.value)}
                                    className="w-full p-3 border border-stone-200 rounded-xl" />
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Fim</label>
                                <input type="date" value={newChampEnd} onChange={e => setNewChampEnd(e.target.value)}
                                    className="w-full p-3 border border-stone-200 rounded-xl" />
                            </div>
                        </div>
                        <button
                            disabled={!newChampName.trim() || saving}
                            onClick={handleCreateChampionship}
                            className="w-full py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                            {saving ? <Loader2 className="animate-spin" size={18} /> : <Trophy size={18} />}
                            Criar Campeonato
                        </button>
                    </div>
                </div>
            )}

            {/* Step 2: Registration */}
            {step === 'registering' && (
                <div className="space-y-4">
                    {/* Athlete list */}
                    <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="font-black text-stone-800">
                                Atletas inscritos
                                <span className={`ml-2 text-sm font-bold px-2 py-0.5 rounded-full ${athletes.length === expectedCount ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                                    {athletes.length}/{expectedCount}
                                </span>
                            </h2>
                            {classe === '4ª Classe' && (
                                <span className="text-xs font-bold text-saibro-600 bg-saibro-50 px-2 py-1 rounded-full">
                                    {ccCount}/3 CCs
                                </span>
                            )}
                        </div>

                        {athletes.length === 0 ? (
                            <p className="text-stone-400 text-sm text-center py-4">Nenhum atleta inscrito.</p>
                        ) : (
                            <div className="space-y-2">
                                {athletes.map(a => (
                                    <div key={a.id} className="flex items-center gap-3 py-2 border-b border-stone-50 last:border-0">
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${a.cabeca_de_chave ? 'bg-yellow-100 text-yellow-700' : a.participant_type === 'guest' ? 'bg-blue-100 text-blue-600' : 'bg-saibro-100 text-saibro-700'}`}>
                                            {a.cabeca_de_chave ? <Star size={12} /> : a.participant_type === 'guest' ? <MapPin size={12} /> : <User size={12} />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-stone-800 text-sm truncate">{a.name}</p>
                                            <p className="text-xs text-stone-400">
                                                {a.participant_type === 'guest' ? `Convidado${a.guest_cidade ? ` · ${a.guest_cidade}` : ''}` : 'Sócio'}
                                                {a.cabeca_de_chave && ' · CC'}
                                            </p>
                                        </div>
                                        <button onClick={() => handleRemoveAthlete(a.id)} className="text-stone-400 hover:text-red-500 transition-colors">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Add socio */}
                    <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                        <h2 className="font-black text-stone-800 text-sm uppercase tracking-wide">Adicionar Sócio</h2>
                        <div className="flex items-center gap-2">
                            {classe === '4ª Classe' && (
                                <button
                                    onClick={() => setIsCabeca(v => !v)}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors ${isCabeca ? 'bg-yellow-400 text-yellow-900' : 'border border-stone-200 text-stone-500 hover:bg-stone-50'}`}
                                >
                                    <Star size={12} /> CC
                                </button>
                            )}
                            <input
                                value={profileSearch}
                                onChange={e => setProfileSearch(e.target.value)}
                                placeholder="Buscar por nome..."
                                className="flex-1 p-3 border border-stone-200 rounded-xl text-sm"
                            />
                        </div>
                        {profileSearch.length > 1 && (
                            <div className="border border-stone-100 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                                {filteredProfiles.slice(0, 8).map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => handleAddSocio(p)}
                                        disabled={saving}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-saibro-50 transition-colors text-left border-b border-stone-50 last:border-0"
                                    >
                                        <div className="w-7 h-7 rounded-full bg-saibro-100 flex items-center justify-center shrink-0">
                                            <User size={12} className="text-saibro-700" />
                                        </div>
                                        <div>
                                            <p className="font-bold text-stone-800 text-sm">{p.name}</p>
                                            <p className="text-xs text-stone-400">{p.category ?? 'Sem classe'}</p>
                                        </div>
                                    </button>
                                ))}
                                {filteredProfiles.length === 0 && (
                                    <p className="text-center py-3 text-stone-400 text-sm">Nenhum sócio encontrado.</p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Add guest */}
                    <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                        <h2 className="font-black text-stone-800 text-sm uppercase tracking-wide">Adicionar Convidado</h2>
                        <div className="flex items-center gap-2">
                            {classe === '4ª Classe' && (
                                <button
                                    onClick={() => setIsGuestCabeca(v => !v)}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 shrink-0 transition-colors ${isGuestCabeca ? 'bg-yellow-400 text-yellow-900' : 'border border-stone-200 text-stone-500 hover:bg-stone-50'}`}
                                >
                                    <Star size={12} /> CC
                                </button>
                            )}
                            <input
                                value={guestName}
                                onChange={e => setGuestName(e.target.value)}
                                placeholder="Nome completo"
                                className="flex-1 p-3 border border-stone-200 rounded-xl text-sm"
                            />
                        </div>
                        <div className="flex gap-3">
                            <input
                                value={guestCidade}
                                onChange={e => setGuestCidade(e.target.value)}
                                placeholder="Cidade"
                                className="flex-1 p-3 border border-stone-200 rounded-xl text-sm"
                            />
                            <div className="flex flex-col gap-1">
                                <input
                                    value={guestIdade}
                                    onChange={e => setGuestIdade(e.target.value)}
                                    placeholder="Idade"
                                    type="number"
                                    className="w-24 p-3 border border-stone-200 rounded-xl text-sm"
                                />
                                <span className="text-xs text-stone-400 text-center">opcional</span>
                            </div>
                        </div>
                        <button
                            disabled={!guestName.trim() || saving}
                            onClick={handleAddGuest}
                            className="w-full py-3 border-2 border-saibro-500 text-saibro-600 rounded-xl font-bold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-saibro-50 transition-colors"
                        >
                            <UserPlus size={16} /> Adicionar Convidado
                        </button>
                    </div>

                    {/* Proceed to draw */}
                    <button
                        disabled={!canDraw}
                        onClick={goToDraw}
                        className="w-full py-4 bg-saibro-600 text-white rounded-2xl font-black text-lg disabled:opacity-40 flex items-center justify-center gap-3 hover:bg-saibro-700 transition-colors shadow-lg"
                    >
                        <Shuffle size={22} />
                        {canDraw ? 'Ir para Sorteio' : `Faltam ${expectedCount - athletes.length} atleta(s)`}
                    </button>
                </div>
            )}

            {/* Step 3: Draw */}
            {step === 'drawing' && (
                <div className="space-y-4">
                    {/* 5ª Classe — simple draw */}
                    {classe === '5ª Classe' && (
                        <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-4">
                            <h2 className="font-black text-stone-800 text-lg">Sorteio — 5ª Classe</h2>
                            <p className="text-stone-500 text-sm">Clique em Sortear para gerar os 8 confrontos das Oitavas.</p>

                            <button
                                disabled={animating5}
                                onClick={runDraw5}
                                className="w-full py-4 bg-saibro-600 text-white rounded-xl font-black flex items-center justify-center gap-3 hover:bg-saibro-700 disabled:opacity-60 transition-colors"
                            >
                                {animating5 ? <Loader2 className="animate-spin" size={20} /> : <Shuffle size={20} />}
                                {animating5 ? 'Sorteando...' : display5.length ? 'Sortear novamente' : 'Sortear'}
                            </button>

                            {display5.length > 0 && (
                                <div className={`space-y-2 transition-all ${animating5 ? 'opacity-60 blur-sm' : 'opacity-100'}`}>
                                    {display5.map((m, i) => (
                                        <div key={i} className="flex items-center gap-2 bg-stone-50 rounded-xl px-4 py-3">
                                            <span className="text-xs font-bold text-stone-400 w-14">J{m.match_number}</span>
                                            <span className="flex-1 font-bold text-stone-800 text-sm truncate">{m.player_a_label}</span>
                                            <span className="text-xs text-stone-400 font-bold">vs</span>
                                            <span className="flex-1 font-bold text-stone-800 text-sm truncate text-right">{m.player_b_label}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 4ª Classe — 3 step draw */}
                    {classe === '4ª Classe' && (
                        <div className="space-y-4">
                            {/* Step indicator */}
                            <div className="flex gap-2">
                                {(['qualify', 'primeira-fase', 'cabecas-de-chave'] as DrawSubStep4[]).map((s, i) => {
                                    const labels = ['Qualify', '1ª Fase', 'Cabeças'];
                                    const done = drawSubStep === 'done' ||
                                        (drawSubStep === 'cabecas-de-chave' && i < 2) ||
                                        (drawSubStep === 'primeira-fase' && i < 1);
                                    const active = drawSubStep === s;
                                    return (
                                        <div key={s} className={`flex-1 py-2 rounded-xl text-xs font-bold text-center transition-colors ${active ? 'bg-saibro-600 text-white' : done ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-400'}`}>
                                            {done ? <Check size={12} className="inline mr-1" /> : null}{labels[i]}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Qualify */}
                            {(drawSubStep === 'qualify') && (
                                <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-4">
                                    <h2 className="font-black text-stone-800">Etapa 1 — Qualify</h2>
                                    <p className="text-stone-500 text-sm">Sorteio de 6 atletas elegíveis (sócios ou convidados de Sobral, não-CC) para os Jogos 1, 2 e 3.</p>
                                    <button
                                        disabled={animating4}
                                        onClick={runDrawQualify}
                                        className="w-full py-4 bg-saibro-600 text-white rounded-xl font-black flex items-center justify-center gap-3 hover:bg-saibro-700 disabled:opacity-60"
                                    >
                                        {animating4 ? <Loader2 className="animate-spin" size={20} /> : <Shuffle size={20} />}
                                        {animating4 ? 'Sorteando...' : displayQualify.length ? 'Sortear novamente' : 'Sortear Qualify'}
                                    </button>
                                    {displayQualify.length > 0 && (
                                        <>
                                            <div className={`space-y-2 ${animating4 ? 'opacity-60 blur-sm' : ''}`}>
                                                {displayQualify.map(m => (
                                                    <div key={m.match_number} className="flex items-center gap-2 bg-stone-50 rounded-xl px-4 py-3">
                                                        <span className="text-xs font-bold text-stone-400 w-14">J{m.match_number}</span>
                                                        <span className="flex-1 font-bold text-stone-800 text-sm truncate">{m.player_a_label}</span>
                                                        <span className="text-xs text-stone-400 font-bold">vs</span>
                                                        <span className="flex-1 font-bold text-stone-800 text-sm truncate text-right">{m.player_b_label}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            {!animating4 && (
                                                <button
                                                    onClick={() => { setDrawSubStep('primeira-fase'); }}
                                                    className="w-full py-3 bg-green-600 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                                                >
                                                    <ChevronRight size={18} /> Avançar para 1ª Fase
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {/* 1ª Fase */}
                            {drawSubStep === 'primeira-fase' && (
                                <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-4">
                                    <h2 className="font-black text-stone-800">Etapa 2 — 1ª Fase</h2>
                                    <p className="text-stone-500 text-sm">Sorteio dos Jogos 4 a 8. O Jogo 9 (Venc. J1 × Venc. J2) é automático.</p>
                                    <button
                                        disabled={animating4}
                                        onClick={runDrawPrimeiraFase}
                                        className="w-full py-4 bg-saibro-600 text-white rounded-xl font-black flex items-center justify-center gap-3 hover:bg-saibro-700 disabled:opacity-60"
                                    >
                                        {animating4 ? <Loader2 className="animate-spin" size={20} /> : <Shuffle size={20} />}
                                        {animating4 ? 'Sorteando...' : displayPrimeira.length ? 'Sortear novamente' : 'Sortear 1ª Fase'}
                                    </button>
                                    {displayPrimeira.length > 0 && (
                                        <>
                                            <div className={`space-y-2 ${animating4 ? 'opacity-60 blur-sm' : ''}`}>
                                                {displayPrimeira.map(m => (
                                                    <div key={m.match_number} className="flex items-center gap-2 bg-stone-50 rounded-xl px-4 py-3">
                                                        <span className="text-xs font-bold text-stone-400 w-14">J{m.match_number}</span>
                                                        <span className="flex-1 font-bold text-stone-800 text-sm truncate">{m.player_a_label}</span>
                                                        <span className="text-xs text-stone-400 font-bold">vs</span>
                                                        <span className="flex-1 font-bold text-stone-800 text-sm truncate text-right">{m.player_b_label}</span>
                                                    </div>
                                                ))}
                                                <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-4 py-3">
                                                    <span className="text-xs font-bold text-blue-400 w-14">J9</span>
                                                    <span className="flex-1 font-bold text-blue-800 text-sm">Vencedor Jogo 1</span>
                                                    <span className="text-xs text-blue-400 font-bold">vs</span>
                                                    <span className="flex-1 font-bold text-blue-800 text-sm text-right">Vencedor Jogo 2</span>
                                                </div>
                                            </div>
                                            {!animating4 && (
                                                <button
                                                    onClick={() => setDrawSubStep('cabecas-de-chave')}
                                                    className="w-full py-3 bg-green-600 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                                                >
                                                    <ChevronRight size={18} /> Sortear Cabeças de Chave
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Cabeças de chave */}
                            {drawSubStep === 'cabecas-de-chave' && (
                                <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-4">
                                    <h2 className="font-black text-stone-800">Etapa 3 — Cabeças de Chave</h2>
                                    <p className="text-stone-500 text-sm">Os 3 CCs são sorteados para as posições das Quartas 1, 2 e 3.</p>
                                    <button
                                        disabled={animating4}
                                        onClick={runDrawCabecas}
                                        className="w-full py-4 bg-yellow-500 text-white rounded-xl font-black flex items-center justify-center gap-3 hover:bg-yellow-600 disabled:opacity-60"
                                    >
                                        {animating4 ? <Loader2 className="animate-spin" size={20} /> : <Star size={20} />}
                                        {animating4 ? 'Sorteando...' : displayCabecas ? 'Sortear novamente' : 'Sortear Cabeças'}
                                    </button>
                                    {displayCabecas && (
                                        <>
                                            <div className={`space-y-2 ${animating4 ? 'opacity-60 blur-sm' : ''}`}>
                                                {[
                                                    { label: 'Quartas 1 (vs Venc. J11)', cc: displayCabecas.quartas1 },
                                                    { label: 'Quartas 2 (vs Venc. J9)', cc: displayCabecas.quartas2 },
                                                    { label: 'Quartas 3 (vs Venc. J10)', cc: displayCabecas.quartas3 },
                                                ].map(({ label, cc }) => (
                                                    <div key={cc.id} className="flex items-center gap-3 bg-yellow-50 rounded-xl px-4 py-3">
                                                        <Star size={14} className="text-yellow-600 shrink-0" />
                                                        <div>
                                                            <p className="font-black text-stone-800 text-sm">{cc.name}</p>
                                                            <p className="text-xs text-stone-400">{label}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Save bracket button */}
                    {(drawMatches.length > 0) && (
                        <button
                            disabled={saving}
                            onClick={handleSaveBracket}
                            className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-lg flex items-center justify-center gap-3 hover:bg-green-700 shadow-lg disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="animate-spin" size={22} /> : <Save size={22} />}
                            Salvar Campeonato e Gerar Tabela
                        </button>
                    )}

                    <button
                        onClick={() => setStep('registering')}
                        className="w-full py-3 border border-stone-200 rounded-xl font-bold text-stone-500 hover:bg-stone-50 flex items-center justify-center gap-2"
                    >
                        <ChevronRight size={16} className="rotate-180" /> Voltar para Inscrições
                    </button>
                </div>
            )}

            {/* Step 4: Bracket management */}
            {step === 'bracket' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="font-black text-stone-800 text-lg">Tabela de Confrontos</h2>
                        <div className="flex gap-2">
                            <button onClick={loadBracket} disabled={loadingBracket} className="p-2 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-500">
                                <RefreshCw size={16} className={loadingBracket ? 'animate-spin' : ''} />
                            </button>
                            <button
                                onClick={handleFinish}
                                disabled={saving || bracket.some(m => m.match_number === (classe === '5ª Classe' ? 15 : 18) && m.status !== 'finished')}
                                className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold disabled:opacity-40 hover:bg-green-700 flex items-center gap-2"
                            >
                                <Trophy size={14} /> Encerrar
                            </button>
                        </div>
                    </div>

                    {loadingBracket ? (
                        <div className="text-center py-12"><Loader2 className="animate-spin mx-auto text-saibro-600" /></div>
                    ) : (
                        bracketPhases.map(phase => {
                            const phaseMatches = bracket.filter(m => m.round_phase === phase);
                            return (
                                <div key={phase} className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
                                    <div className="bg-stone-50 px-4 py-2 border-b border-stone-100">
                                        <h3 className="font-black text-stone-700 text-sm uppercase tracking-wide">
                                            {PHASE_LABELS[phase] ?? phase}
                                        </h3>
                                    </div>
                                    <div className="divide-y divide-stone-50">
                                        {phaseMatches.map(m => (
                                            <MatchCard
                                                key={m.id}
                                                match={m}
                                                onWin={(winRegId, isWO) => handleResult(m.id, winRegId, isWO)}
                                                saving={saving}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
};

// ── MatchCard ─────────────────────────────────────────────────────────────────

interface MatchCardProps {
    match: BracketMatchWithPhase;
    onWin: (winRegId: string, isWO: boolean) => void;
    saving: boolean;
}

const MatchCard: React.FC<MatchCardProps> = ({ match, onWin, saving }) => {
    const [showActions, setShowActions] = useState(false);
    const isFinished = match.status === 'finished';
    const pending = !match.registration_a_id || !match.registration_b_id;

    return (
        <div className={`px-4 py-3 ${isFinished ? 'opacity-75' : ''}`}>
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-stone-400 w-8">J{match.match_number}</span>
                <div className="flex-1 space-y-1">
                    <PlayerLine
                        label={match.player_a_label}
                        regId={match.registration_a_id}
                        isWinner={isFinished && match.winner_registration_id === match.registration_a_id}
                        isLoser={isFinished && match.winner_registration_id !== match.registration_a_id}
                    />
                    <PlayerLine
                        label={match.player_b_label}
                        regId={match.registration_b_id}
                        isWinner={isFinished && match.winner_registration_id === match.registration_b_id}
                        isLoser={isFinished && match.winner_registration_id !== match.registration_b_id}
                    />
                </div>
                {!isFinished && !pending && (
                    <button
                        onClick={() => setShowActions(v => !v)}
                        className="p-2 rounded-xl bg-saibro-50 text-saibro-600 hover:bg-saibro-100 transition-colors"
                    >
                        <Play size={14} />
                    </button>
                )}
                {isFinished && <Check size={16} className="text-green-500 shrink-0" />}
                {pending && <span className="text-xs text-stone-300 font-bold">aguarda</span>}
            </div>

            {showActions && !isFinished && match.registration_a_id && match.registration_b_id && (
                <div className="mt-3 pt-3 border-t border-stone-100 space-y-2">
                    <p className="text-xs font-bold text-stone-500 uppercase">Vencedor</p>
                    <div className="flex gap-2">
                        <button
                            disabled={saving}
                            onClick={() => { onWin(match.registration_a_id!, false); setShowActions(false); }}
                            className="flex-1 py-2 bg-saibro-600 text-white rounded-xl text-xs font-bold hover:bg-saibro-700 disabled:opacity-50"
                        >
                            {match.player_a_label}
                        </button>
                        <button
                            disabled={saving}
                            onClick={() => { onWin(match.registration_b_id!, false); setShowActions(false); }}
                            className="flex-1 py-2 bg-saibro-600 text-white rounded-xl text-xs font-bold hover:bg-saibro-700 disabled:opacity-50"
                        >
                            {match.player_b_label}
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <button
                            disabled={saving}
                            onClick={() => { onWin(match.registration_a_id!, true); setShowActions(false); }}
                            className="flex-1 py-2 border border-orange-300 text-orange-600 rounded-xl text-xs font-bold hover:bg-orange-50 disabled:opacity-50"
                        >
                            W.O. → {match.player_a_label}
                        </button>
                        <button
                            disabled={saving}
                            onClick={() => { onWin(match.registration_b_id!, true); setShowActions(false); }}
                            className="flex-1 py-2 border border-orange-300 text-orange-600 rounded-xl text-xs font-bold hover:bg-orange-50 disabled:opacity-50"
                        >
                            W.O. → {match.player_b_label}
                        </button>
                    </div>
                    <button onClick={() => setShowActions(false)} className="w-full py-2 text-xs text-stone-400 hover:text-stone-600 flex items-center justify-center gap-1">
                        <X size={12} /> Cancelar
                    </button>
                </div>
            )}
        </div>
    );
};

const PlayerLine: React.FC<{ label: string; regId: string | null; isWinner: boolean; isLoser: boolean }> = ({
    label, isWinner, isLoser,
}) => (
    <div className={`flex items-center gap-2 text-sm ${isWinner ? 'font-black text-saibro-700' : isLoser ? 'text-stone-400 line-through' : 'font-medium text-stone-700'}`}>
        {isWinner && <Trophy size={11} className="text-yellow-500 shrink-0" />}
        <span className="truncate">{label}</span>
    </div>
);
