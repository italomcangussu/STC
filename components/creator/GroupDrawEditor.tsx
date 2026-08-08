import React, { useMemo, useState } from 'react';
import { ChevronLeft, Loader2, Shuffle, Star } from 'lucide-react';
import { distributeIntoGroups, type DrawnGroup } from '../../lib/championship/roundRobin';
import {
    buildGroupStageMatches,
    buildLeagueMatches,
    saveGroups,
    saveLeagueMatches,
} from '../../lib/championship/groupPersistence';
import type { FormatConfig } from '../../lib/championship/formatConfig';
import type { BracketAthlete } from './BracketEditor';

interface Props {
    championshipId: string;
    classe: string;
    config: FormatConfig;
    athletes: BracketAthlete[];
    phaseToRoundId: Map<string, string>;
    restantes: string[];
    onBack: () => void;
    onSaved: () => void | Promise<void>;
    onProximaClasse: () => void;
}

export const GroupDrawEditor: React.FC<Props> = ({
    championshipId, classe, config, athletes, phaseToRoundId, restantes, onBack, onSaved, onProximaClasse,
}) => {
    const ehGrupos = config.format === 'grupo-mata-mata';
    const groupCount = ehGrupos ? config.groupCount : 0;
    const homeAndAway = config.format === 'grupo-mata-mata' || config.format === 'pontos-corridos'
        ? config.homeAndAway
        : false;

    const [groups, setGroups] = useState<DrawnGroup[]>(() =>
        ehGrupos
            ? distributeIntoGroups(
                athletes.map(a => ({ registrationId: a.registrationId, isSeed: a.isSeed })),
                groupCount
            )
            : []
    );
    const [saving, setSaving] = useState(false);
    const [erro, setErro] = useState('');

    const byId = useMemo(() => new Map(athletes.map(a => [a.registrationId, a])), [athletes]);

    const totalConfrontos = ehGrupos
        ? buildGroupStageMatches({
            groups,
            groupIds: new Map(groups.map(g => [g.name, g.name])),
            homeAndAway,
        }).length
        : buildLeagueMatches({ registrationIds: athletes.map(a => a.registrationId), homeAndAway }).length;

    const sortear = () => {
        setGroups(distributeIntoGroups(
            athletes.map(a => ({ registrationId: a.registrationId, isSeed: a.isSeed })),
            groupCount
        ));
    };

    const salvar = async () => {
        setSaving(true);
        setErro('');
        try {
            const registrationUserMap = new Map(athletes.map(a => [a.registrationId, a.userId]));

            if (ehGrupos) {
                const groupIds = await saveGroups({ championshipId, classe, groups });
                await saveLeagueMatches({
                    championshipId,
                    rows: buildGroupStageMatches({ groups, groupIds, homeAndAway }),
                    phaseToRoundId,
                    registrationUserMap,
                });
            } else {
                await saveLeagueMatches({
                    championshipId,
                    rows: buildLeagueMatches({ registrationIds: athletes.map(a => a.registrationId), homeAndAway }),
                    phaseToRoundId,
                    registrationUserMap,
                });
            }
            await onSaved();
        } catch (e: any) {
            setErro(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="font-black text-stone-800">
                        {ehGrupos ? 'Fase de grupos' : 'Pontos corridos'} — {classe}
                    </h2>
                    <span className="text-xs font-bold text-stone-400">
                        {totalConfrontos} confronto{totalConfrontos === 1 ? '' : 's'}
                    </span>
                </div>
                <p className="text-xs text-stone-500">
                    {ehGrupos
                        ? 'Os cabeças de chave são espalhados um por grupo antes do sorteio dos demais.'
                        : 'Todos da classe se enfrentam; não há grupos nem sorteio.'}
                    {homeAndAway && ' Com ida e volta.'}
                </p>
                {ehGrupos && (
                    <button type="button" onClick={sortear}
                        className="w-full py-3 bg-stone-900 text-white rounded-xl font-bold flex justify-center items-center gap-2">
                        <Shuffle size={16} /> Sortear novamente
                    </button>
                )}
            </div>

            {ehGrupos && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {groups.map(group => (
                        <div key={group.name} className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
                            <div className="px-4 py-3 bg-stone-50 border-b border-stone-100 flex justify-between items-center">
                                <span className="font-black text-stone-700 text-sm">Grupo {group.name}</span>
                                <span className="text-xs font-bold text-stone-400">{group.members.length}</span>
                            </div>
                            <ul className="p-3 space-y-2">
                                {group.members.map(member => {
                                    const athlete = byId.get(member.registrationId);
                                    return (
                                        <li key={member.registrationId}
                                            className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1 ${
                                                member.isSeed
                                                    ? 'border border-saibro-500 bg-saibro-50 text-saibro-700'
                                                    : 'border border-stone-200 text-stone-700'
                                            }`}>
                                            {member.isSeed && <Star size={11} fill="currentColor" />}
                                            {athlete?.name ?? member.registrationId}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {!ehGrupos && (
                <div className="bg-white rounded-2xl border border-stone-100 p-5">
                    <ul className="grid grid-cols-2 gap-2">
                        {athletes.map(a => (
                            <li key={a.registrationId}
                                className="px-3 py-2 rounded-lg border border-stone-200 text-xs font-bold text-stone-700">
                                {a.name}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {erro && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                    <p className="text-sm text-red-700">{erro}</p>
                </div>
            )}

            <button
                type="button"
                onClick={salvar}
                disabled={saving || totalConfrontos === 0}
                className="w-full py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
            >
                {saving ? <Loader2 size={18} className="animate-spin" /> : null}
                Gerar confrontos
            </button>

            <button
                type="button"
                onClick={onBack}
                className="w-full py-3 border border-stone-200 rounded-xl font-bold text-stone-600 flex justify-center items-center gap-1"
            >
                <ChevronLeft size={18} /> Voltar para inscrições
            </button>

            {restantes.length > 0 && (
                <button type="button" onClick={onProximaClasse}
                    className="w-full py-3 border border-stone-200 rounded-xl font-bold text-stone-600">
                    Ir para outra classe ({restantes.join(', ')})
                </button>
            )}
        </div>
    );
};
