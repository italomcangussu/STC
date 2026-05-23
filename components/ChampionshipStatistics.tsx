import React, { useMemo, useState } from 'react';
import { BarChart3, ChevronDown, Gauge, Trophy } from 'lucide-react';
import type { Match } from '../types';
import { calculateChampionshipStats, calculateOddsSimulation, type AthleteStat, type ChampionshipStatsRegistration } from '../lib/championshipStats';

interface Props {
    matches: Match[];
    registrations: ChampionshipStatsRegistration[];
}

const pct = (value: number, total: number) => total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';
const balance = (won: number, lost: number) => {
    const value = won - lost;
    return value > 0 ? `+${value}` : String(value);
};

const confidenceLabel = {
    baixa: 'Baixa confiança',
    media: 'Confiança média',
    alta: 'Alta confiança',
};

const AthleteRow: React.FC<{ stat: AthleteStat; index: number }> = ({ stat, index }) => (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
        <div className={`grid h-9 w-9 place-items-center rounded-2xl text-sm font-black ${index === 0 ? 'bg-saibro-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
            {index + 1}
        </div>
        <div className="min-w-0">
            <div className="flex items-center gap-2">
                <p className="truncate text-sm font-black text-stone-900">{stat.name}</p>
                {stat.lastResult && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${stat.lastResult === 'V' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                        {stat.lastResult}
                    </span>
                )}
            </div>
            <p className="mt-1 text-[11px] font-bold text-stone-400">
                {stat.matchesPlayed} jogos · {stat.wins}V/{stat.losses}D · aproveitamento {pct(stat.wins, stat.matchesPlayed)}
            </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right text-[11px] font-black text-stone-600 sm:grid-cols-4">
            <span>Sets {stat.setsWon}-{stat.setsLost}</span>
            <span>Saldo {balance(stat.setsWon, stat.setsLost)}</span>
            <span>Games {stat.gamesWon}-{stat.gamesLost}</span>
            <span>Saldo {balance(stat.gamesWon, stat.gamesLost)}</span>
        </div>
    </div>
);

export const ChampionshipStatistics: React.FC<Props> = ({ matches, registrations }) => {
    const stats = useMemo(() => calculateChampionshipStats(matches, registrations), [matches, registrations]);
    const classes = Object.keys(stats.byClass).sort();
    const [selectedClass, setSelectedClass] = useState(classes[0] || '');
    const currentClass = classes.includes(selectedClass) ? selectedClass : classes[0] || '';
    const athletes = stats.byClass[currentClass] || [];
    const eligibleAthletes = athletes.filter(athlete => athlete.matchesPlayed > 0);
    const [athleteAId, setAthleteAId] = useState('');
    const [athleteBId, setAthleteBId] = useState('');

    const athleteA = stats.byAthlete[athleteAId] || eligibleAthletes[0];
    const athleteB = stats.byAthlete[athleteBId] || eligibleAthletes.find(athlete => athlete.registrationId !== athleteA?.registrationId);
    const odds = athleteA && athleteB ? calculateOddsSimulation(athleteA, athleteB) : null;
    const favorite = odds?.favoriteRegistrationId ? stats.byAthlete[odds.favoriteRegistrationId] : null;

    if (registrations.length === 0) {
        return (
            <div className="rounded-3xl border border-dashed border-stone-200 bg-white p-10 text-center text-stone-400">
                Nenhum inscrito encontrado.
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="rounded-3xl bg-stone-950 p-5 text-white shadow-xl shadow-stone-200">
                <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">Estatísticas</p>
                        <h3 className="mt-1 text-xl font-black">Desempenho do campeonato</h3>
                    </div>
                    <BarChart3 className="text-orange-300" size={28} />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Metric label="Atletas" value={registrations.length} />
                    <Metric label="Finalizadas" value={stats.finishedMatches} />
                    <Metric label="Sets" value={stats.totalSets} />
                    <Metric label="Games" value={stats.totalGames} />
                </div>
            </div>

            <div className="flex gap-2 overflow-x-auto rounded-3xl border border-stone-100 bg-white p-2 shadow-sm">
                {classes.map(className => (
                    <button
                        key={className}
                        onClick={() => setSelectedClass(className)}
                        className={`shrink-0 rounded-2xl px-4 py-2 text-xs font-black transition-all ${currentClass === className ? 'bg-saibro-600 text-white shadow-md' : 'text-stone-500 hover:bg-stone-50'}`}
                    >
                        {className}
                    </button>
                ))}
            </div>

            {stats.finishedMatches === 0 ? (
                <div className="rounded-3xl border border-dashed border-stone-200 bg-white p-10 text-center">
                    <Trophy className="mx-auto mb-3 text-stone-200" size={42} />
                    <p className="font-bold text-stone-400">Aguardando partidas finalizadas.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {athletes.map((stat, index) => <AthleteRow key={stat.registrationId} stat={stat} index={index} />)}
                </div>
            )}

            <div className="rounded-3xl border border-stone-100 bg-white p-5 shadow-lg shadow-stone-200/60">
                <div className="mb-4 flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-2xl bg-saibro-50 text-saibro-600">
                        <Gauge size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-stone-900">Simulador de odds</h3>
                        <p className="text-xs font-bold text-stone-400">Simulação informativa, sem aposta real.</p>
                    </div>
                </div>

                {eligibleAthletes.length < 2 ? (
                    <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-5 text-center text-sm font-bold text-stone-400">
                        Dados insuficientes para comparar atletas desta classe.
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <AthleteSelect label="Atleta A" athletes={eligibleAthletes} value={athleteA?.registrationId || ''} onChange={setAthleteAId} />
                            <AthleteSelect label="Atleta B" athletes={eligibleAthletes.filter(athlete => athlete.registrationId !== athleteA?.registrationId)} value={athleteB?.registrationId || ''} onChange={setAthleteBId} />
                        </div>

                        {odds && athleteA && athleteB && (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <OddCard stat={athleteA} side={odds.athleteA} favorite={odds.favoriteRegistrationId === athleteA.registrationId} />
                                <OddCard stat={athleteB} side={odds.athleteB} favorite={odds.favoriteRegistrationId === athleteB.registrationId} />
                                <div className="sm:col-span-2 rounded-2xl bg-stone-50 p-4 text-sm font-bold text-stone-500">
                                    Favorito: <span className="font-black text-stone-900">{favorite?.name || 'Equilibrado'}</span> · {confidenceLabel[odds.confidence]}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-stone-300">{label}</p>
        <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
);

const AthleteSelect: React.FC<{
    label: string;
    athletes: AthleteStat[];
    value: string;
    onChange: (value: string) => void;
}> = ({ label, athletes, value, onChange }) => (
    <label className="block">
        <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-stone-400">{label}</span>
        <div className="relative">
            <select
                value={value || athletes[0]?.registrationId || ''}
                onChange={event => onChange(event.target.value)}
                className="w-full appearance-none rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-black text-stone-800 outline-hidden focus:border-saibro-500"
            >
                {athletes.map(athlete => (
                    <option key={athlete.registrationId} value={athlete.registrationId}>{athlete.name}</option>
                ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" size={16} />
        </div>
    </label>
);

const OddCard: React.FC<{
    stat: AthleteStat;
    side: { probability: number; decimalOdd: number };
    favorite: boolean;
}> = ({ stat, side, favorite }) => (
    <div className={`rounded-2xl border p-4 ${favorite ? 'border-saibro-200 bg-saibro-50' : 'border-stone-100 bg-stone-50'}`}>
        <p className="truncate text-sm font-black text-stone-900">{stat.name}</p>
        <div className="mt-3 flex items-end justify-between gap-3">
            <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-stone-400">Prob.</p>
                <p className="text-xl font-black text-stone-900">{side.probability}%</p>
            </div>
            <div className="text-right">
                <p className="text-[10px] font-black uppercase tracking-widest text-stone-400">Odd</p>
                <p className="text-3xl font-black text-saibro-600">{side.decimalOdd.toFixed(2)}</p>
            </div>
        </div>
    </div>
);
