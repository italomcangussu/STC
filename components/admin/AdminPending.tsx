import React, { useEffect, useState } from 'react';
import { UserCheck, Swords, ChevronRight, Calendar, DollarSign, Vote } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getNowInFortaleza, formatDate } from '../../utils';
import type { AdminTabId } from './adminNav';

interface Props {
    onGo: (id: AdminTabId) => void;
}

interface Counts {
    access: number;
    challenges: number;
    today: number;
    payments: number;
    forms: number;
}

type Filter = (q: any) => any;

const countOf = async (table: string, apply: Filter): Promise<number> => {
    const { count, error } = await apply(
        supabase.from(table).select('id', { count: 'exact', head: true }));
    return error ? 0 : count ?? 0;
};

export const AdminPending: React.FC<Props> = ({ onGo }) => {
    const [counts, setCounts] = useState<Counts | null>(null);

    useEffect(() => {
        let alive = true;
        Promise.all([
            countOf('access_requests', q => q.eq('status', 'pending')),
            countOf('challenges', q => q.in('status', ['accepted', 'scheduled'])),
            countOf('reservations', q => q.eq('date', formatDate(getNowInFortaleza())).neq('status', 'cancelled')),
            countOf('reservations', q => q.eq('payment_status', 'pending').neq('status', 'cancelled')),
            countOf('club_forms', q => q.eq('is_active', true)),
        ]).then(([access, challenges, today, payments, forms]) =>
            alive && setCounts({ access, challenges, today, payments, forms }));
        return () => { alive = false; };
    }, []);

    if (!counts) return null;

    const items: { id: AdminTabId; icon: React.ReactNode; label: string; n: number }[] = [
        { id: 'acessos', icon: <UserCheck size={16} />, label: 'cadastros aguardando aprovação', n: counts.access },
        { id: 'desafios', icon: <Swords size={16} />, label: 'desafios aguardando resultado', n: counts.challenges },
        { id: 'financeiro', icon: <DollarSign size={16} />, label: 'reservas com pagamento pendente', n: counts.payments },
        { id: 'reservas', icon: <Calendar size={16} />, label: 'reservas hoje', n: counts.today },
        { id: 'formularios', icon: <Vote size={16} />, label: 'formulários abertos', n: counts.forms },
    ];
    const active = items.filter(i => i.n > 0);

    return (
        <div className="mb-4">
            {active.length === 0 ? (
                <p className="text-sm text-stone-500 bg-stone-50 rounded-2xl px-4 py-3">Tudo em dia: nenhuma pendência.</p>
            ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
