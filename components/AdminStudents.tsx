import React, { useState, useEffect, useMemo } from 'react';
import {
    Users, Search, Filter, Calendar, TrendingUp, Info, ArrowRight, Loader2,
    CheckCircle, AlertCircle, Clock, Award, Trophy
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NonSocioStudent, Reservation } from '../types';

export const AdminStudents: React.FC = () => {
    const [students, setStudents] = useState<NonSocioStudent[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<string>('all');
    const [selectedStudent, setSelectedStudent] = useState<NonSocioStudent | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Students
            const { data: studentsData } = await supabase
                .from('non_socio_students')
                .select('*')
                .order('name');

            if (studentsData) setStudents(studentsData.map(s => ({
                id: s.id,
                name: s.name,
                planType: s.plan_type,
                planStatus: s.plan_status,
                masterExpirationDate: s.master_expiration_date,
                professorId: s.professor_id
            })));

            // 2. Fetch Reservations for stats
            const { data: resData } = await supabase
                .from('reservations')
                .select('*')
                .neq('status', 'cancelled');

            if (resData) setReservations(resData.map(r => ({
                id: r.id,
                date: r.date,
                type: r.type,
                nonSocioStudentId: r.non_socio_student_id,
                status: r.status
            } as any)));

        } catch (error) {
            console.error('Error fetching students:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredStudents = useMemo(() => {
        return students.filter(s => {
            const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesType = filterType === 'all' || s.planType === filterType;
            return matchesSearch && matchesType;
        });
    }, [students, searchTerm, filterType]);

    const getStudentStats = (studentId: string) => {
        const studentRes = reservations.filter(r => r.nonSocioStudentId === studentId);
        const totalVisits = studentRes.length;
        const lastVisit = studentRes.length > 0
            ? studentRes.sort((a, b) => b.date.localeCompare(a.date))[0].date
            : null;

        // Classes vs Play
        const classes = studentRes.filter(r => r.type === 'Aula').length;
        const play = studentRes.filter(r => r.type === 'Play').length;

        return { totalVisits, lastVisit, classes, play };
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-[50vh]">
                <Loader2 className="animate-spin text-saibro-500" size={48} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 pb-40 space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-linear-to-br from-saibro-500 to-orange-600 rounded-2xl shadow-lg shadow-orange-100">
                        <Users size={28} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-stone-800">Gestão de Alunos</h1>
                        <p className="text-sm text-stone-500">Alunos não-sócios e visitantes</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar aluno..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-500 outline-none w-full sm:w-64"
                        />
                    </div>
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="px-4 py-2 bg-white border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-saibro-500"
                    >
                        <option value="all">Todos os Planos</option>
                        <option value="Card Mensal">Card Mensal</option>
                        <option value="Daycard">Daycard</option>
                        <option value="Experimental">Experimental</option>
                    </select>
                </div>
            </div>

            {/* Students List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredStudents.map((student, idx) => {
                    const stats = getStudentStats(student.id);
                    return (
                        <div
                            key={student.id}
                            onClick={() => setSelectedStudent(student)}
                            className="bg-white rounded-2xl p-4 border border-stone-100 shadow-sm hover:shadow-md hover:border-saibro-200 transition-all cursor-pointer group animate-slide-in opacity-0"
                            style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'forwards' }}
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="space-y-1">
                                    <h4 className="font-bold text-lg text-stone-800 group-hover:text-saibro-600 transition-colors uppercase">{student.name}</h4>
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${student.planType === 'Card Mensal' ? 'bg-orange-100 text-orange-700' :
                                        student.planType === 'Experimental' ? 'bg-purple-100 text-purple-700' :
                                            'bg-blue-100 text-blue-700'
                                        }`}>
                                        {student.planType}
                                    </span>
                                </div>
                                <div className="p-2 bg-stone-50 rounded-xl">
                                    <TrendingUp size={16} className="text-stone-400" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-stone-50">
                                <div>
                                    <p className="text-[10px] text-stone-400 font-bold uppercase">Frequência</p>
                                    <p className="text-lg font-black text-stone-700">{stats.totalVisits} <span className="text-xs font-normal">idas</span></p>
                                </div>
                                <div>
                                    <p className="text-[10px] text-stone-400 font-bold uppercase">Última Ida</p>
                                    <p className="text-sm font-bold text-stone-600">{stats.lastVisit ? new Date(stats.lastVisit).toLocaleDateString() : 'Nunca'}</p>
                                </div>
                            </div>

                            <div className="mt-4 flex items-center justify-between text-saibro-600 font-bold text-xs pt-2">
                                <span>Ver detalhes completos</span>
                                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                        </div>
                    );
                })}

                {filteredStudents.length === 0 && (
                    <div className="col-span-full py-12 text-center bg-white rounded-2xl border-2 border-dashed border-stone-100">
                        <Users className="mx-auto text-stone-200 mb-2" size={48} />
                        <p className="text-stone-400 font-medium">Nenhum aluno encontrado.</p>
                    </div>
                )}
            </div>

            {/* Student Detail Modal */}
            {selectedStudent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-[32px] w-full max-w-lg max-h-[90vh] overflow-y-auto relative shadow-2xl animate-zoom-smooth">
                        <div className="bg-saibro-600 p-8 text-white relative">
                            <button
                                onClick={() => setSelectedStudent(null)}
                                className="absolute top-6 right-6 p-2 bg-white/20 hover:bg-white/30 rounded-xl transition-colors"
                            >
                                <Users size={20} />
                            </button>
                            <h2 className="text-3xl font-black uppercase tracking-tight">{selectedStudent.name}</h2>
                            <div className="flex items-center gap-3 mt-2">
                                <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
                                    {selectedStudent.planType}
                                </span>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${selectedStudent.planStatus === 'active' ? 'bg-green-400 text-green-950' : 'bg-red-400 text-red-950'
                                    }`}>
                                    {selectedStudent.planStatus === 'active' ? 'Ativo' : 'Inativo'}
                                </span>
                            </div>
                        </div>

                        <div className="p-8 overflow-y-auto custom-scrollbar max-h-[calc(90vh-160px)]">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                                <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                                    <div className="p-2 bg-saibro-100 text-saibro-600 rounded-lg w-fit mb-2">
                                        <TrendingUp size={16} />
                                    </div>
                                    <p className="text-[10px] text-stone-400 font-bold uppercase">Total Idas</p>
                                    <p className="text-2xl font-black text-stone-800">{getStudentStats(selectedStudent.id).totalVisits}</p>
                                </div>
                                <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                                    <div className="p-2 bg-blue-100 text-blue-600 rounded-lg w-fit mb-2">
                                        <Calendar size={16} />
                                    </div>
                                    <p className="text-[10px] text-stone-400 font-bold uppercase">Aulas</p>
                                    <p className="text-2xl font-black text-stone-800">{getStudentStats(selectedStudent.id).classes}</p>
                                </div>
                                <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                                    <div className="p-2 bg-green-100 text-green-600 rounded-lg w-fit mb-2">
                                        <Award size={16} />
                                    </div>
                                    <p className="text-[10px] text-stone-400 font-bold uppercase">Play</p>
                                    <p className="text-2xl font-black text-stone-800">{getStudentStats(selectedStudent.id).play}</p>
                                </div>
                                <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                                    <div className="p-2 bg-orange-100 text-orange-600 rounded-lg w-fit mb-2">
                                        <Clock size={16} />
                                    </div>
                                    <p className="text-[10px] text-stone-400 font-bold uppercase">Expira em</p>
                                    <p className="text-sm font-black text-stone-800">
                                        {selectedStudent.masterExpirationDate
                                            ? new Date(selectedStudent.masterExpirationDate).toLocaleDateString()
                                            : 'N/A'}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <h4 className="font-bold text-stone-800 flex items-center gap-2">
                                    <History className="text-saibro-500" size={18} /> Histórico Recente
                                </h4>
                                <div className="space-y-3">
                                    {reservations
                                        .filter(r => r.nonSocioStudentId === selectedStudent.id)
                                        .sort((a, b) => b.date.localeCompare(a.date))
                                        .slice(0, 10)
                                        .map(res => (
                                            <div key={res.id} className="flex items-center justify-between p-4 bg-white border border-stone-100 rounded-xl shadow-xs">
                                                <div className="flex items-center gap-4">
                                                    <div className={`p-2 rounded-lg ${res.type === 'Aula' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                                                        {res.type === 'Aula' ? <GraduationCap size={18} /> : <Trophy size={18} />}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-stone-800">{res.type}</p>
                                                        <p className="text-xs text-stone-400">{new Date(res.date).toLocaleDateString()}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-[10px] font-black px-2 py-0.5 bg-stone-100 text-stone-600 rounded-full uppercase tracking-tighter">
                                                        Realizada
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    {reservations.filter(r => r.nonSocioStudentId === selectedStudent.id).length === 0 && (
                                        <p className="text-sm text-stone-400 italic">Nenhuma atividade registrada.</p>
                                    )}
                                </div>
                            </div>

                            <button
                                onClick={() => setSelectedStudent(null)}
                                className="w-full mt-8 py-4 bg-stone-100 hover:bg-stone-200 text-stone-600 font-black uppercase tracking-widest rounded-2xl transition-all"
                            >
                                Fechar Detalhes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const History = ({ className, size }: { className?: string, size?: number }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size || 24}
        height={size || 24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
    </svg>
);

const GraduationCap = ({ className, size }: { className?: string, size?: number }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size || 24}
        height={size || 24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
        <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
);
