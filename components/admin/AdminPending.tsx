import React from 'react';
import { UserCheck, Swords, ChevronRight, Calendar, DollarSign, Vote } from 'lucide-react';
import type { AdminTabId } from './adminSections';
import type { AdminCounts } from './useAdminPending';

interface Props {
    counts: AdminCounts | null;
    onGo: (id: AdminTabId) => void;
}

export const AdminPending: React.FC<Props> = ({ counts, onGo }) => {
    if (!counts) return null;

    const one = (n: number, singular: string, plural: string) => (n === 1 ? singular : plural);
    const items: { id: AdminTabId; icon: React.ReactNode; label: string; n: number }[] = [
        { id: 'acessos', icon: <UserCheck size={18} />, label: one(counts.access, 'cadastro aguardando aprovação', 'cadastros aguardando aprovação'), n: counts.access },
        { id: 'desafios', icon: <Swords size={18} />, label: one(counts.challenges, 'desafio aguardando resultado', 'desafios aguardando resultado'), n: counts.challenges },
        { id: 'financeiro', icon: <DollarSign size={18} />, label: one(counts.payments, 'reserva com pagamento pendente', 'reservas com pagamento pendente'), n: counts.payments },
        { id: 'reservas', icon: <Calendar size={18} />, label: one(counts.today, 'reserva hoje', 'reservas hoje'), n: counts.today },
        { id: 'formularios', icon: <Vote size={18} />, label: one(counts.forms, 'formulário aberto', 'formulários abertos'), n: counts.forms },
    ];
    const active = items.filter(i => i.n > 0);

    return (
        <div className="mb-4">
            {active.length === 0 ? (
                <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">Tudo em dia: nenhuma pendência.</p>
            ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {active.map(i => (
                        <button
                            key={i.id}
                            onClick={() => onGo(i.id)}
                            className="flex min-h-14 items-center gap-3 rounded-2xl bg-saibro-50 px-4 py-3 text-left text-saibro-700 transition-colors hover:bg-saibro-100 active:scale-[0.99]"
                        >
                            {i.icon}
                            <span className="text-sm"><b>{i.n}</b> {i.label}</span>
                            <ChevronRight size={16} className="ml-auto shrink-0" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
