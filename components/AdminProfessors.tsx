import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Professor, NonSocioStudent } from '../types';
import { Users, GraduationCap, Calendar, DollarSign, Loader2, ChevronRight, ChevronDown } from 'lucide-react';

export const AdminProfessors: React.FC = () => {
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [students, setStudents] = useState<NonSocioStudent[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedProf, setExpandedProf] = useState<string | null>(null);

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

            // Map database fields to TS types if needed, though simple select * usually matches if names align.
            // Adjusting for potential snake_case from DB if not handled by client:
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
                planType: s.plan_type,
                planStatus: s.plan_status,
                masterExpirationDate: s.master_expiration_date,
                professorId: s.professor_id
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

    const getProfessorStats = (profId: string) => {
        const profStudents = students.filter(s => s.professor_id === profId || s.professorId === profId);
        const activeStudents = profStudents.filter(s => s.planStatus === 'active');

        // Revenue estimation (simplified: 200 per active student)
        // Ideally we should sum actual payments, but this is a quick projection
        const estimatedRevenue = activeStudents.length * 200;

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
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-stone-100 flex items-center gap-4">
                    <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-stone-500 uppercase font-bold">Alunos Vinculados</p>
                        <p className="text-2xl font-black text-stone-800">{students.length}</p>
                    </div>
                </div>
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
                            <div key={prof.id} className="transition-colors hover:bg-stone-50">
                                <div
                                    className="p-6 cursor-pointer flex items-center justify-between"
                                    onClick={() => setExpandedProf(isExpanded ? null : prof.id)}
                                >
                                    <div className="flex items-center gap-4">
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

                                    <div className="flex items-center gap-8">
                                        <div className="text-right hidden md:block">
                                            <p className="text-[10px] text-stone-400 uppercase font-bold">Alunos Ativos</p>
                                            <p className="font-bold text-stone-800">{stats.active} <span className="text-stone-400 text-xs font-normal">/ {stats.total}</span></p>
                                        </div>
                                        <div className="text-right hidden md:block">
                                            <p className="text-[10px] text-stone-400 uppercase font-bold">Gerado</p>
                                            <p className="font-bold text-green-600">R$ {stats.revenue.toLocaleString('pt-BR')}</p>
                                        </div>
                                        <div className="text-stone-400">
                                            {isExpanded ? <ChevronDown /> : <ChevronRight />}
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Details - Students List */}
                                {isExpanded && (
                                    <div className="bg-stone-50 p-6 border-t border-stone-100 animate-in slide-in-from-top-2 duration-200">
                                        <h4 className="font-bold text-sm text-stone-500 uppercase mb-4 flex items-center gap-2">
                                            <Users size={16} /> Lista de Alunos
                                        </h4>

                                        {students.filter(s => s.professor_id === prof.id || s.professorId === prof.id).length === 0 ? (
                                            <p className="text-stone-400 italic text-sm">Nenhum aluno vinculado.</p>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                {students
                                                    .filter(s => s.professor_id === prof.id || s.professorId === prof.id)
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
        </div>
    );
};