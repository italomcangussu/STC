import React, { useEffect, useState } from 'react';
import { Loader2, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchBracket, type BracketMatchWithPhase } from '../lib/resenhaOpenService';
import { ResenhaOpenTournamentBoard } from './ResenhaOpenTournamentBoard';

interface Props {
    championshipId: string;
    onMatchSelect?: (match: BracketMatchWithPhase) => void;
}

export const ResenhaOpenBracketView: React.FC<Props> = ({ championshipId, onMatchSelect }) => {
    const [bracket, setBracket] = useState<BracketMatchWithPhase[]>([]);
    const [champName, setChampName] = useState('Resenha Open');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        const loadBracket = async (showLoading: boolean) => {
            if (showLoading) setLoading(true);

            try {
                const [bData, champData] = await Promise.all([
                    fetchBracket(championshipId),
                    supabase.from('championships').select('name').eq('id', championshipId).single(),
                ]);

                if (!active) return;
                setBracket(bData);
                setChampName(champData.data?.name ?? 'Resenha Open');
            } finally {
                if (showLoading && active) setLoading(false);
            }
        };

        loadBracket(true);

        const channel = supabase
            .channel(`resenha-open-bracket-${championshipId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'matches',
                    filter: `championship_id=eq.${championshipId}`,
                },
                () => {
                    loadBracket(false);
                },
            )
            .subscribe();

        return () => {
            active = false;
            supabase.removeChannel(channel);
        };
    }, [championshipId]);

    if (loading) {
        return (
            <div className="flex justify-center py-16">
                <Loader2 className="animate-spin text-saibro-600" size={32} />
            </div>
        );
    }

    if (bracket.length === 0) {
        return (
            <div className="p-4">
                <div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-[#061320]/90 px-6 py-12 text-center text-slate-300 shadow-xl">
                    <Trophy size={32} className="mx-auto mb-3 text-orange-300/50" />
                    <p className="font-bold">Sorteio ainda não realizado.</p>
                </div>
            </div>
        );
    }

    return <ResenhaOpenTournamentBoard bracket={bracket} championshipName={champName} onMatchSelect={onMatchSelect} />;
};
