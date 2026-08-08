import React, { useState } from 'react';
import { AlertTriangle, Loader2, Trophy } from 'lucide-react';
import {
    previewKnockoutFromGroups,
    saveKnockoutFromGroups,
    type GroupsKnockoutPreview,
} from '../../lib/championship/knockoutFromGroups';
import type { FormatConfig } from '../../lib/championship/formatConfig';
import type { BracketAthlete } from './BracketEditor';

interface Props {
    championshipId: string;
    classe: string;
    config: FormatConfig;
    athletes: BracketAthlete[];
    phaseToRoundId: Map<string, string>;
    /** Recebe a fase da primeira rodada eliminatória gravada, para publicá-la. */
    onSaved: (faseInicial: string) => void | Promise<void>;
}

export const KnockoutFromGroups: React.FC<Props> = ({
    championshipId, classe, config, athletes, phaseToRoundId, onSaved,
}) => {
    const [preview, setPreview] = useState<GroupsKnockoutPreview | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [erro, setErro] = useState('');

    const nomeDe = (registrationId: string) =>
        athletes.find(a => a.registrationId === registrationId)?.name ?? registrationId;

    const carregar = async () => {
        setLoading(true);
        setErro('');
        try {
            setPreview(await previewKnockoutFromGroups({ championshipId, classe, config }));
        } catch (e: any) {
            setErro(e.message);
        } finally {
            setLoading(false);
        }
    };

    const confirmar = async () => {
        if (!preview) return;
        setSaving(true);
        setErro('');
        try {
            const faseInicial = await saveKnockoutFromGroups({
                championshipId,
                config,
                participantCount: athletes.length,
                pairs: preview.pairs,
                phaseToRoundId,
                registrationUserMap: new Map(athletes.map(a => [a.registrationId, a.userId])),
            });
            await onSaved(faseInicial);
        } catch (e: any) {
            setErro(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
            <h2 className="font-black text-stone-800 flex items-center gap-2">
                <Trophy size={18} className="text-saibro-600" /> Mata-mata a partir dos grupos — {classe}
            </h2>

            {!preview ? (
                <>
                    <p className="text-xs text-stone-500">
                        Lê a classificação dos grupos e monta os confrontos, cruzando primeiros
                        colocados com classificados de outro grupo.
                    </p>
                    <button type="button" onClick={carregar} disabled={loading}
                        className="w-full py-3 bg-stone-900 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2">
                        {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                        Ver classificados
                    </button>
                </>
            ) : (
                <>
                    {preview.pendingMatches > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
                            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                            <p className="text-sm text-amber-800">
                                Ainda há {preview.pendingMatches} jogo(s) de grupo sem resultado.
                                A classificação pode mudar.
                            </p>
                        </div>
                    )}

                    {preview.sameGroupPairs > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
                            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                            <p className="text-sm text-amber-800">
                                {preview.sameGroupPairs} confronto(s) reencontram adversários do mesmo grupo.
                            </p>
                        </div>
                    )}

                    <div>
                        <p className="text-xs font-black text-stone-400 uppercase tracking-widest mb-2">
                            {preview.qualified.length} classificados
                        </p>
                        <ul className="space-y-2">
                            {preview.pairs.map(([a, b], i) => (
                                <li key={`${a}-${b}`} className="p-3 rounded-xl border border-stone-100 text-sm">
                                    <span className="text-xs font-bold text-stone-400">Jogo {i + 1}</span>
                                    <div className="flex items-center justify-between gap-2 font-bold text-stone-700">
                                        <span className="truncate">{nomeDe(a)}</span>
                                        <span className="text-xs text-stone-300">VS</span>
                                        <span className="truncate text-right">{nomeDe(b)}</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="flex gap-2">
                        <button type="button" onClick={() => setPreview(null)}
                            className="px-4 py-3 border border-stone-200 rounded-xl font-bold text-stone-600">
                            Recalcular
                        </button>
                        <button type="button" onClick={confirmar} disabled={saving || preview.pairs.length === 0}
                            className="flex-1 py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2">
                            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                            Gerar mata-mata
                        </button>
                    </div>
                </>
            )}

            {erro && <p className="text-sm text-red-600">{erro}</p>}
        </div>
    );
};
