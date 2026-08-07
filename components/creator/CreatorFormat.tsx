import React from 'react';
import { ChevronLeft, Loader2, Trophy } from 'lucide-react';
import {
    BRACKET_SLOTS,
    validateFormatShape,
    type BracketSize,
    type FormatConfig,
    type GroupKnockoutConfig,
    type KnockoutConfig,
    type RoundRobinConfig,
} from '../../lib/championship/formatConfig';
import { Toggle } from './Toggle';

const BRACKET_LABELS: Record<BracketSize, string> = {
    round_of_32: '16 avos (32 vagas)',
    round_of_16: 'Oitavas (16 vagas)',
    quarterfinal: 'Quartas (8 vagas)',
    semifinal: 'Semifinal (4 vagas)',
};

const NumberField: React.FC<{ id: string; label: string; value: number; min: number; onChange: (v: number) => void }> = ({ id, label, value, min, onChange }) => (
    <div>
        <label htmlFor={id} className="block text-[10px] font-bold text-stone-400 uppercase mb-1">{label}</label>
        <input id={id} type="number" min={min} value={value} onChange={e => onChange(Number(e.target.value))}
            className="w-full p-2 border border-stone-200 rounded-xl font-bold" />
    </div>
);

const BracketSelect: React.FC<{ id: string; label: string; value: BracketSize; onChange: (v: BracketSize) => void }> = ({ id, label, value, onChange }) => (
    <div>
        <label htmlFor={id} className="block text-[10px] font-bold text-stone-400 uppercase mb-1">{label}</label>
        <select id={id} value={value} onChange={e => onChange(e.target.value as BracketSize)}
            className="w-full p-2 border border-stone-200 rounded-xl font-bold">
            {(Object.keys(BRACKET_LABELS) as BracketSize[]).map(k => <option key={k} value={k}>{BRACKET_LABELS[k]}</option>)}
        </select>
    </div>
);

interface Props {
    config: FormatConfig;
    onChange: (config: FormatConfig) => void;
    onBack: () => void;
    onConfirm: () => void;
    saving: boolean;
}

export const CreatorFormat: React.FC<Props> = ({ config, onChange, onBack, onConfirm, saving }) => {
    const validation = validateFormatShape(config);

    const renderGroups = (c: GroupKnockoutConfig) => {
        const set = <K extends keyof GroupKnockoutConfig>(k: K, v: GroupKnockoutConfig[K]) => onChange({ ...c, [k]: v });
        const vagas = c.groupCount * c.membersPerGroup;
        const classificados = c.qualifiersPerGroup * c.groupCount + c.bestThirdPlaces;
        return (
            <div className="space-y-4">
                <Toggle id="groups-home-away" label="Jogos de ida e volta na fase de grupos" checked={c.homeAndAway} onChange={v => set('homeAndAway', v)} />
                <div className="grid grid-cols-2 gap-3">
                    <NumberField id="group-count" label="Quantos grupos" min={1} value={c.groupCount} onChange={v => set('groupCount', v)} />
                    <NumberField id="group-members" label="Membros por grupo" min={2} value={c.membersPerGroup} onChange={v => set('membersPerGroup', v)} />
                    <NumberField id="group-qualifiers" label="Classificados por grupo" min={1} value={c.qualifiersPerGroup} onChange={v => set('qualifiersPerGroup', v)} />
                    <NumberField id="group-thirds" label="Vagas p/ melhores 3ºs" min={0} value={c.bestThirdPlaces} onChange={v => set('bestThirdPlaces', v)} />
                </div>
                <Toggle id="groups-seeded" label="Usar cabeças de chave no mata-mata" checked={c.seeded} onChange={v => set('seeded', v)} />
                <p className="text-xs text-stone-500">
                    {vagas} vagas na fase de grupos · {classificados} classificados para o mata-mata.
                </p>
            </div>
        );
    };

    const renderRoundRobin = (c: RoundRobinConfig) => {
        const set = <K extends keyof RoundRobinConfig>(k: K, v: RoundRobinConfig[K]) => onChange({ ...c, [k]: v });
        const finalPhase = c.finalPhase;
        return (
            <div className="space-y-4">
                <Toggle id="rr-home-away" label="Jogos de ida e volta" checked={c.homeAndAway} onChange={v => set('homeAndAway', v)} />
                <Toggle
                    id="rr-final-phase"
                    label="Ter fase final (mata-mata) após os pontos corridos"
                    checked={finalPhase !== null}
                    onChange={v => set('finalPhase', v ? { startPhase: 'quarterfinal' } : null)}
                />
                {finalPhase && (
                    <BracketSelect
                        id="rr-start-phase"
                        label="A fase final começa em"
                        value={finalPhase.startPhase}
                        onChange={v => set('finalPhase', { startPhase: v })}
                    />
                )}
                <p className="text-xs text-stone-500">Todos da mesma classe se enfrentam; não há grupos.</p>
            </div>
        );
    };

    const renderKnockout = (c: KnockoutConfig) => {
        const set = <K extends keyof KnockoutConfig>(k: K, v: KnockoutConfig[K]) => onChange({ ...c, [k]: v });
        const slots = BRACKET_SLOTS[c.mainDrawStartPhase];
        // Capturado numa const para o TypeScript manter o narrowing dentro dos callbacks.
        const qualifying = c.qualifying;
        return (
            <div className="space-y-4">
                <BracketSelect id="ko-start-phase" label="Quadro principal começa em" value={c.mainDrawStartPhase} onChange={v => set('mainDrawStartPhase', v)} />
                <Toggle id="ko-seeded" label="Usar cabeças de chave" checked={c.seeded} onChange={v => set('seeded', v)} />
                <Toggle
                    id="ko-qualifying"
                    label="Ter qualificatórias (qualify)"
                    checked={qualifying !== null}
                    onChange={v => set('qualifying', v ? { matchCount: 4, entrySlots: [2, 7, 10, 15] } : null)}
                />
                {qualifying && (
                    <div className="space-y-3">
                        <NumberField
                            id="ko-qualify-matches"
                            label="Jogos nas qualificatórias"
                            min={1}
                            value={qualifying.matchCount}
                            onChange={v => set('qualifying', { matchCount: v, entrySlots: qualifying.entrySlots.slice(0, v) })}
                        />
                        <div>
                            <label htmlFor="ko-entry-slots" className="block text-[10px] font-bold text-stone-400 uppercase mb-1">
                                Vagas do quadro onde os vencedores entram (1 a {slots}, separadas por vírgula)
                            </label>
                            <input
                                id="ko-entry-slots"
                                value={qualifying.entrySlots.join(', ')}
                                onChange={e => set('qualifying', {
                                    matchCount: qualifying.matchCount,
                                    entrySlots: e.target.value.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n)),
                                })}
                                className="w-full p-2 border border-stone-200 rounded-xl font-bold"
                            />
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-4">
                <h2 className="font-black text-stone-800 flex items-center gap-2">
                    <Trophy size={18} className="text-saibro-600" /> Configuração do formato
                </h2>
                {config.format === 'grupo-mata-mata' && renderGroups(config)}
                {config.format === 'pontos-corridos' && renderRoundRobin(config)}
                {config.format === 'mata-mata' && renderKnockout(config)}
            </div>

            {!validation.ok && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1">
                    {validation.errors.map(err => (
                        <p key={err} className="text-sm text-amber-800">{err}</p>
                    ))}
                </div>
            )}

            <div className="flex gap-3">
                <button type="button" onClick={onBack}
                    className="px-5 py-3 rounded-xl border border-stone-200 text-stone-600 font-bold flex items-center gap-1">
                    <ChevronLeft size={18} /> Voltar
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={!validation.ok || saving}
                    className="flex-1 py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
                >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <Trophy size={18} />} Criar campeonato
                </button>
            </div>
        </div>
    );
};
