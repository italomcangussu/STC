import React, { useMemo, useState } from 'react';
import { ChevronLeft, Loader2, Shuffle, Star, Trash2 } from 'lucide-react';
import {
    assignToSlot,
    buildEmptyBracket,
    saveGenericBracket,
    seedPositionFor,
    validateBracket,
    type BracketSlot,
} from '../../lib/championship/bracket';
import { type FormatConfig } from '../../lib/championship/formatConfig';

export interface BracketAthlete {
    registrationId: string;
    name: string;
    isSeed: boolean;
    userId: string | null;
}

interface Props {
    championshipId: string;
    classe: string;
    config: FormatConfig;
    athletes: BracketAthlete[];
    phaseToRoundId: Map<string, string>;
    /** Classes do campeonato que ainda não passaram por inscrição e chave. */
    restantes: string[];
    onBack: () => void;
    onSaved: () => void | Promise<void>;
    onProximaClasse: () => void;
}

const PHASE_LABELS: Record<string, string> = {
    qualify: 'Qualificatórias',
    '16avos': '16 avos',
    oitavas: 'Oitavas',
    quartas: 'Quartas',
    semifinal: 'Semifinais',
    final: 'Final',
};

export const BracketEditor: React.FC<Props> = ({
    championshipId, classe, config, athletes, phaseToRoundId, restantes, onBack, onSaved, onProximaClasse,
}) => {
    const [slots, setSlots] = useState<BracketSlot[]>(() => buildEmptyBracket(config, athletes.length));
    const [picking, setPicking] = useState<{ matchNumber: number; side: 'a' | 'b' } | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const seedIds = useMemo(() => athletes.filter(a => a.isSeed).map(a => a.registrationId), [athletes]);
    const byId = useMemo(() => new Map(athletes.map(a => [a.registrationId, a])), [athletes]);

    const alocados = useMemo(() => {
        const set = new Set<string>();
        for (const s of slots) {
            if (s.a) set.add(s.a);
            if (s.b) set.add(s.b);
        }
        return set;
    }, [slots]);

    const disponiveis = athletes.filter(a => !alocados.has(a.registrationId));
    const validation = validateBracket(slots, seedIds);

    const fases = useMemo(() => {
        const ordem: string[] = [];
        for (const s of slots) if (!ordem.includes(s.phase)) ordem.push(s.phase);
        return ordem.map(phase => ({ phase, slots: slots.filter(s => s.phase === phase) }));
    }, [slots]);

    const sortear = () => {
        // Cabeças nas posições padrão do quadro; o resto embaralhado nas vagas restantes.
        const entryPositions: { matchNumber: number; side: 'a' | 'b' }[] = [];
        for (const slot of slots) {
            if (slot.phase === 'qualify') continue;
            if (!slot.aSourceMatch) entryPositions.push({ matchNumber: slot.matchNumber, side: 'a' });
            if (!slot.bSourceMatch) entryPositions.push({ matchNumber: slot.matchNumber, side: 'b' });
        }

        const bracketSize = entryPositions.length;
        const seeds = athletes.filter(a => a.isSeed);
        const resto = athletes.filter(a => !a.isSeed);

        const ocupadas = new Map<number, BracketAthlete>();
        seeds.forEach((athlete, i) => {
            const posicao = seedPositionFor(bracketSize, i + 1);
            if (posicao >= 1 && posicao <= bracketSize) ocupadas.set(posicao, athlete);
        });

        const embaralhado = [...resto];
        for (let i = embaralhado.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [embaralhado[i], embaralhado[j]] = [embaralhado[j], embaralhado[i]];
        }

        let next = buildEmptyBracket(config, athletes.length);
        entryPositions.forEach((pos, index) => {
            const athlete = ocupadas.get(index + 1) ?? embaralhado.shift();
            if (athlete) next = assignToSlot(next, pos.matchNumber, pos.side, athlete.registrationId);
        });

        setSlots(next);
        setPicking(null);
    };

    const limpar = () => {
        setSlots(buildEmptyBracket(config, athletes.length));
        setPicking(null);
    };

    const escolher = (registrationId: string) => {
        if (!picking) return;
        setSlots(prev => assignToSlot(prev, picking.matchNumber, picking.side, registrationId));
        setPicking(null);
    };

    const salvar = async () => {
        setSaving(true);
        setSaveError('');
        try {
            await saveGenericBracket({
                championshipId,
                slots,
                phaseToRoundId,
                registrationUserMap: new Map(athletes.map(a => [a.registrationId, a.userId])),
            });
            await onSaved();
        } catch (e: any) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const renderVaga = (slot: BracketSlot, side: 'a' | 'b') => {
        const sourceMatch = side === 'a' ? slot.aSourceMatch : slot.bSourceMatch;
        const registrationId = side === 'a' ? slot.a : slot.b;
        const athlete = registrationId ? byId.get(registrationId) : undefined;
        const faseLabel = PHASE_LABELS[slot.phase] ?? slot.phase;

        if (sourceMatch) {
            return (
                <div
                    className="px-3 py-2 rounded-lg border border-stone-100 bg-stone-50 text-xs text-stone-400"
                    aria-label={`${faseLabel}, jogo ${slot.matchNumber}, vaga ${side.toUpperCase()}, recebe o vencedor do jogo ${sourceMatch}`}
                >
                    vencedor do jogo {sourceMatch}
                </div>
            );
        }

        const selecionando = picking?.matchNumber === slot.matchNumber && picking?.side === side;

        return (
            <button
                type="button"
                onClick={() => (athlete
                    ? setSlots(prev => assignToSlot(prev, slot.matchNumber, side, null))
                    : setPicking(selecionando ? null : { matchNumber: slot.matchNumber, side }))}
                aria-label={`${faseLabel}, jogo ${slot.matchNumber}, vaga ${side.toUpperCase()}, ${athlete ? athlete.name : 'livre'}`}
                className={`w-full text-left px-3 py-2 rounded-lg border text-xs font-bold transition-colors ${
                    athlete
                        ? athlete.isSeed
                            ? 'border-saibro-500 bg-saibro-50 text-saibro-700'
                            : 'border-stone-200 bg-white text-stone-700'
                        : selecionando
                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-dashed border-stone-300 text-stone-400'
                }`}
            >
                {athlete ? (
                    <span className="flex items-center gap-1">
                        {athlete.isSeed && <Star size={11} fill="currentColor" />}
                        <span className="truncate">{athlete.name}</span>
                    </span>
                ) : selecionando ? 'escolha abaixo…' : '+ vaga livre'}
            </button>
        );
    };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="font-black text-stone-800">Chave{classe ? ` — ${classe}` : ''}</h2>
                    <span className="text-xs font-bold text-stone-400">
                        {alocados.size}/{athletes.length} alocados
                    </span>
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={sortear}
                        className="flex-1 py-3 bg-stone-900 text-white rounded-xl font-bold flex justify-center items-center gap-2">
                        <Shuffle size={16} /> Sortear
                    </button>
                    <button type="button" onClick={limpar} aria-label="Limpar a chave"
                        className="px-4 py-3 border border-stone-200 rounded-xl font-bold text-stone-600">
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-stone-100 p-5">
                <div className="overflow-x-auto">
                    <div className="flex gap-4 min-w-max">
                        {fases.map(({ phase, slots: fasesSlots }) => (
                            <div key={phase} className="w-44 shrink-0 space-y-3">
                                <p className="text-xs font-black text-stone-400 uppercase tracking-widest">
                                    {PHASE_LABELS[phase] ?? phase}
                                </p>
                                {fasesSlots.map(slot => (
                                    <div key={slot.matchNumber} className="space-y-1 p-2 rounded-xl bg-stone-50/60">
                                        <p className="text-xs font-bold text-stone-400">Jogo {slot.matchNumber}</p>
                                        {renderVaga(slot, 'a')}
                                        {renderVaga(slot, 'b')}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {picking && (
                <div className="bg-white rounded-2xl border border-blue-200 p-5 space-y-2">
                    <h3 className="font-black text-stone-800 text-sm">
                        Quem entra no jogo {picking.matchNumber}, vaga {picking.side.toUpperCase()}?
                    </h3>
                    {disponiveis.length === 0 ? (
                        <p className="text-sm text-stone-400">Todos os inscritos já estão alocados.</p>
                    ) : (
                        <ul className="max-h-56 overflow-y-auto space-y-1">
                            {disponiveis.map(a => (
                                <li key={a.registrationId}>
                                    <button type="button" onClick={() => escolher(a.registrationId)}
                                        className="w-full text-left p-2 rounded-lg hover:bg-stone-50 text-sm font-bold text-stone-700 flex items-center gap-1">
                                        {a.isSeed && <Star size={12} className="text-saibro-500" fill="currentColor" />}
                                        {a.name}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <button type="button" onClick={() => setPicking(null)}
                        className="w-full py-2 text-sm font-bold text-stone-500">
                        Cancelar
                    </button>
                </div>
            )}

            {validation.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1">
                    {validation.warnings.map(w => <p key={w} className="text-sm text-amber-800">{w}</p>)}
                </div>
            )}

            {(validation.errors.length > 0 || saveError) && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-1">
                    {saveError && <p className="text-sm text-red-700">{saveError}</p>}
                    {validation.errors.slice(0, 5).map(e => <p key={e} className="text-sm text-red-700">{e}</p>)}
                    {validation.errors.length > 5 && (
                        <p className="text-xs text-red-500">e mais {validation.errors.length - 5} vaga(s) por preencher.</p>
                    )}
                </div>
            )}

            <button
                type="button"
                onClick={salvar}
                disabled={!validation.ok || saving}
                className="w-full py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
            >
                {saving ? <Loader2 size={18} className="animate-spin" /> : null}
                Salvar chave
            </button>

            <button
                type="button"
                onClick={onBack}
                className="w-full py-3 border border-stone-200 rounded-xl font-bold text-stone-600 flex justify-center items-center gap-1"
            >
                <ChevronLeft size={18} /> Voltar para inscrições
            </button>

            {restantes.length > 0 && (
                <button
                    type="button"
                    onClick={onProximaClasse}
                    className="w-full py-3 border border-stone-200 rounded-xl font-bold text-stone-600"
                >
                    Ir para outra classe ({restantes.join(', ')})
                </button>
            )}
        </div>
    );
};
