import React, { useState, useMemo, useEffect } from 'react';
import { User, NonSocioStudent, Reservation, Court, RelationshipType } from '../types';
import { Calendar, Users, Plus, Edit, CheckCircle, XCircle, Clock, MapPin, DollarSign, Loader2, AlertCircle, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getNowInFortaleza } from '../utils';

type RegularPlanType = 'Day Card' | 'Day Card Experimental' | 'Card Mensal';

const getClassNonSocioIds = (res: Reservation): string[] => {
    if (res.nonSocioStudentIds && res.nonSocioStudentIds.length > 0) return res.nonSocioStudentIds;
    if (res.nonSocioStudentId) return [res.nonSocioStudentId];
    if (res.type === 'Aula' && res.studentType === 'non-socio' && res.participantIds.length > 0) {
        return res.participantIds;
    }
    return [];
};

const getClassSocioIds = (res: Reservation): string[] => {
    if (res.type === 'Aula' && res.studentType === 'non-socio') {
        if ((!res.nonSocioStudentIds || res.nonSocioStudentIds.length === 0) && !res.nonSocioStudentId) {
            return [];
        }
    }
    return res.participantIds || [];
};

// --- HELPER: Student Card ---
const StudentCard: React.FC<{ student: NonSocioStudent, onEdit: (s: NonSocioStudent) => void, onToggleStatus: (id: string) => void }> = ({ student, onEdit, onToggleStatus }) => {
    const isMaster = student.planType === 'Card Mensal';
    const isDependent = student.studentType === 'dependent';
    const isActive = student.planStatus === 'active';
    const isExpired = isMaster && (!student.masterExpirationDate || new Date(student.masterExpirationDate + 'T00:00:00') < getNowInFortaleza());

    let statusLabel = 'Ativo';
    let statusColor = 'text-green-600 bg-green-50';
    let icon = <CheckCircle size={12} />;

    if (isDependent) {
        statusLabel = 'Dependente - Sem Cobrança';
        statusColor = 'text-blue-600 bg-blue-50';
        icon = <UserPlus size={12} />;
    } else if (!isActive) {
        statusLabel = 'Inativo / Aguardando Pagamento';
        statusColor = 'text-orange-600 bg-orange-50';
        icon = <Clock size={12} />;
    } else if (isExpired) {
        statusLabel = 'Vencido';
        statusColor = 'text-red-500 bg-red-50';
        icon = <XCircle size={12} />;
    }

    const planBadgeColor = isMaster
        ? 'bg-purple-100 text-purple-700'
        : student.planType === 'Day Card Experimental'
            ? 'bg-amber-100 text-amber-700'
            : isDependent
                ? 'bg-blue-100 text-blue-700'
                : 'bg-stone-100 text-stone-600';

    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100 relative group overflow-hidden">
            <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-xl text-[10px] font-bold uppercase ${planBadgeColor}`}>
                {student.planType}
            </div>

            <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-stone-800 text-lg">{student.name}</h3>
            </div>

            <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1 ${statusColor}`}>
                    {icon} {statusLabel}
                </span>
                {isMaster && (
                    <span className="text-xs text-stone-400">
                        {student.masterExpirationDate ? `Vence: ${new Date(student.masterExpirationDate + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}` : 'Sem validade definida'}
                    </span>
                )}
            </div>

            <div className="flex gap-2 mt-4 border-t border-stone-50 pt-3">
                <button onClick={() => onEdit(student)} className="flex-1 py-1.5 text-xs font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded flex items-center justify-center gap-1">
                    <Edit size={12} /> Editar
                </button>
                {!isDependent && (
                    <button onClick={() => onToggleStatus(student.id)} className="flex-1 py-1.5 text-xs font-bold text-stone-500 border border-stone-200 hover:bg-stone-50 rounded">
                        {isActive ? 'Desativar' : 'Ativar'}
                    </button>
                )}
            </div>
        </div>
    );
};

interface ProfessorProfileProps {
    currentUser: User;
}

export const ProfessorProfile: React.FC<ProfessorProfileProps> = ({ currentUser }) => {
    const [activeTab, setActiveTab] = useState<'classes' | 'students'>('classes');
    const [loading, setLoading] = useState(true);
    const [professorRecord, setProfessorRecord] = useState<{ id: string; name: string; bio?: string } | null>(null);
    const [students, setStudents] = useState<NonSocioStudent[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [courts, setCourts] = useState<Court[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [socios, setSocios] = useState<User[]>([]);

    // --- MODAL STATES ---
    const [showStudentModal, setShowStudentModal] = useState(false);
    const [editingStudent, setEditingStudent] = useState<NonSocioStudent | null>(null);
    const [studentForm, setStudentForm] = useState({
        name: '',
        phone: '',
        studentType: 'regular' as 'regular' | 'dependent',
        planType: 'Day Card' as RegularPlanType,
        responsibleSocioId: '',
        relationshipType: '' as RelationshipType | ''
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
                    phone: s.phone,
                    planType: s.plan_type,
                    planStatus: s.plan_status,
                    masterExpirationDate: s.master_expiration_date,
                    professorId: s.professor_id,
                    studentType: s.student_type || 'regular',
                    responsibleSocioId: s.responsible_socio_id,
                    relationshipType: s.relationship_type
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
                    nonSocioStudentIds: r.non_socio_student_ids || [],
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

            // Fetch socios for dependent student selection
            const { data: sociosData } = await supabase
                .from('profiles')
                .select('id, name, email, phone, role')
                .eq('role', 'socio')
                .eq('is_active', true)
                .order('name');

            if (sociosData) {
                setSocios(sociosData.map(u => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    phone: u.phone,
                    role: u.role,
                    balance: 0,
                    isActive: true
                })));
            }

            setLoading(false);
        };

        fetchData();
    }, [currentUser.id]);

    // --- DERIVED DATA ---
    const myStudents = students.filter(s => s.professorId === professorRecord?.id);
    const myClasses = reservations
        .filter(r => r.type === 'Aula' && r.professorId === professorRecord?.id && r.status === 'active')
        .sort((a, b) => new Date(a.date + 'T' + a.startTime).getTime() - new Date(b.date + 'T' + b.startTime).getTime());

    const today = getNowInFortaleza().toISOString().split('T')[0];
    const todaysClasses = myClasses.filter(r => r.date === today);

    // --- HANDLERS ---
    const handleSaveStudent = async () => {
        if (!studentForm.name?.trim() || !professorRecord) {
            return alert('O nome do aluno é obrigatório.');
        }

        if (studentForm.studentType === 'dependent') {
            if (!studentForm.responsibleSocioId) {
                return alert('Selecione o sócio responsável pelo dependente.');
            }
            if (!studentForm.relationshipType) {
                return alert('Selecione o tipo de relacionamento.');
            }
        }

        const studentData = {
            name: studentForm.name.trim(),
            phone: studentForm.phone || null,
            professor_id: studentForm.studentType === 'regular' ? professorRecord.id : null,
            student_type: studentForm.studentType,
            responsible_socio_id: studentForm.studentType === 'dependent' ? studentForm.responsibleSocioId : null,
            relationship_type: studentForm.studentType === 'dependent' ? studentForm.relationshipType : null,
            plan_type: studentForm.studentType === 'dependent' ? 'Dependente' : studentForm.planType,
            plan_status: studentForm.studentType === 'dependent' ? 'active' : 'inactive'
        };

        if (editingStudent) {
            const { error } = await supabase
                .from('non_socio_students')
                .update(studentData)
                .eq('id', editingStudent.id);

            if (error) {
                alert('Erro ao salvar: ' + error.message);
                return;
            }
            setStudents(prev => prev.map(s => s.id === editingStudent.id ? {
                ...s,
                name: studentData.name,
                phone: studentData.phone,
                planType: studentData.plan_type as any,
                planStatus: studentData.plan_status as any,
                professorId: studentData.professor_id,
                studentType: studentData.student_type as any,
                responsibleSocioId: studentData.responsible_socio_id,
                relationshipType: studentData.relationship_type as any
            } : s));
        } else {
            const { data, error } = await supabase
                .from('non_socio_students')
                .insert(studentData)
                .select()
                .single();

            if (error) {
                alert('Erro ao salvar aluno: ' + error.message);
                return;
            }

            if (data) {
                setStudents([...students, {
                    id: data.id,
                    name: data.name,
                    phone: data.phone,
                    planType: data.plan_type,
                    planStatus: data.plan_status,
                    masterExpirationDate: data.master_expiration_date,
                    professorId: data.professor_id,
                    studentType: data.student_type || 'regular',
                    responsibleSocioId: data.responsible_socio_id,
                    relationshipType: data.relationship_type
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
                phone: student.phone || '',
                studentType: student.studentType || 'regular',
                planType: (['Day Card', 'Day Card Experimental', 'Card Mensal'].includes(student.planType)
                    ? student.planType as RegularPlanType
                    : 'Day Card'),
                responsibleSocioId: student.responsibleSocioId || '',
                relationshipType: student.relationshipType || ''
            });
        } else {
            setEditingStudent(null);
            setStudentForm({ name: '', phone: '', studentType: 'regular', planType: 'Day Card', responsibleSocioId: '', relationshipType: '' });
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
            <div className="bg-linear-to-br from-saibro-600 to-saibro-800 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
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
                                    const socioIds = getClassSocioIds(r);
                                    const nonSocioIds = getClassNonSocioIds(r);
                                    const socioNames = socioIds.map(id => profiles.find(u => u.id === id)?.name).filter(Boolean) as string[];
                                    const nonSocioNames = nonSocioIds.map(id => students.find(ns => ns.id === id)?.name).filter(Boolean) as string[];
                                    const combinedNames = [...socioNames, ...nonSocioNames];
                                    const studentName = combinedNames.length > 0
                                        ? combinedNames.slice(0, 2).join(', ') + (combinedNames.length > 2 ? ` +${combinedNames.length - 2}` : '')
                                        : 'TBD';
                                    const studentInfo = socioNames.length > 0 && nonSocioNames.length > 0
                                        ? 'Misto'
                                        : (socioNames.length > 0 ? 'Sócio' : (nonSocioNames.length > 0 ? 'Não sócio' : ''));

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
                                const socioIds = getClassSocioIds(r);
                                const nonSocioIds = getClassNonSocioIds(r);
                                const socioNames = socioIds.map(id => profiles.find(u => u.id === id)?.name).filter(Boolean) as string[];
                                const nonSocioNames = nonSocioIds.map(id => students.find(s => s.id === id)?.name).filter(Boolean) as string[];
                                const combinedNames = [...socioNames, ...nonSocioNames];
                                const studentName = combinedNames.length > 0
                                    ? combinedNames.slice(0, 2).join(', ') + (combinedNames.length > 2 ? ` +${combinedNames.length - 2}` : '')
                                    : 'TBD';

                                return (
                                    <div key={r.id} className="bg-white p-3 rounded-lg border border-stone-100 flex justify-between items-center">
                                        <div>
                                            <p className="font-bold text-stone-700 text-sm">{new Date(r.date + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })} • {r.startTime}</p>
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

                    <div className="space-y-6">
                        {/* PENDING / EXPIRED SECTION */}
                        {myStudents.some(s => {
                            if (s.studentType === 'dependent') return false;
                            const isMaster = s.planType === 'Card Mensal';
                            const isExpired = isMaster && (!s.masterExpirationDate || new Date(s.masterExpirationDate + 'T00:00:00') < getNowInFortaleza());
                            return s.planStatus !== 'active' || isExpired;
                        }) && (
                                <div>
                                    <h4 className="text-sm font-bold text-orange-600 uppercase mb-2 flex items-center gap-2">
                                        <AlertCircle size={16} /> Atenção Necessária
                                    </h4>
                                    <div className="grid gap-3">
                                        {myStudents.filter(s => {
                                            if (s.studentType === 'dependent') return false;
                                            const isMaster = s.planType === 'Card Mensal';
                                            const isExpired = isMaster && (!s.masterExpirationDate || new Date(s.masterExpirationDate + 'T00:00:00') < getNowInFortaleza());
                                            return s.planStatus !== 'active' || isExpired;
                                        }).map(student => (
                                            <StudentCard key={student.id} student={student} onEdit={openStudentModal} onToggleStatus={toggleStudentStatus} />
                                        ))}
                                    </div>
                                </div>
                            )}

                        {/* ACTIVE SECTION */}
                        <div>
                            <h4 className="text-sm font-bold text-stone-500 uppercase mb-2">Alunos Ativos / Dependentes</h4>
                            <div className="grid gap-3">
                                {myStudents.filter(s => {
                                    if (s.studentType === 'dependent') return true;
                                    const isMaster = s.planType === 'Card Mensal';
                                    const isExpired = isMaster && (!s.masterExpirationDate || new Date(s.masterExpirationDate + 'T00:00:00') < getNowInFortaleza());
                                    return s.planStatus === 'active' && !isExpired;
                                }).map(student => (
                                    <StudentCard key={student.id} student={student} onEdit={openStudentModal} onToggleStatus={toggleStudentStatus} />
                                ))}
                                {myStudents.length === 0 && <p className="text-stone-400 text-sm italic">Nenhum aluno cadastrado.</p>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* --- MODAL: STUDENT FORM --- */}
            {showStudentModal && (
                <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 animate-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
                        <h3 className="text-xl font-bold text-saibro-800">{editingStudent ? 'Editar Aluno' : 'Novo Aluno'}</h3>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Nome Completo</label>
                                <input
                                    type="text"
                                    value={studentForm.name}
                                    onChange={e => setStudentForm({ ...studentForm, name: e.target.value })}
                                    className="w-full p-3 bg-stone-50 rounded-xl"
                                    placeholder="Nome completo"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Telefone</label>
                                <input
                                    type="text"
                                    value={studentForm.phone}
                                    onChange={e => setStudentForm({ ...studentForm, phone: e.target.value })}
                                    className="w-full p-3 bg-stone-50 rounded-xl"
                                    placeholder="(00) 00000-0000"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Tipo de Aluno</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setStudentForm({ ...studentForm, studentType: 'regular' })}
                                        className={`py-3 px-4 rounded-xl font-bold text-sm transition-all ${studentForm.studentType === 'regular'
                                            ? 'bg-orange-500 text-white shadow-lg'
                                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                        }`}
                                    >
                                        Regular
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setStudentForm({ ...studentForm, studentType: 'dependent' })}
                                        className={`py-3 px-4 rounded-xl font-bold text-sm transition-all ${studentForm.studentType === 'dependent'
                                            ? 'bg-blue-500 text-white shadow-lg'
                                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                        }`}
                                    >
                                        Dependente
                                    </button>
                                </div>
                            </div>

                            {/* Fields for Regular */}
                            {studentForm.studentType === 'regular' && (
                                <>
                                    <div>
                                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Tipo de Plano</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setStudentForm({ ...studentForm, planType: 'Day Card' })}
                                                className={`py-3 px-2 rounded-xl font-bold text-xs transition-all ${studentForm.planType === 'Day Card'
                                                    ? 'bg-saibro-600 text-white shadow-lg'
                                                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                                }`}
                                            >
                                                Day Card
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setStudentForm({ ...studentForm, planType: 'Day Card Experimental' })}
                                                className={`py-3 px-2 rounded-xl font-bold text-xs transition-all ${studentForm.planType === 'Day Card Experimental'
                                                    ? 'bg-amber-500 text-white shadow-lg'
                                                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                                }`}
                                            >
                                                Experimental
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setStudentForm({ ...studentForm, planType: 'Card Mensal' })}
                                                className={`py-3 px-2 rounded-xl font-bold text-xs transition-all ${studentForm.planType === 'Card Mensal'
                                                    ? 'bg-saibro-600 text-white shadow-lg'
                                                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                                }`}
                                            >
                                                Card Mensal
                                            </button>
                                        </div>
                                    </div>

                                    {studentForm.planType === 'Day Card Experimental' && (
                                        <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 text-xs text-amber-700">
                                            <strong>R$ 50/aula.</strong> Ao converter para Card Mensal, o valor é estornado. Pagamento confirmado pelo Admin.
                                        </div>
                                    )}
                                    {studentForm.planType === 'Day Card' && (
                                        <div className="bg-stone-50 p-3 rounded-lg flex items-center gap-2 text-stone-500 text-xs">
                                            <DollarSign size={16} />
                                            <span>R$ 50/aula. Pagamento confirmado pelo Admin.</span>
                                        </div>
                                    )}
                                    {studentForm.planType === 'Card Mensal' && (
                                        <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 text-xs text-purple-800">
                                            <strong>R$ 200/mês.</strong> Aluno ficará inativo até o pagamento ser confirmado pelo Admin.
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Fields for Dependent */}
                            {studentForm.studentType === 'dependent' && (
                                <>
                                    <div>
                                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Sócio Responsável *</label>
                                        <select
                                            value={studentForm.responsibleSocioId}
                                            onChange={e => setStudentForm({ ...studentForm, responsibleSocioId: e.target.value })}
                                            className="w-full p-3 bg-stone-50 rounded-xl"
                                        >
                                            <option value="">Selecione...</option>
                                            {socios.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Tipo de Relacionamento *</label>
                                        <select
                                            value={studentForm.relationshipType}
                                            onChange={e => setStudentForm({ ...studentForm, relationshipType: e.target.value as RelationshipType })}
                                            className="w-full p-3 bg-stone-50 rounded-xl"
                                        >
                                            <option value="">Selecione...</option>
                                            <option value="filho">Filho</option>
                                            <option value="filha">Filha</option>
                                            <option value="esposo">Esposo</option>
                                            <option value="esposa">Esposa</option>
                                            <option value="outro">Outro</option>
                                        </select>
                                    </div>
                                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-xs text-blue-700">
                                        Dependentes não possuem cobrança. Vinculados ao sócio responsável.
                                    </div>
                                </>
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
