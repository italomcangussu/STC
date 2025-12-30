import React, { useState, useEffect } from 'react';
import { UserPlus, Trash2, User as UserIcon, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Professor {
    id: string;
    userId: string;
    name: string;
    isActive: boolean;
    bio?: string;
}

interface UserProfile {
    id: string;
    name: string;
    role: string;
    isProfessor?: boolean;
}

export const AdminProfessors: React.FC = () => {
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);

    // Fetch data from Supabase
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            // Fetch professors
            const { data: profData } = await supabase
                .from('professors')
                .select('id, user_id, bio, is_active, profiles(name)')
                .eq('is_active', true);

            const profs: Professor[] = (profData || []).map(p => ({
                id: p.id,
                userId: p.user_id,
                name: (p.profiles as any)?.name || 'Professor',
                isActive: p.is_active,
                bio: p.bio
            }));
            setProfessors(profs);

            // Fetch profiles
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, name, role, is_professor')
                .in('role', ['socio', 'admin']);

            setUsers((profilesData || []).map(u => ({
                id: u.id,
                name: u.name,
                role: u.role,
                isProfessor: u.is_professor
            })));

            setLoading(false);
        };

        fetchData();
    }, []);

    const handleAddProfessor = async (user: UserProfile) => {
        if (professors.some(p => p.userId === user.id)) return;

        // Add to professors table
        const { data, error } = await supabase
            .from('professors')
            .insert({
                user_id: user.id,
                name: user.name,
                bio: 'Instrutor do clube.',
                is_active: true
            })
            .select()
            .single();

        if (error) {
            console.error('Error adding professor:', error);
            alert(`Erro ao adicionar professor: ${error.message || error.code || 'Erro desconhecido'}`);
            return;
        }

        // Update user's isProfessor flag
        await supabase
            .from('profiles')
            .update({ is_professor: true })
            .eq('id', user.id);

        setProfessors([...professors, {
            id: data.id,
            userId: user.id,
            name: user.name,
            isActive: true,
            bio: 'Instrutor do clube.'
        }]);
        setUsers(users.map(u => u.id === user.id ? { ...u, isProfessor: true } : u));
    };

    const handleRemoveProfessor = async (profId: string) => {
        const prof = professors.find(p => p.id === profId);
        if (!prof) return;

        // Deactivate professor
        const { error } = await supabase
            .from('professors')
            .update({ is_active: false })
            .eq('id', profId);

        if (error) {
            console.error('Error removing professor:', error);
            alert('Erro ao remover professor.');
            return;
        }

        // Update user's isProfessor flag
        await supabase
            .from('profiles')
            .update({ is_professor: false })
            .eq('id', prof.userId);

        setProfessors(professors.filter(p => p.id !== profId));
        setUsers(users.map(u => u.id === prof.userId ? { ...u, isProfessor: false } : u));
    };

    const availableUsers = users.filter(u =>
        u.role !== 'lanchonete' &&
        !professors.some(p => p.userId === u.id) &&
        u.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return (
            <div className="p-4 flex items-center justify-center min-h-[200px]">
                <Loader2 className="animate-spin text-saibro-500" size={32} />
            </div>
        );
    }

    return (
        <div className="p-4 space-y-6 pb-24">
            <h2 className="text-2xl font-bold text-saibro-900">Gerenciar Professores</h2>

            {/* Active Professors List */}
            <div className="space-y-4">
                <h3 className="font-bold text-stone-700">Professores Ativos</h3>
                {professors.length === 0 && <p className="text-stone-400 text-sm">Nenhum professor cadastrado.</p>}
                {professors.map(prof => (
                    <div key={prof.id} className="bg-white p-4 rounded-xl shadow-sm border border-saibro-200 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-saibro-100 flex items-center justify-center text-saibro-600 font-bold">
                                {prof.name[0]}
                            </div>
                            <div>
                                <h4 className="font-bold text-stone-800">{prof.name}</h4>
                                <span className="text-xs text-green-600 font-bold bg-green-50 px-2 rounded-full">Ativo</span>
                            </div>
                        </div>
                        <button onClick={() => handleRemoveProfessor(prof.id)} className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={18} />
                        </button>
                    </div>
                ))}
            </div>

            {/* Add New Section */}
            <div className="bg-stone-50 p-5 rounded-2xl border border-stone-200 mt-8">
                <h3 className="font-bold text-stone-800 mb-4 flex items-center gap-2"><UserPlus size={20} className="text-saibro-500" /> Adicionar Professor</h3>

                <input
                    type="text"
                    placeholder="Buscar sócio..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full p-2 border border-stone-200 rounded-lg mb-4 text-sm"
                />

                <div className="max-h-60 overflow-y-auto space-y-2">
                    {availableUsers.map(user => (
                        <div key={user.id} className="bg-white p-3 rounded-xl border border-stone-100 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <UserIcon size={16} className="text-stone-400" />
                                <span className="text-sm font-medium text-stone-700">{user.name}</span>
                            </div>
                            <button onClick={() => handleAddProfessor(user)} className="text-xs font-bold bg-saibro-600 text-white px-3 py-1.5 rounded-lg hover:bg-saibro-700">
                                Promover
                            </button>
                        </div>
                    ))}
                    {availableUsers.length === 0 && <p className="text-stone-400 text-xs text-center py-2">Nenhum sócio encontrado.</p>}
                </div>
            </div>
        </div>
    );
};