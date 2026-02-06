import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Championship } from '../types';
import { Trophy, Calendar, Plus, ChevronRight, Loader2, Users } from 'lucide-react';
import { StandardModal } from './StandardModal';
// Sub-component for managing specific tournament details
import { TournamentManager } from './AdminTournamentDetails';

export const AdminTournaments: React.FC = () => {
    const [tournaments, setTournaments] = useState<Championship[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    // Form State
    const [newName, setNewName] = useState('');
    const [newStartDate, setNewStartDate] = useState('');
    const [newEndDate, setNewEndDate] = useState('');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        fetchTournaments();
    }, []);

    const fetchTournaments = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('championships')
            .select('*')
            .order('start_date', { ascending: false });

        if (data) setTournaments(data.map((t: any) => ({
            ...t,
            startDate: t.start_date,
            endDate: t.end_date,
            ptsVictory: t.pts_victory
        })));
        setLoading(false);
    };

    const handleCreate = async () => {
        if (!newName || !newStartDate) return;
        setCreating(true);
        try {
            const { error } = await supabase.from('championships').insert({
                name: newName,
                start_date: newStartDate,
                end_date: newEndDate || null,
                status: 'draft',
                format: 'grupo-mata-mata' // Default for now
            });

            if (error) throw error;

            setShowCreateModal(false);
            fetchTournaments();
            alert('Torneio criado com sucesso!');
        } catch (error: any) {
            console.error('Error creating tournament:', error);
            alert('Erro ao criar torneio.');
        } finally {
            setCreating(false);
        }
    };

    if (selectedTournamentId) {
        return (
            <TournamentManager
                tournamentId={selectedTournamentId}
                onBack={() => {
                    setSelectedTournamentId(null);
                    fetchTournaments();
                }}
            />
        );
    }

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-saibro-500" /></div>;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
                <div>
                    <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
                        <Trophy className="text-saibro-600" />
                        Torneios & Campeonatos
                    </h2>
                    <p className="text-stone-500 text-sm">Gerencie chaves, inscritos e resultados</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="bg-saibro-600 hover:bg-saibro-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all active:scale-95"
                >
                    <Plus size={18} /> Novo Torneio
                </button>
            </div>

            {/* List */}
            <div className="grid gap-4">
                {tournaments.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 bg-stone-50 rounded-2xl border-2 border-dashed border-stone-200">
                        Nenhum torneio encontrado. Crie o primeiro!
                    </div>
                ) : (
                    tournaments.map(t => (
                        <div
                            key={t.id}
                            className="bg-white p-5 rounded-xl border border-stone-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
                            onClick={() => setSelectedTournamentId(t.id)}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg ${t.status === 'active' || t.status === 'ongoing' ? 'bg-green-100 text-green-700' :
                                    t.status === 'finished' ? 'bg-stone-100 text-stone-500' :
                                        'bg-amber-100 text-amber-700'
                                    }`}>
                                    <Trophy size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-stone-800 text-lg group-hover:text-saibro-600 transition-colors">{t.name}</h3>
                                    <div className="flex gap-4 mt-1 text-xs font-medium text-stone-400">
                                        <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(t.startDate!).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}</span>
                                        <span className="uppercase tracking-wide px-2 py-0.5 rounded bg-stone-100 text-stone-500">{t.status}</span>
                                    </div>
                                </div>
                            </div>
                            <ChevronRight className="text-stone-300 group-hover:text-saibro-500" />
                        </div>
                    ))
                )}
            </div>

            {/* Create Modal */}
            {/* Create Modal - Premium Design */}
            <StandardModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} verticalAlign="start">
                <div className="bg-white rounded-[32px] sm:rounded-[40px] w-full max-w-md shadow-2xl overflow-hidden max-h-[85vh] sm:max-h-none flex flex-col">

                        {/* Header */}
                        <div className="px-8 py-6 bg-white/80 backdrop-blur-xl border-b border-stone-100/50 flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-black text-stone-800 tracking-tight">Novo Torneio</h3>
                                <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mt-1">Crie um novo campeonato</p>
                            </div>
                            <button onClick={() => setShowCreateModal(false)} className="p-2 text-stone-400 hover:bg-stone-50 hover:text-stone-600 rounded-full transition-all">
                                <Plus size={24} className="rotate-45" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-8 space-y-6">
                            <div>
                                <label className="flex items-center gap-2 text-[10px] font-black text-saibro-600 uppercase tracking-widest mb-2">
                                    <Trophy size={12} /> Nome do Torneio
                                </label>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    className="w-full px-5 py-4 bg-stone-50 border-none rounded-2xl text-lg font-bold text-stone-800 focus:ring-2 focus:ring-saibro-500 outline-none transition-all placeholder:text-stone-300"
                                    placeholder="Ex: Aberto de Verão 2026"
                                    autoFocus
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="flex items-center gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2">
                                        Inicio
                                    </label>
                                    <input
                                        type="date"
                                        value={newStartDate}
                                        onChange={e => setNewStartDate(e.target.value)}
                                        className="w-full px-4 py-3 bg-stone-50 border-none rounded-2xl text-sm font-bold text-stone-600 focus:ring-2 focus:ring-saibro-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="flex items-center gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2">
                                        Fim (Opcional)
                                    </label>
                                    <input
                                        type="date"
                                        value={newEndDate}
                                        onChange={e => setNewEndDate(e.target.value)}
                                        className="w-full px-4 py-3 bg-stone-50 border-none rounded-2xl text-sm font-bold text-stone-600 focus:ring-2 focus:ring-saibro-500 outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-6 border-t border-stone-100 bg-stone-50/50 flex gap-3">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="flex-1 py-3.5 text-stone-500 font-black text-xs uppercase tracking-wider hover:bg-stone-100 rounded-2xl transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={creating || !newName || !newStartDate}
                                className="flex-2 py-3.5 bg-saibro-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-saibro-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-saibro-200 hover:shadow-xl transition-all active:scale-95"
                            >
                                {creating ? <Loader2 className="animate-spin" /> : 'Criar Torneio'}
                            </button>
                        </div>
                    </div>
                </StandardModal>
        </div>
    );
};
