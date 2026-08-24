import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchBracket, type BracketMatchWithPhase } from '../lib/resenhaOpenService';
import { ResenhaOpenTournamentBoard } from './ResenhaOpenTournamentBoard';

interface Props {
    championshipId: string;
    championshipName: string;
    onMatchSelect?: (match: BracketMatchWithPhase) => void;
    /**
     * Muda para forçar a releitura da chave.
     *
     * O quadro tem estado próprio, separado do da tela de campeonatos: quando o
     * admin reagenda ou lança um placar pelo modal, quem se atualiza é a tela, e
     * o quadro seguia mostrando o horário antigo. A inscrição realtime abaixo
     * deveria cobrir isso e não cobre — a tabela `matches` não está publicada
     * para realtime no banco, então o evento nunca chega.
     */
    refreshToken?: number;
}

/**
 * Quadro de confrontos de um campeonato qualquer: todas as fases lado a lado,
 * ligadas pelos vencedores, até a final.
 *
 * É o mesmo tabuleiro do Resenha Open, sem as duas coisas que só valem para
 * ele: o quadro oficial impresso como fallback e os horários oficiais por
 * número de jogo. As fases e as classes saem dos próprios dados.
 */
export const TournamentBracketView: React.FC<Props> = ({ championshipId, championshipName, onMatchSelect, refreshToken = 0 }) => {
    const [bracket, setBracket] = useState<BracketMatchWithPhase[]>([]);
    const [loading, setLoading] = useState(true);

    // Primeira carga e releituras. `refreshToken` entra aqui, e não no efeito da
    // inscrição: reler não pode derrubar e recriar o canal a cada vez.
    const primeiraCarga = useRef(true);

    useEffect(() => {
        let active = true;
        const comLoading = primeiraCarga.current;
        primeiraCarga.current = false;

        (async () => {
            if (comLoading) setLoading(true);
            try {
                const dados = await fetchBracket(championshipId, { officialFallback: false });
                if (active) setBracket(dados);
            } finally {
                if (comLoading && active) setLoading(false);
            }
        })();

        return () => { active = false; };
    }, [championshipId, refreshToken]);

    useEffect(() => {
        let active = true;

        const carregar = async () => {
            const dados = await fetchBracket(championshipId, { officialFallback: false });
            if (active) setBracket(dados);
        };

        const channel = supabase
            .channel(`tournament-bracket-${championshipId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'matches',
                    filter: `championship_id=eq.${championshipId}`,
                },
                () => {
                    carregar();
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
                    <p className="font-bold">Chave ainda não definida.</p>
                </div>
            </div>
        );
    }

    return (
        <ResenhaOpenTournamentBoard
            bracket={bracket}
            championshipName={championshipName}
            onMatchSelect={onMatchSelect}
        />
    );
};
