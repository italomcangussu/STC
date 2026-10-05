import React, { useEffect, useState } from 'react';
import { UserCheck, Swords, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AdminTabId } from './adminNav';

interface Props {
    onGo: (id: AdminTabId) => void;
}

interface Counts {
    access: number;
    challenges: number;
}

const countOf = async (table: string, column: string, values: string[]): Promise<number> => {
    const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .in(column, values);
    return error ? 0 : count ?? 0;
};

export const AdminPending: React.FC<Props> = ({ onGo }) => {
    const [counts, setCounts] = useState<Counts | null>(null);

    useEffect(() => {
        let alive = true;
        Promise.all([
            countOf('access_requests', 'status', ['pending']),
            countOf('challenges', 'status', ['accepted', 'scheduled']),
        ]).then(([access, challenges]) => alive && setCounts({ access, challenges }));
        return () => { alive = false; };
    }, []);

    if (!counts) return null;

    const items: { id: AdminTabId; icon: React.ReactNode; label: string; n: number }[] = [
        { id: 'acessos', icon: <UserCheck size={16} />, label: 'cadastros aguardando aprovação', n: counts.access },
        { id: 'desafios', icon: <Swords size={16} />, label: 'desafios aguardando resultado', n: counts.challenges },
    ];
    const active = items.filter(i => i.n > 0);

    return (
        <div className="mb-4">
            {active.length === 0 ? (
                <p className="text-sm text-stone-500 bg-stone-50 rounded-2xl px-4 py-3">Tudo em dia: nenhuma pendência.</p>
            ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                    {active.map(i => (
                        <button
                            key={i.id}
                            onClick={() => onGo(i.id)}
                            className="flex flex-1 items-center gap-3 rounded-2xl bg-saibro-50 px-4 py-3 text-left text-saibro-700 hover:bg-saibro-100 transition-colors"
                        >
                            {i.icon}
                            <span className="text-sm"><b>{i.n}</b> {i.label}</span>
                            <ChevronRight size={16} className="ml-auto" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
