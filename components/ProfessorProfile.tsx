import React, { useState, useMemo, useEffect } from 'react';
import { User, Professor, NonSocioStudent, Reservation, PlanType } from '../types';
import { Calendar, Users, Plus, Edit, CheckCircle, XCircle, Clock, MapPin, DollarSign, Wallet, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ProfessorProfileProps {
    currentUser: User;
}

interface Court {
    id: string;
    name: string;
    type: string;
}

export const ProfessorProfile: React.FC<ProfessorProfileProps> = ({ currentUser }) => {
    const [activeTab, setActiveTab] = useState<'classes' | 'students'>('classes');
    const [loading, setLoading] = useState(true);
    const [professorRecord, setProfessorRecord] = useState<{ id: string; name: string; bio?: string } | null>(null);
    const [students, setStudents] = useState<NonSocioStudent[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [courts, setCourts] = useState<Court[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);

    // --- MODAL STATES ---
    const [showStudentModal, setShowStudentModal] = useState(false);
    const [editingStudent, setEditingStudent] = useState<NonSocioStudent | null>(null);
    const [studentForm, setStudentForm] = useState<{ name: string, plan: PlanType, expiry: string }>({
        name: '', plan: 'Day Card', expiry: ''
    });

    // Fetch data from Supabase
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            // Fetch professor record
            const { data: profData } = await supabase
                .from('professors')
                .select('id, bio, profiles(name)')
                .eq('user_id', currentUser.id)
                .eq('is_active', true)
                .single();

            if (profData) {
                setProfessorRecord({
                    id: profData.id,
                    name: (profData.profiles as any)?.name || currentUser.name,
                    bio: profData.bio
                });

                // Fetch students for this professor
                const { data: studentsData } = await supabase
                    .from('non_socio_students')
                    .select('*')
                    .eq('professor_id', profData.id);

                setStudents((studentsData || []).map(s => ({
                    id: s.id,
                    name: s.name,
                    planType: s.plan_type,
                    planStatus: s.plan_status,
                    masterExpirationDate: s.master_expiration_date,
                    professorId: s.professor_id
                })));

                // Fetch reservations for this professor
                const { data: resData } = await supabase
                    .from('reservations')
                    .select('*')
                    .eq('professor_id', profData.id)
                    .eq('type', 'Aula')
                    .eq('status', 'active')
                    .order('date', { ascending: true });

                setReservations((resData || []).map(r => ({
                    id: r.id,
                    type: r.type,
                    date: r.date,
                    startTime: r.start_time,
                    endTime: r.end_time,
                    courtId: r.court_id,
                    creatorId: r.creator_id,
                    participantIds: r.participant_ids || [],
                    professorId: r.professor_id,
                    studentType: r.student_type,
                    nonSocioStudentId: r.non_socio_student_id,
                    status: r.status
                })));
            }

            // Fetch courts
            const { data: courtsData } = await supabase
                .from('courts')
                .select('id, name, type');

            setCourts(courtsData || []);

            // Fetch profiles for socio students
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, name, avatar_url');

            setProfiles((profilesData || []).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar_url,
                role: 'socio',
                isActive: true,
                email: '',
                phone: '',
                balance: 0
            } as User)));

            setLoading(false);
        };

        fetchData();
    }, [currentUser.id]);

    // --- DERIVED DATA ---
    const myStudents = students.filter(s => s.professorId === professorRecord?.id);
    const myClasses = reservations
        .filter(r => r.type === 'Aula' && r.professorId === professorRecord?.id && r.status === 'active')
        .sort((a, b) => new Date(a.date + 'T' + a.startTime).getTime() - new Date(b.date + 'T' + b.startTime).getTime());

    const todaysClasses = myClasses.filter(r => r.date === new Date().toISOString().split('T')[0]);

    // --- HANDLERS ---
    const handleSaveStudent = async () => {
        if (!studentForm.name || !professorRecord) return;

        if (editingStudent) {
            const { error } = await supabase
                .from('non_socio_students')
                .update({
                    name: studentForm.name,
                    plan_type: studentForm.plan,
                    master_expiration_date: studentForm.plan === 'Master Card' ? studentForm.expiry : null,
                    plan_status: 'active'
                })
                .eq('id', editingStudent.id);

            if (!error) {
                setStudents(prev => prev.map(s => s.id === editingStudent.id ? {
                    ...s,
                    name: studentForm.name,
                    planType: studentForm.plan,
                    masterExpirationDate: studentForm.plan === 'Master Card' ? studentForm.expiry : undefined,
                    planStatus: 'active'
                } : s));
            }
        } else {
            const { data, error } = await supabase
                .from('non_socio_students')
                .insert({
                    name: studentForm.name,
                    plan_type: studentForm.plan,
                    plan_status: 'active',
                    master_expiration_date: studentForm.plan === 'Master Card' ? studentForm.expiry : null,
                    professor_id: professorRecord.id
                })
                .select()
                .single();

            if (!error && data) {
                setStudents([...students, {
                    id: data.id,
                    name: data.name,
                    planType: data.plan_type,
                    planStatus: data.plan_status,
                    masterExpirationDate: data.master_expiration_date,
                    professorId: data.professor_id
                }]);
            }
        }
        setShowStudentModal(false);
        setEditingStudent(null);
    };

    const openStudentModal = (student?: NonSocioStudent) => {
        if (student) {
            setEditingStudent(student);
            setStudentForm({
                name: student.name,
                plan: student.planType,
                expiry: student.masterExpirationDate || ''
            });
        } else {
            setEditingStudent(null);
            setStudentForm({ name: '', plan: 'Day Card', expiry: '' });
        }
        setShowStudentModal(true);
    };

    const toggleStudentStatus = async (id: string) => {
        const student = students.find(s => s.id === id);
        if (!student) return;

        const newStatus = student.planStatus === 'active' ? 'inactive' : 'active';

        await supabase
            .from('non_socio_students')
            .update({ plan_status: newStatus })
            .eq('id', id);

        setStudents(prev => prev.map(s => s.id === id ? { ...s, planStatus: newStatus } : s));
    };

    const handleDeleteClass = async (id: string) => {
        if (confirm('Cancelar esta aula?')) {
            await supabase
                .from('reservations')
                .update({ status: 'cancelled' })
                .eq('id', id);

            setReservations(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled' } : r));
        }
    };

    if (loading) {
        return (
            <div className="p-4 flex items-center justify-center min-h-[300px]">
                <Loader2 className="animate-spin text-saibro-500" size={32} />
            </div>
        );
    }

    if (!professorRecord) return <div className="p-8 text-center text-stone-500">Perfil de professor não encontrado.</div>;

    return (
        <div className="p-4 pb-24 space-y-6">
            {/* --- HEADER --- */}
            <div className="bg-gradient-to-br from-saibro-600 to-saibro-800 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10" />
                <div className="flex items-center gap-4 relative z-10">
                    <img src={currentUser.avatar} className="w-16 h-16 rounded-full border-2 border-white/50 bg-stone-200 object-cover" alt="" />
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold">{professorRecord.name}</h2>
                            <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">Professor</span>
                        </div>
                        <p className="text-saibro-100 text-sm mt-1">{professorRecord.bio || 'Instrutor'}</p>
                    </div>
                </div>
            </div>

            {/* --- TABS --- */}
            <div className="flex gap-2 bg-stone-100 p-1 rounded-xl">
                <button
                    onClick={() => setActiveTab('classes')}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'classes' ? 'bg-white text-saibro-700 shadow-sm' : 'text-stone-500 hover:text-stone-600'}`}
                >
                    <Calendar size={16} /> Minhas Aulas
                </button>
                <button
                    onClick={() => setActiveTab('students')}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'students' ? 'bg-white text-saibro-700 shadow-sm' : 'text-stone-500 hover:text-stone-600'}`}
                >
                    <Users size={16} /> Alunos (Não Sócios)
                </button>
            </div>

            {/* --- CONTENT: CLASSES --- */}
            {activeTab === 'classes' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-left-4">
                    {/* Today's Highlight */}
                    <div>
                        <h3 className="text-stone-800 font-bold mb-3 flex items-center gap-2">
                            <Clock size={18} className="text-saibro-500" /> Aulas de Hoje
                        </h3>
                        {todaysClasses.length === 0 ? (
                            <div className="bg-white p-6 rounded-xl border border-dashed border-stone-200 text-center text-stone-400">
                                Nenhuma aula agendada para hoje.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {todaysClasses.map(r => {
                                    const court = courts.find(c => c.id === r.courtId);
                                    let studentName = 'TBD';
                                    let studentInfo = '';

                                    if (r.studentType === 'socio' && r.participantIds.length > 0) {
                                        const s = profiles.find(u => u.id === r.participantIds[0]);
                                        studentName = s?.name || 'Sócio';
                                        studentInfo = 'Sócio';
                                    } else if (r.studentType === 'non-socio' && r.nonSocioStudentId) {
                                        const s = students.find(ns => ns.id === r.nonSocioStudentId);
                                        studentName = s?.name || 'Aluno Externo';
                                        studentInfo = s?.planType || 'Externo';
                                    }

                                    return (
                                        <div key={r.id} className="bg-white p-4 rounded-xl border-l-4 border-saibro-500 shadow-sm flex justify-between items-center">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono font-bold text-lg text-stone-800">{r.startTime}</span>
                                                    <span className="text-stone-300">|</span>
                                                    <span className="font-semibold text-stone-700">{studentName}</span>
                                                </div>
                                                <div className="flex gap-2 mt-1 text-xs text-stone-500">
                                                    <span className="flex items-center gap-1"><MapPin size={10} /> {court?.name}</span>
                                                    <span className="bg-stone-100 px-1.5 rounded">{studentInfo}</span>
                                                </div>
                                            </div>
                                            <button onClick={() => handleDeleteClass(r.id)} className="p-2 text-stone-400 hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors">
                                                <XCircle size={20} />
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Upcoming List */}
                    <div>
                        <h3 className="text-stone-800 font-bold mb-3">Próximas Aulas</h3>
                        <div className="space-y-3">
                            {myClasses.filter(r => !todaysClasses.includes(r)).length === 0 && <p className="text-stone-400 text-sm">Sem aulas futuras.</p>}
                            {myClasses.filter(r => !todaysClasses.includes(r)).map(r => {
                                const court = courts.find(c => c.id === r.courtId);
                                let studentName = r.studentType === 'socio'
                                    ? profiles.find(u => u.id === r.participantIds[0])?.name
                                    : students.find(s => s.id === r.nonSocioStudentId)?.name;

                                return (
                                    <div key={r.id} className="bg-white p-3 rounded-lg border border-stone-100 flex justify-between items-center">
                                        <div>
                                            <p className="font-bold text-stone-700 text-sm">{new Date(r.date + 'T12:00:00').toLocaleDateString('pt-BR')} • {r.startTime}</p>
                                            <p className="text-xs text-stone-500">{court?.name} • {studentName}</p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* --- CONTENT: STUDENTS --- */}
            {activeTab === 'students' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                    <button
                        onClick={() => openStudentModal()}
                        className="w-full py-3 border-2 border-dashed border-saibro-300 text-saibro-600 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-saibro-50 transition-colors"
                    >
                        <Plus size={20} /> Cadastrar Novo Aluno
                    </button>

                    <div className="grid gap-3">
                        {myStudents.map(student => {
                            const isMaster = student.planType === 'Master Card';
                            const isActive = student.planStatus === 'active';

                            // Check Validity
                            let isValid = true;
                            if (isMaster && student.masterExpirationDate) {
                                isValid = new Date(student.masterExpirationDate) >= new Date();
                            }
                            const statusColor = isActive && isValid ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50';

                            return (
                                <div key={student.id} className="bg-white p-4 rounded-xl shadow-sm border border-stone-100 relative group overflow-hidden">
                                    <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl text-[10px] font-bold uppercase ${isMaster ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                        {student.planType}
                                    </div>

                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="font-bold text-stone-800 text-lg">{student.name}</h3>
                                    </div>

                                    <div className="flex items-center gap-2 mb-3">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 ${statusColor}`}>
                                            {isActive && isValid ? <CheckCircle size={10} /> : <XCircle size={10} />}
                                            {isActive ? (isValid ? 'Ativo' : 'Vencido') : 'Inativo'}
                                        </span>
                                        {isMaster && student.masterExpirationDate && (
                                            <span className="text-xs text-stone-400">Vence: {new Date(student.masterExpirationDate + 'T12:00:00').toLocaleDateString()}</span>
                                        )}
                                    </div>

                                    <div className="flex gap-2 mt-4 border-t border-stone-50 pt-3">
                                        <button onClick={() => openStudentModal(student)} className="flex-1 py-1.5 text-xs font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded flex items-center justify-center gap-1">
                                            <Edit size={12} /> Editar
                                        </button>
                                        <button onClick={() => toggleStudentStatus(student.id)} className="flex-1 py-1.5 text-xs font-bold text-stone-500 border border-stone-200 hover:bg-stone-50 rounded">
                                            {isActive ? 'Desativar' : 'Ativar'}
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* --- MODAL: STUDENT FORM --- */}
            {showStudentModal && (
                <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 animate-in zoom-in duration-200">
                        <h3 className="text-xl font-bold text-saibro-800">{editingStudent ? 'Editar Aluno' : 'Novo Aluno'}</h3>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Nome</label>
                                <input
                                    type="text"
                                    value={studentForm.name}
                                    onChange={e => setStudentForm({ ...studentForm, name: e.target.value })}
                                    className="w-full p-2 border border-stone-200 rounded-lg"
                                    placeholder="Nome completo"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Plano</label>
                                <div className="flex gap-2">
                                    {['Day Card', 'Master Card'].map(p => (
                                        <button key={p} onClick={() => setStudentForm({ ...studentForm, plan: p as any })}
                                            className={`flex-1 py-2 rounded-lg text-xs font-bold border ${studentForm.plan === p ? 'bg-saibro-50 border-saibro-500 text-saibro-700' : 'border-stone-200 text-stone-400'}`}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {studentForm.plan === 'Master Card' && (
                                <div className="animate-in fade-in slide-in-from-top-2">
                                    <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Validade do Plano</label>
                                    <input
                                        type="date"
                                        value={studentForm.expiry}
                                        onChange={e => setStudentForm({ ...studentForm, expiry: e.target.value })}
                                        className="w-full p-2 border border-stone-200 rounded-lg"
                                    />
                                    <p className="text-[10px] text-stone-400 mt-1">Geralmente 30 dias a partir do pagamento.</p>
                                </div>
                            )}

                            {studentForm.plan === 'Day Card' && (
                                <div className="bg-stone-50 p-3 rounded-lg flex items-center gap-2 text-stone-500 text-xs">
                                    <DollarSign size={16} />
                                    <span>Valor por aula: <strong>R$ 50,00</strong></span>
                                </div>
                            )}
                            {studentForm.plan === 'Master Card' && (
                                <div className="bg-stone-50 p-3 rounded-lg flex items-center gap-2 text-stone-500 text-xs">
                                    <Wallet size={16} />
                                    <span>Mensalidade: <strong>R$ 200,00</strong></span>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 pt-4 border-t border-stone-100">
                            <button onClick={() => setShowStudentModal(false)} className="flex-1 py-3 text-stone-500 font-bold hover:bg-stone-50 rounded-xl">Cancelar</button>
                            <button onClick={handleSaveStudent} className="flex-1 py-3 bg-saibro-600 text-white rounded-xl font-bold shadow-md hover:bg-saibro-700">Salvar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};