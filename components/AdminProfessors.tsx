import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Professor, NonSocioStudent } from '../types';
import { Users, GraduationCap, Calendar, DollarSign, Loader2, ChevronRight, ChevronDown, Plus, Edit, Trash2 } from 'lucide-react';
import { StandardModal } from './StandardModal';

// --- Modal Component ---
interface ProfessorModalProps {
    professor?: Professor | null;
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
}

const ProfessorModal: React.FC<ProfessorModalProps> = ({ professor, onClose, onSave }) => {
    const [name, setName] = useState(professor?.name || '');
    const [bio, setBio] = useState(professor?.bio || '');
    const [isActive, setIsActive] = useState(professor?.isActive ?? true);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        if (!name) return;
        setSaving(true);
        try {
            await onSave({ name, bio, is_active: isActive });
            onClose();
        } catch (error) {
            console.error(error);
            alert('Erro ao salvar.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <StandardModal isOpen={true} onClose={onClose}>
            <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
                <h3 className="text-xl font-bold text-stone-800">{professor ? 'Editar Professor' : 'Novo Professor'}</h3>

                <div className="space-y-3">
                    <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Nome</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-3 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-saibro-500"
                            placeholder="Nome do Professor"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Bio / Especialidade</label>
                        <textarea
                            value={bio}
                            onChange={e => setBio(e.target.value)}
                            className="w-full p-3 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-saibro-500 h-24 resize-none"
                            placeholder="Ex: Especialista em Tênis Avançado..."
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={isActive}
                            onChange={e => setIsActive(e.target.checked)}
                            className="w-5 h-5 text-saibro-600 rounded"
                            id="isActive"
                        />
                        <label htmlFor="isActive" className="text-stone-700 font-medium cursor-pointer">Professor Ativo</label>
                    </div>
                </div>

                <div className="flex gap-3 pt-4">
                    <button onClick={onClose} className="flex-1 py-3 border border-stone-200 rounded-xl font-bold text-stone-500 hover:bg-stone-50">Cancelar</button>
                    <button
                        onClick={handleSubmit}
                        disabled={saving || !name}
                        className="flex-1 py-3 bg-saibro-600 text-white rounded-xl font-bold hover:bg-saibro-700 disabled:opacity-50 flex justify-center"
                    >
                        {saving ? <Loader2 className="animate-spin" /> : 'Salvar'}
                    </button>
                </div>
            </div>
        </StandardModal>
    );
};

export const AdminProfessors: React.FC = () => {
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [students, setStudents] = useState<NonSocioStudent[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedProf, setExpandedProf] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [editingProf, setEditingProf] = useState<Professor | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch Professors
            const { data: profs, error: profError } = await supabase
                .from('professors')
                .select('*')
                .order('name');

            if (profError) throw profError;

            // Fetch Students linked to professors
            const { data: studss, error: studError } = await supabase
                .from('non_socio_students')
                .select('*')
                .not('professor_id', 'is', null);

            if (studError) throw studError;

            // Map database fields to TS types
            const mappedProfs = (profs || []).map((p: any) => ({
                id: p.id,
                userId: p.user_id,
                name: p.name,
                isActive: p.is_active,
                bio: p.bio
            }));

            const mappedStudents = (studss || []).map((s: any) => ({
                id: s.id,
                name: s.name,
                phone: s.phone,
                planType: s.plan_type,
                planStatus: s.plan_status,
                masterExpirationDate: s.master_expiration_date,
                professorId: s.professor_id,
                studentType: s.student_type || 'regular',
                responsibleSocioId: s.responsible_socio_id,
                relationshipType: s.relationship_type
            }));

            setProfessors(mappedProfs);
            setStudents(mappedStudents);

        } catch (error) {
            console.error('Error fetching professors data:', error);
            alert('Erro ao carregar dados de professores.');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveProfessor = async (data: any) => {
        if (editingProf) {
            await supabase.from('professors').update(data).eq('id', editingProf.id);
        } else {
            await supabase.from('professors').insert(data);
        }
        fetchData();
    };

    const handleDeleteProfessor = async (id: string) => {
        if (!confirm('Tem certeza que deseja remover este professor?')) return;
        const { error } = await supabase.from('professors').delete().eq('id', id);
        if (error) {
            alert('Não é possível excluir professores com alunos vinculados.');
        } else {
            fetchData();
        }
    };

    const getProfessorStats = (profId: string) => {
        const profStudents = students.filter(s => s.professorId === profId);
        const activeStudents = profStudents.filter(s => s.planStatus === 'active');
        const estimatedRevenue = activeStudents.reduce((sum, s) => {
            if (s.planType === 'Card Mensal') return sum + 200;
            if (s.planType === 'Day Card' || s.planType === 'Day Card Experimental') return sum + 50;
            return sum; // Dependente = R$ 0
        }, 0);

        return {
            total: profStudents.length,
            active: activeStudents.length,
            revenue: estimatedRevenue
        };
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-saibro-600" size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-stone-100 flex items-center gap-4">
                    <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                        <GraduationCap size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-stone-500 uppercase font-bold">Total Professores</p>
                        <p className="text-2xl font-black text-stone-800">{professors.length}</p>
                    </div>
                </div>
                {/* ... other stats ... */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-stone-100 flex items-center gap-4">
                    <div className="p-3 bg-green-100 text-green-600 rounded-xl">
                        <DollarSign size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-stone-500 uppercase font-bold">Receita Estimada (Mensal)</p>
                        <p className="text-2xl font-black text-stone-800">
                            R$ {professors.reduce((acc, p) => acc + getProfessorStats(p.id).revenue, 0).toLocaleString('pt-BR')}
                        </p>
                    </div>
                </div>

                {/* Add Button */}
                <button
                    onClick={() => { setEditingProf(null); setShowModal(true); }}
                    className="bg-saibro-600 hover:bg-saibro-700 text-white p-5 rounded-2xl shadow-lg shadow-saibro-200 flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
                >
                    <Plus size={24} />
                    <span className="font-bold text-sm">Novo Professor</span>
                </button>
            </div>

            {/* Professors List */}
            <div className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
                <div className="p-6 border-b border-stone-100">
                    <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                        <GraduationCap className="text-saibro-600" />
                        Corpo Docente
                    </h2>
                </div>

                <div className="divide-y divide-stone-100">
                    {professors.map(prof => {
                        const stats = getProfessorStats(prof.id);
                        const isExpanded = expandedProf === prof.id;

                        return (
                            <div key={prof.id} className="transition-colors hover:bg-stone-50 group">
                                <div className="p-6 flex items-center justify-between">
                                    <div
                                        className="flex items-center gap-4 cursor-pointer flex-1"
                                        onClick={() => setExpandedProf(isExpanded ? null : prof.id)}
                                    >
                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${prof.isActive ? 'bg-saibro-100 text-saibro-700' : 'bg-stone-200 text-stone-500'}`}>
                                            {prof.name.charAt(0)}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-stone-800 text-lg">{prof.name}</h3>
                                            <p className={`text-xs font-bold uppercase tracking-wide ${prof.isActive ? 'text-green-600' : 'text-stone-400'}`}>
                                                {prof.isActive ? 'Ativo' : 'Inativo'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <div className="hidden md:block text-right mr-4">
                                            <p className="text-[10px] text-stone-400 uppercase font-bold">Alunos</p>
                                            <p className="font-bold text-stone-800">{stats.active}</p>
                                        </div>

                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => { setEditingProf(prof); setShowModal(true); }}
                                                className="p-2 text-stone-400 hover:text-saibro-600 hover:bg-white rounded-lg"
                                            >
                                                <Edit size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteProfessor(prof.id)}
                                                className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>

                                        <button
                                            onClick={() => setExpandedProf(isExpanded ? null : prof.id)}
                                            className="text-stone-400"
                                        >
                                            {isExpanded ? <ChevronDown /> : <ChevronRight />}
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded Details - Students List */}
                                {isExpanded && (
                                    <div className="bg-stone-50 p-6 border-t border-stone-100 animate-in slide-in-from-top-2 duration-200">
                                        <h4 className="font-bold text-sm text-stone-500 uppercase mb-4 flex items-center gap-2">
                                            <Users size={16} /> Lista de Alunos
                                        </h4>

                                        {students.filter(s => s.professorId === prof.id).length === 0 ? (
                                            <p className="text-stone-400 italic text-sm">Nenhum aluno vinculado.</p>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                {students
                                                    .filter(s => s.professorId === prof.id)
                                                    .map(student => (
                                                        <div key={student.id} className="bg-white p-3 rounded-lg border border-stone-200 shadow-sm flex justify-between items-center">
                                                            <div>
                                                                <p className="font-bold text-stone-800">{student.name}</p>
                                                                <p className="text-xs text-stone-500">{student.planType}</p>
                                                            </div>
                                                            <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${student.planStatus === 'active'
                                                                ? 'bg-green-100 text-green-700'
                                                                : 'bg-red-100 text-red-700'
                                                                }`}>
                                                                {student.planStatus === 'active' ? 'Ativo' : 'Inativo'}
                                                            </div>
                                                        </div>
                                                    ))
                                                }
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {showModal && (
                <ProfessorModal
                    professor={editingProf}
                    onClose={() => setShowModal(false)}
                    onSave={handleSaveProfessor}
                />
            )}
        </div>
    );
};