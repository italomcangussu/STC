import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notifications';
import { useConfirm } from '../hooks/useConfirm';
import { validateStudentForm } from '../lib/students/validateStudentForm';
import { NonSocioStudent, Professor, User, RelationshipType, StudentProfile } from '../types';
import { STUDENT_LEVELS, StudentLevel } from '../lib/students/studentRules';
import {
    Users, Plus, Search, Edit, Trash2, CheckCircle, Loader2, DollarSign, X, UserPlus, ArrowUpCircle
} from 'lucide-react';
import { getNowInFortaleza, formatDate, formatDateBr, MEMBER_ROLES } from '../utils';
import { StandardModal } from './StandardModal';

const DAY_CARD_PRICE = 50;
const CARD_MENSAL_PRICE = 200;

type RegularPlanType = 'Day Card' | 'Day Card Experimental' | 'Card Mensal';

/** Calcula data de expiração: mesmo dia do mês seguinte, limitando ao último dia do mês */
function addOneMonth(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    const lastDayOfNextMonth = new Date(nextYear, nextMonth, 0).getDate();
    const day = Math.min(d, lastDayOfNextMonth);
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const AdminStudents: React.FC = () => {
    const confirm = useConfirm();
    const [students, setStudents] = useState<NonSocioStudent[]>([]);
    const [studentProfiles, setStudentProfiles] = useState<StudentProfile[]>([]);
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [socios, setSocios] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [studentTypeFilter, setStudentTypeFilter] = useState<'all' | 'regular' | 'dependent'>('all');
    const [studentStatusFilter, setStudentStatusFilter] = useState<'active' | 'paused' | 'all'>('active');
    const [newSocioId, setNewSocioId] = useState('');
    const [newSocioLevel, setNewSocioLevel] = useState<StudentLevel | ''>('');
    const [newSocioProfessorId, setNewSocioProfessorId] = useState('');
    const [levelHistoryStudent, setLevelHistoryStudent] = useState<{ id: string; name: string } | null>(null);
    const [levelHistory, setLevelHistory] = useState<any[]>([]);

    // --- Modal States ---
    const [showStudentModal, setShowStudentModal] = useState(false);
    const [editingStudent, setEditingStudent] = useState<NonSocioStudent | null>(null);
    const [studentForm, setStudentForm] = useState({
        name: '',
        phone: '',
        professorId: '',
        studentType: 'regular' as 'regular' | 'dependent',
        responsibleSocioId: '',
        relationshipType: '' as RelationshipType | '',
        planType: 'Day Card' as RegularPlanType,
        technicalLevel: '' as StudentLevel | ''
    });

    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentStudent, setPaymentStudent] = useState<NonSocioStudent | null>(null);
    const [paymentDate, setPaymentDate] = useState(formatDate(getNowInFortaleza()));
    const [processing, setProcessing] = useState(false);

    // --- Conversão Card Mensal ---
    const [showConvertModal, setShowConvertModal] = useState(false);
    const [convertStudent, setConvertStudent] = useState<NonSocioStudent | null>(null);
    const [convertDate, setConvertDate] = useState(formatDate(getNowInFortaleza()));

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data: sData } = await supabase
            .from('non_socio_students')
            .select('*')
            .order('name');
        const { data: studentProfilesData } = await supabase.from('student_profiles').select('*');
        const { data: pData } = await supabase.from('professors').select('*').eq('is_active', true);
        const { data: sociosData } = await supabase
            .from('profiles')
            .select('id, name, email, phone, role')
            .in('role', [...MEMBER_ROLES])
            .eq('is_active', true)
            .order('name');

        if (studentProfilesData) setStudentProfiles(studentProfilesData.map((profile: any) => ({
            id: profile.id, profileId: profile.profile_id, nonSocioStudentId: profile.non_socio_student_id,
            technicalLevel: profile.technical_level, studentStatus: profile.student_status,
            professorId: profile.professor_id, cardExpiredReviewedFor: profile.card_expired_reviewed_for,
        })));
        if (sData) {
            setStudents(sData.map(s => ({
                id: s.id,
                name: s.name,
                phone: s.phone,
                planType: s.plan_type,
                planStatus: s.plan_status,
                masterExpirationDate: s.master_expiration_date,
                professorId: s.professor_id,
                studentType: s.student_type || 'regular',
                responsibleSocioId: s.responsible_socio_id,
                relationshipType: s.relationship_type,
                isActive: s.is_active ?? true,
                studentProfileId: studentProfilesData?.find((profile: any) => profile.non_socio_student_id === s.id)?.id,
                technicalLevel: studentProfilesData?.find((profile: any) => profile.non_socio_student_id === s.id)?.technical_level,
                studentStatus: studentProfilesData?.find((profile: any) => profile.non_socio_student_id === s.id)?.student_status || (s.is_active === false ? 'paused' : 'active'),
            })));
        }
        if (pData) {
            setProfessors(pData.map(p => ({
                id: p.id,
                userId: p.user_id,
                name: p.name,
                isActive: p.is_active,
                bio: p.bio
            })));
        }
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

    // --- Student CRUD ---
    const handleSaveStudent = async () => {
        // Só cobra professor quando existe professor cadastrado para escolher.
        const problema = validateStudentForm(studentForm, { requireProfessor: professors.length > 0 });
        if (problema) {
            notify.warning(problema.message, { description: problema.hint });
            return;
        }

        setProcessing(true);
        try {
            const studentData = {
                name: studentForm.name.trim(),
                phone: studentForm.phone || null,
                professor_id: studentForm.studentType === 'regular' ? (studentForm.professorId || null) : null,
                student_type: studentForm.studentType,
                responsible_socio_id: studentForm.studentType === 'dependent' ? studentForm.responsibleSocioId : null,
                relationship_type: studentForm.studentType === 'dependent' ? studentForm.relationshipType : null,
                plan_type: studentForm.studentType === 'dependent' ? 'Dependente' : studentForm.planType,
                plan_status: editingStudent ? editingStudent.planStatus : studentForm.studentType === 'dependent' ? 'active' : 'inactive'
            };

            if (editingStudent) {
                const { error } = await supabase.from('non_socio_students').update(studentData).eq('id', editingStudent.id);
                if (error) throw error;
                if (editingStudent.studentProfileId) {
                    const { error: assignmentError } = await supabase.from('student_profiles').update({ professor_id: studentData.professor_id }).eq('id', editingStudent.studentProfileId);
                    if (assignmentError) throw assignmentError;
                }
                if (!editingStudent.studentProfileId) throw new Error('Perfil de aluno indisponível. Atualize a página e tente novamente.');
                if (studentForm.technicalLevel) {
                    const { error: levelError } = await supabase.rpc('set_student_level', { p_student_profile_id: editingStudent.studentProfileId, p_new_level: studentForm.technicalLevel, p_observation: null });
                    if (levelError) throw levelError;
                }
            } else {
                const { data, error } = await supabase.from('non_socio_students').insert(studentData).select('id').single();
                if (error) throw error;
                if (!data) throw new Error('Não foi possível localizar o aluno criado.');
                const { error: profileError } = await supabase.from('student_profiles').insert({
                    non_socio_student_id: data.id, technical_level: studentForm.technicalLevel || null,
                    student_status: 'active', professor_id: studentData.professor_id,
                });
                if (profileError) throw profileError;
            }
            await fetchData();
            setShowStudentModal(false);
            setEditingStudent(null);
            setStudentForm({ name: '', phone: '', professorId: '', studentType: 'regular', responsibleSocioId: '', relationshipType: '', planType: 'Day Card', technicalLevel: '' });
            notify.success(editingStudent ? 'Aluno atualizado.' : 'Aluno cadastrado.');
        } catch (error) {
            notify.failure(error, 'Não foi possível salvar o aluno.', {
                event: 'student_save_failed',
                studentId: editingStudent?.id,
            });
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteStudent = async (id: string) => {
        const student = students.find(s => s.id === id);
        if (!await confirm({
            title: `Desativar ${student?.name ?? 'este aluno'}?`,
            description: 'Ele sai da lista de alunos ativos. O histórico de pagamentos é preservado.',
            confirmLabel: 'Desativar aluno',
        })) return;

        setProcessing(true);
        try {
            const { error } = student.studentProfileId
                ? await supabase.from('student_profiles').update({ student_status: 'paused' }).eq('id', student.studentProfileId)
                : await supabase.from('non_socio_students').update({ is_active: false }).eq('id', id);
            if (error) throw error;
            await fetchData();
        } catch (error) {
            notify.failure(error, 'Não foi possível desativar o aluno.', {
                event: 'student_deactivate_failed',
                studentId: id,
            });
        } finally {
            setProcessing(false);
        }
    };

    const setStudentActive = async (student: NonSocioStudent, active: boolean) => {
        const { error } = student.studentProfileId
            ? await supabase.from('student_profiles').update({ student_status: active ? 'active' : 'paused' }).eq('id', student.studentProfileId)
            : await supabase.from('non_socio_students').update({ is_active: active }).eq('id', student.id);
        if (error) { notify.failure(error, 'Não foi possível atualizar a situação do aluno.'); return; }
        await fetchData();
    };

    const enrollExistingSocio = async () => {
        if (!newSocioId) return;
        const { error } = await supabase.from('student_profiles').insert({ profile_id: newSocioId, technical_level: newSocioLevel || null, student_status: 'active', professor_id: newSocioProfessorId || null });
        if (error) { notify.failure(error, 'Não foi possível vincular o sócio como aluno.'); return; }
        setNewSocioId(''); setNewSocioLevel(''); setNewSocioProfessorId(''); await fetchData();
    };

    const changeStudentLevel = async (profile: StudentProfile, level: StudentLevel) => {
        const { error } = await supabase.rpc('set_student_level', { p_student_profile_id: profile.id, p_new_level: level, p_observation: null });
        if (error) { notify.failure(error, 'Não foi possível atualizar o nível do aluno.'); return; }
        await fetchData();
    };

    const setMemberActive = async (profile: StudentProfile, active: boolean) => {
        const { error } = await supabase.from('student_profiles').update({ student_status: active ? 'active' : 'paused' }).eq('id', profile.id);
        if (error) { notify.failure(error, 'Não foi possível atualizar a situação do aluno.'); return; }
        await fetchData();
    };

    const assignMemberProfessor = async (profile: StudentProfile, professorId: string) => {
        const { error } = await supabase.from('student_profiles').update({ professor_id: professorId || null }).eq('id', profile.id);
        if (error) { notify.failure(error, 'Não foi possível atualizar o professor responsável.'); return; }
        await fetchData();
    };

    const openLevelHistory = async (profile: StudentProfile, name: string) => {
        const { data, error } = await supabase.from('student_level_history').select('*').eq('student_profile_id', profile.id).order('changed_at', { ascending: false });
        if (error) { notify.failure(error, 'Não foi possível carregar a evolução do aluno.'); return; }
        setLevelHistory(data || []); setLevelHistoryStudent({ id: profile.id, name });
    };

    // --- Payment Logic (Day Card / Day Card Experimental = R$ 50) ---
    const handleOpenPayment = (student: NonSocioStudent) => {
        setPaymentStudent(student);
        setPaymentDate(formatDate(getNowInFortaleza()));
        setShowPaymentModal(true);
    };

    const handleConfirmPayment = async () => {
        if (!paymentStudent || !paymentDate) return;
        setProcessing(true);

        try {
            const price = paymentStudent.planType === 'Card Mensal' ? CARD_MENSAL_PRICE : DAY_CARD_PRICE;
            const isCardMensal = paymentStudent.planType === 'Card Mensal';
            const isoExp = isCardMensal ? addOneMonth(paymentDate) : null;

            const { error: payError } = await supabase.from('student_payments').insert({
                student_id: paymentStudent.id,
                amount: price,
                payment_date: new Date(paymentDate + 'T12:00:00').toISOString(),
                valid_until: isCardMensal
                    ? new Date(isoExp + 'T23:59:59').toISOString()
                    : new Date(paymentDate + 'T23:59:59').toISOString(),
                approved_by: (await supabase.auth.getUser()).data.user?.id,
                status: 'active'
            });
            if (payError) throw payError;

            const updateData: any = {
                plan_status: 'active'
            };
            if (isCardMensal) {
                updateData.master_expiration_date = isoExp;
            }

            const { error: upError } = await supabase.from('non_socio_students')
                .update(updateData)
                .eq('id', paymentStudent.id);
            if (upError) throw upError;

            await fetchData();
            setShowPaymentModal(false);
            setPaymentStudent(null);
            notify.success('Pagamento registrado.', {
                description: isCardMensal
                    ? `Card Mensal válido até ${formatDateBr(isoExp!)}.`
                    : `Day Card de R$ ${price},00.`,
            });
        } catch (error) {
            notify.failure(error, 'Não foi possível registrar o pagamento.', {
                event: 'student_payment_create_failed',
                studentId: paymentStudent?.id,
            });
        } finally {
            setProcessing(false);
        }
    };

    // --- Conversão para Card Mensal ---
    const handleOpenConvert = (student: NonSocioStudent) => {
        setConvertStudent(student);
        setConvertDate(formatDate(getNowInFortaleza()));
        setShowConvertModal(true);
    };

    const handleConfirmConvert = async () => {
        if (!convertStudent || !convertDate) return;
        setProcessing(true);

        try {
            const isoExp = addOneMonth(convertDate);
            const isExperimental = convertStudent.planType === 'Day Card Experimental';

            // 1. Se Day Card Experimental: cancelar pagamentos de R$ 50 existentes
            if (isExperimental) {
                const { data: existingPayments } = await supabase
                    .from('student_payments')
                    .select('id')
                    .eq('student_id', convertStudent.id)
                    .eq('status', 'active');

                if (existingPayments && existingPayments.length > 0) {
                    const paymentIds = existingPayments.map(p => p.id);
                    await supabase.from('student_payments')
                        .update({
                            status: 'cancelled',
                            cancelled_reason: 'Convertido para Card Mensal'
                        })
                        .in('id', paymentIds);
                }
            }

            // 2. Criar pagamento Card Mensal (R$ 200)
            const { error: payError } = await supabase.from('student_payments').insert({
                student_id: convertStudent.id,
                amount: CARD_MENSAL_PRICE,
                payment_date: new Date(convertDate + 'T12:00:00').toISOString(),
                valid_until: new Date(isoExp + 'T23:59:59').toISOString(),
                approved_by: (await supabase.auth.getUser()).data.user?.id,
                status: 'active'
            });
            if (payError) throw payError;

            // 3. Atualizar aluno para Card Mensal
            const { error: upError } = await supabase.from('non_socio_students').update({
                plan_type: 'Card Mensal',
                plan_status: 'active',
                master_expiration_date: isoExp
            }).eq('id', convertStudent.id);
            if (upError) throw upError;

            await fetchData();
            setShowConvertModal(false);
            setConvertStudent(null);

            notify.success(`Card Mensal ativado até ${formatDateBr(isoExp)}.`, {
                description: isExperimental
                    ? 'Os pagamentos do Day Card Experimental foram estornados.'
                    : 'Os pagamentos de Day Card anteriores foram mantidos.',
            });
        } catch (error) {
            notify.failure(error, 'Não foi possível converter para Card Mensal.', {
                event: 'student_plan_conversion_failed',
                studentId: convertStudent?.id,
            });
        } finally {
            setProcessing(false);
        }
    };

    // --- Render ---
    const filteredStudents = students.filter(s => {
        const matchesName = s.name.toLowerCase().includes(filter.toLowerCase());
        const matchesType = studentTypeFilter === 'all'
            || (studentTypeFilter === 'regular' && s.studentType !== 'dependent')
            || (studentTypeFilter === 'dependent' && s.studentType === 'dependent');
        return matchesName && matchesType && (studentStatusFilter === 'all' || (s.studentStatus || 'active') === studentStatusFilter);
    });

    const getPaymentPrice = (student: NonSocioStudent) => {
        if (student.planType === 'Card Mensal') return CARD_MENSAL_PRICE;
        return DAY_CARD_PRICE;
    };

    const getStatusLabel = (student: NonSocioStudent, isActive: boolean, isExpired: boolean) => {
        if (student.studentType === 'dependent') return 'Dependente - Sem Cobrança';
        if (student.planType === 'Card Mensal') {
            if (isActive) return 'Card Mensal Ativo';
            if (isExpired) return 'Card Mensal Vencido';
            return 'Card Mensal Inativo';
        }
        if (student.planType === 'Day Card Experimental') {
            return isActive ? 'Day Card Experimental Ativo' : 'Day Card Experimental Inativo';
        }
        return isActive ? 'Day Card Ativo' : 'Day Card Inativo';
    };

    const getStatusColor = (student: NonSocioStudent, isActive: boolean) => {
        if (student.studentType === 'dependent') return 'bg-blue-100 text-blue-700';
        if (student.planType === 'Day Card Experimental') {
            return isActive ? 'bg-amber-100 text-amber-700' : 'bg-stone-200 text-stone-500';
        }
        return isActive ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-500';
    };

    const canConvertToMensal = (student: NonSocioStudent) => {
        if (student.studentType === 'dependent') return false;
        if (student.planType === 'Day Card Experimental') return true; // sempre permitir upgrade + estorno
        return student.planType === 'Day Card' && student.planStatus === 'active';
    };

    return (
        <div className="p-4 md:p-6 pb-40 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
                        <Users className="text-saibro-500" /> Gestão de Alunos (Non-Sócio)
                    </h1>
                    <p className="text-sm text-stone-500">Cadastre alunos e gerencie planos e pagamentos</p>
                </div>
                <button
                    onClick={() => {
                        setEditingStudent(null);
                        setStudentForm({ name: '', phone: '', professorId: '', studentType: 'regular', responsibleSocioId: '', relationshipType: '', planType: 'Day Card', technicalLevel: '' });
                        setShowStudentModal(true);
                    }}
                    className="bg-saibro-500 hover:bg-saibro-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2"
                >
                    <Plus size={18} /> Novo Aluno
                </button>
            </div>

            {/* Filter */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100 space-y-3">
                <div className="flex items-center gap-2">
                    <Search className="text-stone-400" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar aluno..."
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        className="flex-1 outline-hidden text-stone-600"
                    />
                </div>
                <div className="flex gap-2">
                    {(['active', 'paused', 'all'] as const).map(status => <button key={status} onClick={() => setStudentStatusFilter(status)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${studentStatusFilter === status ? 'bg-saibro-600 text-white' : 'bg-stone-100 text-stone-500'}`}>{status === 'active' ? 'Ativos' : status === 'paused' ? 'Pausados' : 'Todos'}</button>)}
                    {(['all', 'regular', 'dependent'] as const).map(type => (
                        <button
                            key={type}
                            onClick={() => setStudentTypeFilter(type)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${studentTypeFilter === type
                                ? 'bg-saibro-500 text-white'
                                : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                            }`}
                        >
                            {type === 'all' ? 'Todos' : type === 'regular' ? 'Regulares' : 'Dependentes'}
                        </button>
                    ))}
                </div>
            </div>

            <section className="bg-white border border-stone-100 rounded-xl p-4 space-y-3">
                <h2 className="font-bold text-stone-800">Sócios que também são alunos</h2>
                <div className="flex flex-col sm:flex-row gap-2">
                    <select aria-label="Selecionar sócio para vincular como aluno" value={newSocioId} onChange={e => setNewSocioId(e.target.value)} className="flex-1 p-2 rounded-lg bg-stone-50 border border-stone-200">
                        <option value="">Vincular sócio existente...</option>
                        {socios.filter(member => !studentProfiles.some(profile => profile.profileId === member.id)).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                    </select>
                    <select aria-label="Nível técnico do sócio" value={newSocioLevel} onChange={e => setNewSocioLevel(e.target.value as StudentLevel | '')} className="p-2 rounded-lg bg-stone-50 border border-stone-200"><option value="">Nível (opcional)</option>{STUDENT_LEVELS.map(level => <option key={level}>{level}</option>)}</select>
                    <select aria-label="Professor responsável pelo sócio aluno" value={newSocioProfessorId} onChange={e => setNewSocioProfessorId(e.target.value)} className="p-2 rounded-lg bg-stone-50 border border-stone-200"><option value="">Professor (opcional)</option>{professors.map(professor => <option key={professor.id} value={professor.id}>{professor.name}</option>)}</select>
                    <button disabled={!newSocioId} onClick={() => void enrollExistingSocio()} className="px-4 py-2 rounded-lg bg-saibro-600 text-white disabled:opacity-50">Vincular</button>
                </div>
                {studentProfiles.filter(profile => profile.profileId && (studentStatusFilter === 'all' || profile.studentStatus === studentStatusFilter)).map(profile => {
                    const person = socios.find(member => member.id === profile.profileId);
                    if (!person) return null;
                    return <div key={profile.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><div><p className="font-semibold">{person.name}</p><p className="text-xs text-stone-500">Sócio · {profile.studentStatus === 'active' ? 'Ativo' : 'Pausado'}</p></div><select aria-label={`Professor de ${person.name}`} value={profile.professorId || ''} onChange={e => void assignMemberProfessor(profile, e.target.value)} className="p-2 rounded-lg border"><option value="">Sem professor</option>{professors.map(professor => <option key={professor.id} value={professor.id}>{professor.name}</option>)}</select><select aria-label={`Nível de ${person.name}`} value={profile.technicalLevel || ''} onChange={e => e.target.value && void changeStudentLevel(profile, e.target.value as StudentLevel)} className="p-2 rounded-lg border"><option value="">Nível</option>{STUDENT_LEVELS.map(level => <option key={level}>{level}</option>)}</select><button onClick={() => void openLevelHistory(profile, person.name)} className="text-sm text-stone-600 font-semibold">Evolução</button><button onClick={() => void setMemberActive(profile, profile.studentStatus !== 'active')} className="text-sm text-saibro-700 font-semibold">{profile.studentStatus === 'active' ? 'Pausar' : 'Reativar'}</button></div>;
                })}
            </section>

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-saibro-500" /></div>
            ) : (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {filteredStudents.map(student => {
                        const isCardMensal = student.planType === 'Card Mensal';
                        const isExpired = isCardMensal && (!student.masterExpirationDate || new Date(student.masterExpirationDate + 'T23:59:59') < getNowInFortaleza());
                        const isActive = student.planStatus === 'active' && (!isCardMensal || !isExpired);
                        const isStudentActive = student.studentStatus !== 'paused' && student.studentStatus !== 'ended';
                        const profName = professors.find(p => p.id === student.professorId)?.name || 'N/A';

                        return (
                            <div key={student.id} className={`relative p-5 rounded-2xl border-2 transition-all ${isStudentActive ? 'bg-white border-stone-100' : 'bg-stone-50 border-stone-100 opacity-80'}`}>
                                <div className="flex justify-between items-start mb-3">
                                    <div className={`p-2 rounded-lg ${student.studentType === 'dependent' ? 'bg-blue-50' : student.planType === 'Day Card Experimental' ? 'bg-amber-50' : 'bg-stone-100'}`}>
                                        {student.studentType === 'dependent' ? (
                                            <UserPlus size={20} className="text-blue-600" />
                                        ) : (
                                            <Users size={20} className={isStudentActive ? 'text-saibro-600' : 'text-stone-400'} />
                                        )}
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => {
                                                setEditingStudent(student);
                                                setStudentForm({
                                                    name: student.name,
                                                    phone: student.phone || '',
                                                    professorId: student.professorId || '',
                                                    studentType: student.studentType || 'regular',
                                                    responsibleSocioId: student.responsibleSocioId || '',
                                                    relationshipType: student.relationshipType || '',
                                                    planType: (['Day Card', 'Day Card Experimental', 'Card Mensal'].includes(student.planType)
                                                        ? student.planType as RegularPlanType
                                                        : 'Day Card'),
                                                    technicalLevel: student.technicalLevel || ''
                                                });
                                                setShowStudentModal(true);
                                            }}
                                            className="p-2 hover:bg-stone-100 rounded-lg text-stone-500"
                                        >
                                            <Edit size={16} />
                                        </button>
                                        <button onClick={() => student.studentStatus === 'active' ? void handleDeleteStudent(student.id) : void setStudentActive(student, true)} title={student.studentStatus === 'active' ? 'Pausar aluno' : 'Reativar aluno'} className="p-2 hover:bg-stone-100 rounded-lg text-stone-500">{student.studentStatus === 'active' ? <Trash2 size={16} /> : <CheckCircle size={16} />}</button>
                                    </div>
                                </div>

                                <h3 className="font-bold text-lg text-stone-800 mb-1">{student.name}</h3>
                                <p className="text-xs text-stone-500 mb-3">{student.technicalLevel || 'Nível não definido'} · Aluno {isStudentActive ? 'ativo' : 'pausado'}</p>
                                <button onClick={() => { const profile = studentProfiles.find(item => item.id === student.studentProfileId); if (profile) void openLevelHistory(profile, student.name); }} className="text-xs text-saibro-700 font-semibold mb-3">Ver evolução do nível</button>

                                {student.studentType === 'dependent' ? (
                                    <div className="space-y-1 mb-4">
                                        <p className="text-xs text-blue-600 font-bold flex items-center gap-1">
                                            Dependente
                                        </p>
                                        <p className="text-xs text-stone-500">
                                            <span className="font-semibold">Responsável:</span> {socios.find(s => s.id === student.responsibleSocioId)?.name || 'N/A'}
                                        </p>
                                        {student.relationshipType && (
                                            <p className="text-xs text-stone-500 capitalize">
                                                <span className="font-semibold">Relação:</span> {student.relationshipType}
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-xs text-stone-500 mb-4 flex items-center gap-1">
                                        <span className="font-semibold">Prof:</span> {profName}
                                    </p>
                                )}

                                <div className="pt-4 border-t border-stone-100">
                                    <div className="flex justify-between items-center mb-3">
                                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${getStatusColor(student, isActive)}`}>
                                            {getStatusLabel(student, isActive, isExpired)}
                                        </span>
                                        {student.masterExpirationDate && isCardMensal && (
                                            <span className={`text-xs font-mono font-bold ${isActive ? 'text-green-600' : 'text-red-400'}`}>
                                                Vence: {formatDateBr(student.masterExpirationDate)}
                                            </span>
                                        )}
                                    </div>

                                    {student.studentType !== 'dependent' && (
                                        <div className="space-y-2">
                                            {/* Botão de pagamento */}
                                            {(student.planType !== 'Card Mensal' || !isActive) && (
                                                <button
                                                    onClick={() => handleOpenPayment(student)}
                                                    className={`w-full py-2.5 rounded-xl font-bold text-sm flex justify-center items-center gap-2 transition-colors ${isActive
                                                        ? 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                                        : 'bg-green-500 text-white hover:bg-green-600 shadow-md shadow-green-100'
                                                    }`}
                                                >
                                                    <DollarSign size={16} />
                                                    {isCardMensal
                                                        ? (isActive ? 'Renovar Card Mensal' : 'Ativar Card Mensal')
                                                        : (isActive ? `Registrar Pagamento R$ ${DAY_CARD_PRICE}` : `Pagar R$ ${DAY_CARD_PRICE} (${student.planType})`)
                                                    }
                                                </button>
                                            )}

                                            {/* Botão de renovação Card Mensal */}
                                            {isCardMensal && isActive && (
                                                <button
                                                    onClick={() => handleOpenPayment(student)}
                                                    className="w-full py-2.5 rounded-xl font-bold text-sm flex justify-center items-center gap-2 bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors"
                                                >
                                                    <DollarSign size={16} />
                                                    Renovar Card Mensal
                                                </button>
                                            )}

                                            {/* Botão de conversão para Card Mensal */}
                                            {canConvertToMensal(student) && (
                                                <button
                                                    onClick={() => handleOpenConvert(student)}
                                                    className="w-full py-2.5 rounded-xl font-bold text-sm flex justify-center items-center gap-2 bg-purple-500 text-white hover:bg-purple-600 shadow-md shadow-purple-100 transition-colors"
                                                >
                                                    <ArrowUpCircle size={16} />
                                                    Converter para Card Mensal
                                                    {student.planType === 'Day Card Experimental' && (
                                                        <span className="text-[10px] bg-purple-400 px-1.5 py-0.5 rounded ml-1">ESTORNO R$50</span>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* --- Student Edit Modal --- */}
            <StandardModal isOpen={showStudentModal} onClose={() => setShowStudentModal(false)}>
                <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
                    <h3 className="text-xl font-bold mb-4">{editingStudent ? 'Editar Aluno' : 'Novo Aluno'}</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Nível técnico</label>
                            <select value={studentForm.technicalLevel} onChange={e => setStudentForm({ ...studentForm, technicalLevel: e.target.value as StudentLevel | '' })} className="w-full p-3 bg-stone-50 rounded-xl">
                                <option value="">Selecione o nível</option>{STUDENT_LEVELS.map(level => <option key={level}>{level}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Nome Completo</label>
                            <input
                                value={studentForm.name}
                                onChange={e => setStudentForm({ ...studentForm, name: e.target.value })}
                                className="w-full p-3 bg-stone-50 rounded-xl"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Telefone</label>
                            <input
                                value={studentForm.phone}
                                onChange={e => setStudentForm({ ...studentForm, phone: e.target.value })}
                                className="w-full p-3 bg-stone-50 rounded-xl"
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
                                {professors.length > 0 ? (
                                    <div>
                                        <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Professor Responsável</label>
                                        <select
                                            value={studentForm.professorId}
                                            onChange={e => setStudentForm({ ...studentForm, professorId: e.target.value })}
                                            className="w-full p-3 bg-stone-50 rounded-xl"
                                        >
                                            <option value="">Selecione...</option>
                                            {professors.map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <p className="text-xs text-stone-400 italic">
                                        Nenhum professor cadastrado. As aulas atribuirão professores automaticamente na Agenda.
                                    </p>
                                )}

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
                                    {studentForm.planType === 'Day Card Experimental' && (
                                        <p className="text-xs text-amber-600 mt-2 font-medium">
                                            R$ 50 por aula. Ao converter para Card Mensal, o valor pago é estornado.
                                        </p>
                                    )}
                                    {studentForm.planType === 'Day Card' && (
                                        <p className="text-xs text-stone-500 mt-2 font-medium">
                                            R$ 50 por aula. Valor permanece no financeiro mesmo se converter para Card Mensal.
                                        </p>
                                    )}
                                    {studentForm.planType === 'Card Mensal' && (
                                        <p className="text-xs text-stone-500 mt-2 font-medium">
                                            R$ 200/mês. Aluno será marcado como inativo até o pagamento ser confirmado.
                                        </p>
                                    )}
                                </div>
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
                            </>
                        )}

                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={() => setShowStudentModal(false)}
                                className="px-6 py-3 bg-stone-200 text-stone-700 font-bold rounded-xl hover:bg-stone-300"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveStudent}
                                disabled={processing}
                                className="flex-1 py-3 bg-saibro-600 text-white font-bold rounded-xl hover:bg-saibro-700 disabled:opacity-50"
                            >
                                {processing ? <Loader2 className="animate-spin mx-auto" /> : 'Salvar'}
                            </button>
                        </div>
                    </div>
                </div>
            </StandardModal>

            <StandardModal isOpen={!!levelHistoryStudent} onClose={() => setLevelHistoryStudent(null)}>
                <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
                    <h3 className="text-lg font-bold">Evolução · {levelHistoryStudent?.name}</h3>
                    {!levelHistory.length ? <p className="text-sm text-stone-500">Ainda não há alterações de nível registradas.</p> : <ol className="space-y-3">{levelHistory.map(item => <li key={item.id} className="border-l-2 border-saibro-300 pl-3"><p className="font-semibold">{item.previous_level || 'Cadastro'} → {item.new_level}</p><p className="text-xs text-stone-500">{new Date(item.changed_at).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}</p>{item.observation && <p className="text-sm text-stone-600">{item.observation}</p>}</li>)}</ol>}
                </div>
            </StandardModal>

            {/* --- Payment Modal --- */}
            <StandardModal
                isOpen={showPaymentModal && !!paymentStudent}
                onClose={() => setShowPaymentModal(false)}
            >
                <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-stone-800">Registrar Pagamento</h3>
                        <button onClick={() => setShowPaymentModal(false)}><X className="text-stone-400" /></button>
                    </div>

                    <div className="bg-stone-50 p-4 rounded-xl mb-6">
                        <p className="text-sm text-stone-500 mb-1">Aluno</p>
                        <p className="font-bold text-lg text-stone-800">{paymentStudent?.name}</p>
                        <p className="text-xs text-stone-400 mt-1">{paymentStudent?.planType}</p>
                        <div className="h-px bg-stone-200 my-3"></div>
                        <div className="flex justify-between items-center">
                            <span className="text-stone-500 text-sm">Valor</span>
                            <span className="font-bold text-xl text-green-600">
                                R$ {paymentStudent ? getPaymentPrice(paymentStudent) : 0},00
                            </span>
                        </div>
                    </div>

                    <div className="mb-6">
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-2">Data do Pagamento</label>
                        <input
                            type="date"
                            value={paymentDate}
                            onChange={e => setPaymentDate(e.target.value)}
                            className="w-full p-3 border-2 border-stone-200 rounded-xl text-lg font-bold text-stone-800 focus:border-saibro-500 outline-hidden"
                        />
                        {paymentStudent?.planType === 'Card Mensal' && (
                            <p className="text-xs text-stone-400 mt-2">
                                O vencimento será n��m�G����ƭy�son: profiles.find(user => user.id === profile.profileId) }))
        .filter((entry): entry is { profile: StudentProfile; person: User } => !!entry.person);
    const visibleStudents = myStudents.filter(student => studentStatusFilter === 'all' || (student.studentStatus || 'active') === studentStatusFilter);
    const visibleMemberStudents = myMemberStudents.filter(student => studentStatusFilter === 'all' || student.profile.studentStatus === studentStatusFilter);
    const pendingExpiredCardStudents = myStudents.filter(student => {
        if (student.studentType === 'dependent' || student.planType !== 'Card Mensal' || student.studentStatus === 'paused') return false;
        const expiry = student.masterExpirationDate || '1970-01-01';
        const cardStatus = getCardStatus({
            relationship: 'non-socio',
            status: student.studentStatus || 'active',
            planType: student.planType,
            planStatus: student.planStatus,
            expirationDate: student.masterExpirationDate,
        }, formatDate(getNowInFortaleza()));
        const studentProfile = studentProfiles.find(profile => profile.nonSocioStudentId === student.id);
        return cardStatus === 'expired' && studentProfile?.cardExpiredReviewedFor !== expiry;
    });
    const expiredCardReviewKey = pendingExpiredCardStudents.map(student => `${student.id}:${student.masterExpirationDate || 'unknown'}`).join('|');

    useEffect(() => {
        if (pendingExpiredCardStudents.length > 0) setShowExpiredCardModal(true);
        else setShowExpiredCardModal(false);
    }, [expiredCardReviewKey, pendingExpiredCardStudents.length]);
    const myClasses = reservations
        .filter(r => r.type === 'Aula' && r.professorId === professorRecord?.id && r.status === 'active')
        .sort((a, b) => new Date(a.date + 'T' + a.startTime).getTime() - new Date(b.date + 'T' + b.startTime).getTime());

    const today = getNowInFortaleza().toISOString().split('T')[0];
    const todaysClasses = myClasses.filter(r => r.date === today);

    // --- HANDLERS ---
    const handleSaveStudent = async () => {
        // O professor logado já é o responsável, então não há professor a escolher.
        const problema = !professorRecord
            ? { message: 'Seu cadastro de professor não foi carregado.', hint: 'Recarregue a página e tente de novo.' }
            : validateStudentForm(studentForm);
        if (problema) {
            notify.warning(problema.message, { description: problema.hint });
            return;
        }

        if (!studentForm.technicalLevel) {
            notify.warning('Selecione o nível técnico do aluno.');
            return;
        }

        const studentData = {
            name: studentForm.name.trim(),
            phone: studentForm.phone || null,
            professor_id: studentForm.studentType === 'regular' ? professorRecord.id : null,
            student_type: studentForm.studentType,
            responsible_socio_id: studentForm.studentType === 'dependent' ? studentForm.responsibleSocioId : null,
            relationship_type: studentForm.studentType === 'dependent' ? studentForm.relationshipType : null,
            plan_type: studentForm.studentType === 'dependent' ? 'Dependente' : studentForm.planType,
            plan_status: editingStudent
                ? editingStudent.planStatus
                : (studentForm.studentType === 'dependent' ? 'active' : 'inactive')
        };

        if (editingStudent) {
            const { error } = await supabase
                .from('non_socio_students')
                .update(studentData)
                .eq('id', editingStudent.id);

            if (error) {
                notify.failure(error, 'Não foi possível salvar as alterações do aluno.', {
                    event: 'student_update_failed',
                    studentId: editingStudent.id,
                });
                return;
            }
            if (!editingStudent.studentProfileId) throw new Error('O perfil de aluno não foi localizado. Atualize a página e tente novamente.');
            const { error: levelError } = await supabase.rpc('set_student_level', {
                p_student_profile_id: editingStudent.studentProfileId,
                p_new_level: studentForm.technicalLevel,
                p_observation: null,
            });
            if (levelError) throw levelError;
            setStudents(prev => prev.map(s => s.id === editingStudent.id ? {
                ...s,
                name: studentData.name,
                phone: studentData.phone,
                planType: studentData.plan_type as any,
                planStatus: studentData.plan_status as any,
                professorId: studentData.professor_id,
                studentType: studentData.student_type as any,
                responsibleSocioId: studentData.responsible_socio_id,
                relationshipType: studentData.relationship_type as any,
                technicalLevel: studentForm.technicalLevel as StudentLevel,
            } : s));
            setStudentProfiles(prev => prev.map(profile => profile.id === editingStudent.studentProfileId ? { ...profile, technicalLevel: studentForm.technicalLevel as StudentLevel } : profile));
        } else {
            const { data, error } = await supabase
                .from('non_socio_students')
                .insert(studentData)
                .select()
                .single();

            if (error) {
                notify.failure(error, 'Não foi possível cadastrar o aluno.', {
                    event: 'student_create_failed',
                });
                return;
            }

            if (data) {
                const { data: profileData, error: profileError } = await supabase
                    .from('student_profiles')
                    .insert({
                        non_socio_student_id: data.id,
                        technical_level: studentForm.technicalLevel as StudentLevel,
                        student_status: 'active',
                        professor_id: professorRecord.id,
                    })
                    .select('id, non_socio_student_id, technical_level, student_status, professor_id')
                    .single();
                if (profileError) throw profileError;
                const newProfile: StudentProfile = {
                    id: profileData.id,
                    nonSocioStudentId: profileData.non_socio_student_id,
                    technicalLevel: profileData.technical_level as StudentLevel,
                    studentStatus: profileData.student_status,
                    professorId: profileData.professor_id,
                };
                setStudentProfiles(prev => [...prev, newProfile]);
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
                    relationshipType: data.relationship_type,
                    isActive: true,
                    studentProfileId: profileData.id,
                    technicalLevel: profileData.technical_level,
                    studentStatus: profileData.student_status,
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
                relationshipType: student.relationshipType || '',
                profileId: '',
                technicalLevel: student.technicalLevel || '',
            });
        } else {
            setEditingStudent(null);
            setStudentForm({ name: '', phone: '', studentType: 'regular', planType: 'Day Card', responsibleSocioId: '', relationshipType: '', profileId: '', technicalLevel: '' });
        }
        setShowStudentModal(true);
    };

    const handleDeleteStudent = async (id: string) => {
        const student = students.find(s => s.id === id);
        if (!student) return;

        if (!await confirm({
            title: `Desativar ${student.name}?`,
            description: 'Ele sai da sua lista de alunos ativos. O histórico de pagamentos é preservado.',
            confirmLabel: 'Desativar aluno',
        })) return;

        const { error } = await supabase
            .from('student_profiles')
            .update({ student_status: 'paused' })
            .eq('id', student.studentProfileId);

        if (error) {
            notify.failure(error, 'Não foi possível desativar o aluno.', {
                event: 'student_deactivate_failed',
                studentId: id,
            });
            return;
        }

        setStudents(prev => prev.map(s => s.id === id ? { ...s, isActive: false, studentStatus: 'paused' } : s));
        setStudentProfiles(prev => prev.map(profile => profile.id === student.studentProfileId ? { ...profile, studentStatus: 'paused' } : profile));
    };

    const reactivateStudent = async (studentProfile: StudentProfile) => {
        const { error } = await supabase.from('student_profiles').update({ student_status: 'active' }).eq('id', studentProfile.id);
        if (error) {
            notify.failure(error, 'Não foi possível reativar o aluno.');
            return;
        }
        setStudentProfiles(prev => prev.map(profile => profile.id === studentProfile.id ? { ...profile, studentStatus: 'active' } : profile));
        if (studentProfile.nonSocioStudentId) {
            setStudents(prev => prev.map(student => student.id === studentProfile.nonSocioStudentId ? { ...student, isActive: true, studentStatus: 'active' } : student));
        }
    };

    const toggleMemberStudentStatus = async (studentProfile: StudentProfile) => {
        const nextStatus = studentProfile.studentStatus === 'paused' ? 'active' : 'paused';
        const { error } = await supabase.from('student_profiles').update({ student_status: nextStatus }).eq('id', studentProfile.id);
        if (error) { notify.failure(error, 'Não foi possível atualizar a situação do aluno.'); return; }
        setStudentProfiles(prev => prev.map(profile => profile.id === studentProfile.id ? { ...profile, studentStatus: nextStatus } : profile));
    };

    const changeStudentLevel = async (studentProfile: StudentProfile, level: StudentLevel) => {
        const { error } = await supabase.rpc('set_student_level', { p_student_profile_id: studentProfile.id, p_new_level: level, p_observation: null });
        if (error) { notify.failure(error, 'Não foi possível atualizar o nível.'); return; }
        setStudentProfiles(prev => prev.map(profile => profile.id === studentProfile.id ? { ...profile, technicalLevel: level } : profile));
    };

    const showStudentLevelHistory = async (studentProfile: StudentProfile | undefined, name: string) => {
        if (!studentProfile) { notify.warning('Histórico indisponível para este perfil.'); return; }
        const { data, error } = await supabase.from('student_level_history').select('*').eq('student_profile_id', studentProfile.id).order('changed_at', { ascending: false });
        if (error) { notify.failure(error, 'Não foi possível carregar a evolução do aluno.'); return; }
        setLevelHistory(data || []); setLevelHistoryTitle(name);
    };

    const reviewExpiredCard = async (student: NonSocioStudent, action: 'keep' | 'pause') => {
        const studentProfile = studentProfiles.find(profile => profile.nonSocioStudentId === student.id);
        if (!studentProfile) return;
        const update = action === 'pause'
            ? { student_status: 'paused' }
            : { card_expired_reviewed_for: student.masterExpirationDate || '1970-01-01' };
        const { error } = await supabase.from('student_profiles').update(update).eq('id', studentProfile.id);
        if (error) {
            notify.failure(error, 'Não foi possível atualizar a situação deste aluno.');
            return;
        }
        setStudentProfiles(prev => prev.map(profile => profile.id === studentProfile.id
            ? action === 'pause'
                ? { ...profile, studentStatus: 'paused' }
                : { ...profile, cardExpiredReviewedFor: student.masterExpirationDate || '1970-01-01' }
            : profile));
        if (action === 'pause') {
            setStudents(prev => prev.map(item => item.id === student.id ? { ...item, isActive: false, studentStatus: 'paused' } : item));
        }
    };

    // --- Conversão para Card Mensal ---
    const handleOpenConvert = (student: NonSocioStudent) => {
        setConvertStudent(student);
        setConvertDate(formatDate(getNowInFortaleza()));
        setShowConvertModal(true);
    };

    const handleConfirmConvert = async () => {
        if (!convertStudent || !convertDate) return;
        setProcessing(true);

        try {
            const isoExp = addOneMonth(convertDate);
            const isExperimental = convertStudent.planType === 'Day Card Experimental';

            // 1. Se Day Card Experimental: cancelar pagamentos de R$ 50 existentes
            if (isExperimental) {
                const { data: existingPayments } = await supabase
                    .from('student_payments')
                    .select('id')
                    .eq('student_id', convertStudent.id)
                    .eq('status', 'active');

                if (existingPayments && existingPayments.length > 0) {
                    const paymentIds = existingPayments.map(p => p.id);
                    await supabase.from('student_payments')
                        .update({
                            status: 'cancelled',
                            cancelled_reason: 'Convertido para Card Mensal'
                        })
                        .in('id', paymentIds);
                }
            }

            // 2. Criar pagamento Card Mensal (R$ 200)
            const { error: payError } = await supabase.from('student_payments').insert({
                student_id: convertStudent.id,
                amount: CARD_MENSAL_PRICE,
                payment_date: new Date(convertDate + 'T12:00:00').toISOString(),
                valid_until: new Date(isoExp + 'T23:59:59').toISOString(),
                approved_by: (await supabase.auth.getUser()).data.user?.id,
                status: 'active'
            });
            if (payError) throw payError;

            // 3. Atualizar aluno para Card Mensal
            const { error: upError } = await supabase.from('non_socio_students').update({
                plan_type: 'Card Mensal',
                plan_status: 'active',
                master_expiration_date: isoExp
            }).eq('id', convertStudent.id);
            if (upError) throw upError;

            // Atualizar lista local
            setStudents(prev => prev.map(s => 
                s.id === convertStudent.id 
                    ? { ...s, planType: 'Card Mensal' as any, planStatus: 'active', masterExpirationDate: isoExp }
                    : s
            ));

            setShowConvertModal(false);
            setConvertStudent(null);

            notify.success(`Card Mensal ativado até ${formatDateBr(isoExp)}.`, {
                description: isExperimental
                    ? 'Os pagamentos do Day Card Experimental foram estornados.'
                    : 'Os pagamentos de Day Card anteriores foram mantidos.',
            });
        } catch (error) {
            notify.failure(error, 'Não foi possível converter para Card Mensal.', {
                event: 'student_plan_conversion_failed',
                studentId: convertStudent?.id,
            });
        } finally {
            setProcessing(false);
        }
    };

    const canConvertToMensal = (student: NonSocioStudent) => {
        if (student.studentType === 'dependent') return false;
        if (student.planType === 'Day Card Experimental') return true; // sempre permitir upgrade + estorno
        return student.planType === 'Day Card' && student.planStatus === 'active';
    };


    const handleDeleteClass = async (id: string) => {
        if (await confirm({
            title: 'Cancelar esta aula?',
            description: 'O horário volta a ficar livre na agenda.',
            confirmLabel: 'Cancelar aula',
            cancelLabel: 'Manter',
        })) {
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
                    <div className="flex gap-2">
                        {(['active', 'paused', 'all'] as const).map(status => <button key={status} onClick={() => setStudentStatusFilter(status)} className={`px-4 py-2 rounded-full text-sm font-semibold ${studentStatusFilter === status ? 'bg-saibro-600 text-white' : 'bg-stone-100 text-stone-600'}`}>{status === 'active' ? 'Ativos' : status === 'paused' ? 'Pausados' : 'Todos'}</button>)}
                    </div>
                    <button
                        onClick={() => openStudentModal()}
                        className="w-full py-3 border-2 border-dashed border-saibro-300 text-saibro-600 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-saibro-50 transition-colors"
                    >
                        <Plus size={20} /> Cadastrar Novo Aluno
                    </button>

                    <div className="space-y-6">
                        {/* PENDING / EXPIRED SECTION */}
                        {studentStatusFilter !== 'paused' && visibleStudents.some(s => {
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
                                        {visibleStudents.filter(s => {
                                            if (s.studentType === 'dependent') return false;
                                            const isMaster = s.planType === 'Card Mensal';
                                            const isExpired = isMaster && (!s.masterExpirationDate || new Date(s.masterExpirationDate + 'T00:00:00') < getNowInFortaleza());
                                            return s.planStatus !== 'active' || isExpired;
                                        }).map(student => (
                                            <StudentCard key={student.id} student={student} onEdit={openStudentModal} onToggleStatus={() => handleDeleteStudent(student.id)} onConvert={handleOpenConvert} onHistory={s => void showStudentLevelHistory(studentProfiles.find(p => p.id === s.studentProfileId), s.name)} canConvert={canConvertToMensal(student)} />
                                        ))}
                                    </div>
                                </div>
                            )}

                        {/* ACTIVE SECTION */}
                        <div>
                            <h4 className="text-sm font-bold text-stone-500 uppercase mb-2">{studentStatusFilter === 'active' ? 'Alunos ativos' : 'Alunos pausados'}</h4>
                            <div className="grid gap-3">
                                {visibleStudents.map(student => (
                                    <StudentCard key={student.id} student={student} onEdit={openStudentModal} onToggleStatus={() => { const p = studentProfiles.find(profile => profile.id === student.studentProfileId); if (student.studentStatus === 'paused' && p) void reactivateStudent(p); else void handleDeleteStudent(student.id); }} onConvert={handleOpenConvert} onHistory={s => void showStudentLevelHistory(studentProfiles.find(p => p.id === s.studentProfileId), s.name)} canConvert={canConvertToMensal(student)} />
                                ))}
                                {visibleMemberStudents.map(({ profile, person }) => <div key={profile.id} className="bg-white rounded-xl border p-4 flex items-center justify-between gap-3"><div><p className="font-bold text-stone-800">{person.name}</p><p className="text-sm text-stone-500">Sócio</p></div><select aria-label={`Nível de ${person.name}`} value={profile.technicalLevel || ''} onChange={e => e.target.value && void changeStudentLevel(profile, e.target.value as StudentLevel)} className="max-w-44 rounded-lg border px-2 py-2 text-sm"><option value="">Nível</option>{STUDENT_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}</select><button onClick={() => void showStudentLevelHistory(profile, person.name)} className="text-sm font-semibold text-stone-600">Evolução</button><button onClick={() => toggleMemberStudentStatus(profile)} className="text-sm font-semibold text-saibro-700">{profile.studentStatus === 'paused' ? 'Reativar' : 'Pausar'}</button></div>)}
                                {visibleStudents.length + visibleMemberStudents.length === 0 && <p className="text-stone-400 text-sm italic">Nenhum aluno encontrado.</p>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* --- MODAL: STUDENT FORM --- */}
            <StandardModal 
                isOpen={showStudentModal} 
                onClose={() => setShowStudentModal(false)}
                verticalAlign="start"
            >
                <div className="bg-white rounded-3xl p-6 w-full max-w-md space-y-5 shadow-2xl shadow-stone-300/50 border-2 border-stone-100 max-h-[90vh] overflow-y-auto">
                    {/* Header */}
                    <div className="bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500 px-6 py-4 -mx-6 -mt-6 mb-6 rounded-t-3xl shadow-xl shadow-saibro-300/30 border-b-2 border-white/10">
                        <h3 className="text-xl font-black uppercase tracking-tight text-white drop-shadow-lg">
                            {editingStudent ? '✏️ Editar Aluno' : '➕ Novo Aluno'}
                        </h3>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-stone-500 mb-1">Nível técnico</label>
                            <select value={studentForm.technicalLevel} onChange={e => setStudentForm({ ...studentForm, technicalLevel: e.target.value as StudentLevel })} className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200">
                                <option value="">Selecione o nível</option>
                                {STUDENT_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-black text-stone-500 uppercase mb-2 tracking-wide">Nome Completo</label>
                            <input
                                type="text"
                                value={studentForm.name}
                                onChange={e => setStudentForm({ ...studentForm, name: e.target.value })}
                                className="w-full p-3 bg-linear-to-br from-stone-50 to-stone-100 rounded-xl border-2 border-stone-200 focus:border-saibro-500 focus:ring-2 focus:ring-saibro-200 outline-hidden transition-all"
                                placeholder="Nome completo"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-black text-stone-500 uppercase mb-2 tracking-wide">Telefone</label>
                            <input
                                type="text"
                                value={studentForm.phone}
                                onChange={e => setStudentForm({ ...studentForm, phone: e.target.value })}
                                className="w-full p-3 bg-linear-to-br from-stone-50 to-stone-100 rounded-xl border-2 border-stone-200 focus:border-saibro-500 focus:ring-2 focus:ring-saibro-200 outline-hidden transition-all"
                                placeholder="(00) 00000-0000"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-black text-stone-500 uppercase mb-2 tracking-wide">Tipo de Aluno</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setStudentForm({ ...studentForm, studentType: 'regular' })}
                                    className={`py-3 px-4 rounded-xl font-black text-xs uppercase tracking-tight shadow-lg transition-all duration-200 ${studentForm.studentType === 'regular'
                                        ? 'bg-linear-to-br from-saibro-600 to-saibro-700 text-white shadow-saibro-200 scale-105'
                                        : 'bg-linear-to-br from-stone-50 to-stone-100 text-stone-600 hover:shadow-xl hover:scale-105 border-2 border-stone-200'
                                    }`}
                                >
                                    Regular
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setStudentForm({ ...studentForm, studentType: 'dependent' })}
                                    className={`py-3 px-4 rounded-xl font-black text-xs uppercase tracking-tight shadow-lg transition-all duration-200 ${studentForm.studentType === 'dependent'
                                        ? 'bg-linear-to-br from-blue-600 to-blue-700 text-white shadow-blue-200 scale-105'
                                        : 'bg-linear-to-br from-stone-50 to-stone-100 text-stone-600 hover:shadow-xl hover:scale-105 border-2 border-stone-200'
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
                                    <label className="block text-xs font-black text-stone-500 uppercase mb-2 tracking-wide">Tipo de Plano</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setStudentForm({ ...studentForm, planType: 'Day Card' })}
                                            className={`py-3 px-2 rounded-xl font-black text-[10px] uppercase tracking-tight shadow-lg transition-all duration-200 ${studentForm.planType === 'Day Card'
                                                ? 'bg-linear-to-br from-saibro-600 to-saibro-700 text-white shadow-saibro-200 scale-105'
                                                : 'bg-linear-to-br from-stone-50 to-stone-100 text-stone-600 hover:shadow-xl hover:scale-105 border-2 border-stone-200'
                                            }`}
                                        >
                                            Day Card
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStudentForm({ ...studentForm, planType: 'Day Card Experimental' })}
                                            className={`py-3 px-2 rounded-xl font-black text-[10px] uppercase tracking-tight shadow-lg transition-all duration-200 ${studentForm.planType === 'Day Card Experimental'
                                                ? 'bg-linear-to-br from-amber-600 to-amber-700 text-white shadow-amber-200 scale-105'
                                                : 'bg-linear-to-br from-stone-50 to-stone-100 text-stone-600 hover:shadow-xl hover:scale-105 border-2 border-stone-200'
                                            }`}
                                        >
                                            Experimental
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStudentForm({ ...studentForm, planType: 'Card Mensal' })}
                                            className={`py-3 px-2 rounded-xl font-black text-[10px] uppercase tracking-tight shadow-lg transition-all duration-200 ${studentForm.planType === 'Card Mensal'
                                                ? 'bg-linear-to-br from-purple-600 to-purple-700 text-white shadow-purple-200 scale-105'
                                                : 'bg-linear-to-br from-stone-50 to-stone-100 text-stone-600 hover:shadow-xl hover:scale-105 border-2 border-stone-200'
                                            }`}
                                        >
                                            Mensal
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
                                    <label className="block text-xs font-black text-stone-500 uppercase mb-2 tracking-wide">Sócio Responsável</label>
                                    <select
                                        value={studentForm.responsibleSocioId}
                                        onChange={e => setStudentForm({ ...studentForm, responsibleSocioId: e.target.value })}
                                        className="w-full p-3 bg-linear-to-br from-stone-50 to-stone-100 rounded-xl border-2 border-stone-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-hidden transition-all font-bold text-sm"
                                    >
                                        <option value="">Selecione...</option>
                                        {socios.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-stone-500 uppercase mb-2 tracking-wide">Parentesco</label>
                                    <select
                                        value={studentForm.relationshipType}
                                        onChange={e => setStudentForm({ ...studentForm, relationshipType: e.target.value as RelationshipType })}
                                        className="w-full p-3 bg-linear-to-br from-stone-50 to-stone-100 rounded-xl border-2 border-stone-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-hidden transition-all font-bold text-sm"
                                    >
                                        <option value="">Selecione...</option>
                                        <option value="filho">Filho</option>
                                        <option value="filha">Filha</option>
                                        <option value="esposo">Esposo</option>
                                        <option value="esposa">Esposa</option>
                                        <option value="outro">Outro</option>
                                    </select>
                                </div>
                                <div className="bg-linear-to-br from-blue-50 to-blue-100 p-4 rounded-xl border-2 border-blue-200 shadow-lg shadow-blue-100">
                                    <p className="text-xs font-bold text-blue-700">
                                        💡 Dependentes não possuem cobrança. Vinculados ao sócio responsável.
                                    </p>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex gap-3 pt-5 border-t-2 border-stone-100">
                        <button
                            onClick={() => setShowStudentModal(false)}
                            className="flex-1 py-3 bg-linear-to-br from-stone-50 to-stone-100 text-stone-600 font-black text-xs uppercase tracking-tight rounded-xl shadow-lg shadow-stone-200 hover:shadow-xl hover:scale-105 transition-all duration-200 border-2 border-stone-200"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSaveStudent}
                            className="flex-1 py-3 bg-linear-to-br from-saibro-600 to-saibro-700 text-white font-black text-xs uppercase tracking-tight rounded-xl shadow-lg shadow-saibro-200 hover:shadow-xl hover:scale-105 transition-all duration-200"
                        >
                            💾 Salvar
                        </button>
                    </div>
                </div>
            </StandardModal>

            {showExpiredCardModal && pendingExpiredCardStudents.length > 0 && (
                <StandardModal isOpen onClose={() => { void Promise.all(pendingExpiredCardStudents.map(student => reviewExpiredCard(student, 'keep'))); setShowExpiredCardModal(false); }} verticalAlign="center">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
                        <h3 className="text-lg font-bold text-stone-800">Cards mensais vencidos</h3>
                        <p className="text-sm text-stone-500">O vencimento não encerra o aluno. Escolha como organizar sua lista.</p>
                        {pendingExpiredCardStudents.map(student => <div key={student.id} className="border rounded-xl p-3 flex flex-col gap-2"><div><p className="font-semibold">{student.name}</p><p className="text-sm text-red-600">Card vencido em {student.masterExpirationDate ? formatDateBr(student.masterExpirationDate) : 'data não informada'}</p></div><div className="flex gap-2"><button onClick={() => void reviewExpiredCard(student, 'keep')} className="flex-1 rounded-lg bg-stone-100 py-2 text-sm">Manter aluno</button><button onClick={() => void reviewExpiredCard(student, 'pause')} className="flex-1 rounded-lg bg-saibro-600 text-white py-2 text-sm">Pausar aluno</button></div></div>)}
                    </div>
                </StandardModal>
            )}

            {levelHistoryTitle && (
                <StandardModal isOpen onClose={() => setLevelHistoryTitle('')} verticalAlign="center">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
                        <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Evolução · {levelHistoryTitle}</h3><button onClick={() => setLevelHistoryTitle('')} aria-label="Fechar histórico"><X size={18} /></button></div>
                        {levelHistory.length === 0 ? <p className="text-sm text-stone-500">Ainda não há alterações de nível registradas.</p> : <ol className="space-y-3">{levelHistory.map(entry => <li key={entry.id} className="border-l-2 border-saibro-300 pl-3"><p className="font-semibold text-stone-800">{entry.previous_level || 'Cadastro'} → {entry.new_level}</p><p className="text-xs text-stone-500">{new Date(entry.changed_at).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}{entry.changed_by ? ` · ${profiles.find(profile => profile.id === entry.changed_by)?.name || 'Professor'}` : ''}</p>{entry.observation && <p className="text-sm text-stone-600">{entry.observation}</p>}</li>)}</ol>}
                    </div>
                </StandardModal>
            )}

            {/* --- Convert to Card Mensal Modal --- */}
            {showConvertModal && convertStudent && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-stone-800">Converter para Card Mensal</h3>
                            <button onClick={() => setShowConvertModal(false)}><X className="text-stone-400" /></button>
                        </div>

                        <div className="bg-stone-50 p-4 rounded-xl mb-4">
                            <p className="text-sm text-stone-500 mb-1">Aluno</p>
                            <p className="font-bold text-lg text-stone-800">{convertStudent.name}</p>
                            <p className="text-xs text-stone-400 mt-1">Plano atual: {convertStudent.planType}</p>
                        </div>

                        {convertStudent.planType === 'Day Card Experimental' && (
                            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-4">
                                <p className="text-sm font-bold text-amber-800 mb-1">Estorno automático</p>
                                <p className="text-xs text-amber-700">
                                    Os pagamentos de R$ 50 (Day Card Experimental) serão estornados e substituídos pelo Card Mensal de R$ 200.
                                </p>
                            </div>
                        )}

                        {convertStudent.planType === 'Day Card' && (
                            <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl mb-4">
                                <p className="text-sm font-bold text-blue-800 mb-1">Sem estorno</p>
                                <p className="text-xs text-blue-700">
                                    Os pagamentos de R$ 50 (Day Card) permanecem no financeiro. O Card Mensal de R$ 200 será adicionado.
                                </p>
                            </div>
                        )}

                        <div className="bg-stone-50 p-4 rounded-xl mb-4">
                            <div className="flex justify-between items-center">
                                <span className="text-stone-500 text-sm">Novo valor</span>
                                <span className="font-bold text-xl text-green-600">R$ {CARD_MENSAL_PRICE},00</span>
                            </div>
                        </div>

                        <div className="mb-6">
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-2">Data do Pagamento</label>
                            <input
                                type="date"
                                value={convertDate}
                                onChange={e => setConvertDate(e.target.value)}
                                className="w-full p-3 border-2 border-stone-200 rounded-xl text-lg font-bold text-stone-800 focus:border-saibro-500 outline-hidden"
                            />
                            <p className="text-xs text-stone-400 mt-2">
                                O vencimento será calculado para <b>1 mês</b> após esta data.
                            </p>
                        </div>

                        <button
                            onClick={handleConfirmConvert}
                            disabled={processing}
                            className="w-full py-4 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-bold shadow-lg shadow-purple-100 flex justify-center items-center gap-2 disabled:opacity-50"
                        >
                            {processing ? <Loader2 className="animate-spin" /> : <>
                                <CheckCircle size={20} /> Confirmar Conversão
                            </>}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
