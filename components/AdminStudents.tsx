import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { NonSocioStudent, Professor, User, RelationshipType } from '../types';
import {
    Users, Plus, Search, Edit, Trash2, CheckCircle,
    Calendar, Loader2, DollarSign, X, UserPlus, ArrowUpCircle
} from 'lucide-react';
import { getNowInFortaleza, formatDate, formatDateBr } from '../utils';
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
    const [students, setStudents] = useState<NonSocioStudent[]>([]);
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [socios, setSocios] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [studentTypeFilter, setStudentTypeFilter] = useState<'all' | 'regular' | 'dependent'>('all');

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
        planType: 'Day Card' as RegularPlanType
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
        const { data: sData } = await supabase.from('non_socio_students').select('*').order('name');
        const { data: pData } = await supabase.from('professors').select('*').eq('is_active', true);
        const { data: sociosData } = await supabase
            .from('profiles')
            .select('id, name, email, phone, role')
            .in('role', ['socio', 'admin'])
            .eq('is_active', true)
            .order('name');

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
                relationshipType: s.relationship_type
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
        if (!studentForm.name || !studentForm.name.trim()) {
            return alert('O nome do aluno é obrigatório.');
        }

        if (studentForm.studentType === 'dependent') {
            if (!studentForm.responsibleSocioId) {
                return alert('Selecione o sócio responsável pelo dependente.');
            }
            if (!studentForm.relationshipType) {
                return alert('Selecione o tipo de relacionamento.');
            }
        } else {
            if (professors.length > 0 && !studentForm.professorId) {
                return alert('Selecione um professor responsável.');
            }
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
                plan_status: studentForm.studentType === 'dependent' ? 'active' : 'inactive'
            };

            if (editingStudent) {
                const { error } = await supabase.from('non_socio_students').update(studentData).eq('id', editingStudent.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('non_socio_students').insert(studentData);
                if (error) throw error;
            }
            await fetchData();
            setShowStudentModal(false);
            setEditingStudent(null);
            setStudentForm({ name: '', phone: '', professorId: '', studentType: 'regular', responsibleSocioId: '', relationshipType: '', planType: 'Day Card' });
            alert('Aluno salvo com sucesso!');
        } catch (error: any) {
            console.error('Erro ao salvar aluno:', error);
            alert('Erro ao salvar: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteStudent = async (id: string) => {
        if (!confirm('Tem certeza? Isso apagará histórico e pagamentos.')) return;
        setProcessing(true);
        try {
            const { error } = await supabase.from('non_socio_students').delete().eq('id', id);
            if (error) throw error;
            await fetchData();
        } catch (error: any) {
            alert('Erro ao excluir aluno: ' + error.message);
        } finally {
            setProcessing(false);
        }
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
            alert(isCardMensal
                ? `Pagamento Card Mensal registrado! Vencimento: ${formatDateBr(isoExp!)}`
                : `Pagamento Day Card de R$ ${price},00 registrado!`
            );
        } catch (error: any) {
            alert('Erro ao registrar pagamento: ' + error.message);
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

            if (isExperimental) {
                alert(`Conversão realizada! Pagamento(s) Day Card Experimental estornado(s). Card Mensal ativado até ${formatDateBr(isoExp)}.`);
            } else {
                alert(`Conversão realizada! Card Mensal ativado até ${formatDateBr(isoExp)}. Pagamento(s) Day Card anteriores mantidos.`);
            }
        } catch (error: any) {
            alert('Erro na conversão: ' + error.message);
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
        return matchesName && matchesType;
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
        return (student.planType === 'Day Card' || student.planType === 'Day Card Experimental')
            && student.planStatus === 'active'
            && student.studentType !== 'dependent';
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
                        setStudentForm({ name: '', phone: '', professorId: '', studentType: 'regular', responsibleSocioId: '', relationshipType: '', planType: 'Day Card' });
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
                        className="flex-1 outline-none text-stone-600"
                    />
                </div>
                <div className="flex gap-2">
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

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-saibro-500" /></div>
            ) : (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {filteredStudents.map(student => {
                        const isCardMensal = student.planType === 'Card Mensal';
                        const isExpired = isCardMensal && (!student.masterExpirationDate || new Date(student.masterExpirationDate + 'T23:59:59') < getNowInFortaleza());
                        const isActive = student.planStatus === 'active' && (!isCardMensal || !isExpired);
                        const profName = professors.find(p => p.id === student.professorId)?.name || 'N/A';

                        return (
                            <div key={student.id} className={`relative p-5 rounded-2xl border-2 transition-all ${isActive ? 'bg-white border-green-100' : 'bg-stone-50 border-stone-100 opacity-90'}`}>
                                <div className="flex justify-between items-start mb-3">
                                    <div className={`p-2 rounded-lg ${student.studentType === 'dependent' ? 'bg-blue-50' : student.planType === 'Day Card Experimental' ? 'bg-amber-50' : 'bg-stone-100'}`}>
                                        {student.studentType === 'dependent' ? (
                                            <UserPlus size={20} className="text-blue-600" />
                                        ) : (
                                            <Users size={20} className={isActive ? 'text-green-600' : 'text-stone-400'} />
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
                                                        : 'Day Card')
                                                });
                                                setShowStudentModal(true);
                                            }}
                                            className="p-2 hover:bg-stone-100 rounded-lg text-stone-500"
                                        >
                                            <Edit size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteStudent(student.id)}
                                            className="p-2 hover:bg-red-50 rounded-lg text-red-500"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                <h3 className="font-bold text-lg text-stone-800 mb-1">{student.name}</h3>

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
                            className="w-full p-3 border-2 border-stone-200 rounded-xl text-lg font-bold text-stone-800 focus:border-saibro-500 outline-none"
                        />
                        {paymentStudent?.planType === 'Card Mensal' && (
                            <p className="text-xs text-stone-400 mt-2">
                                O vencimento será calculado para <b>1 mês</b> após esta data.
                            </p>
                        )}
                    </div>

                    <button
                        onClick={handleConfirmPayment}
                        disabled={processing}
                        className="w-full py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold shadow-lg shadow-green-100 flex justify-center items-center gap-2"
                    >
                        {processing ? <Loader2 className="animate-spin" /> : <>
                            <CheckCircle size={20} /> Confirmar Pagamento
                        </>}
                    </button>
                </div>
            </StandardModal>

            {/* --- Convert to Card Mensal Modal --- */}
            <StandardModal
                isOpen={showConvertModal && !!convertStudent}
                onClose={() => setShowConvertModal(false)}
            >
                <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-stone-800">Converter para Card Mensal</h3>
                        <button onClick={() => setShowConvertModal(false)}><X className="text-stone-400" /></button>
                    </div>

                    <div className="bg-stone-50 p-4 rounded-xl mb-4">
                        <p className="text-sm text-stone-500 mb-1">Aluno</p>
                        <p className="font-bold text-lg text-stone-800">{convertStudent?.name}</p>
                        <p className="text-xs text-stone-400 mt-1">Plano atual: {convertStudent?.planType}</p>
                    </div>

                    {convertStudent?.planType === 'Day Card Experimental' && (
                        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-4">
                            <p className="text-sm font-bold text-amber-800 mb-1">Estorno automático</p>
                            <p className="text-xs text-amber-700">
                                Os pagamentos de R$ 50 (Day Card Experimental) serão estornados e substituídos pelo Card Mensal de R$ 200.
                            </p>
                        </div>
                    )}

                    {convertStudent?.planType === 'Day Card' && (
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
                            className="w-full p-3 border-2 border-stone-200 rounded-xl text-lg font-bold text-stone-800 focus:border-saibro-500 outline-none"
                        />
                        <p className="text-xs text-stone-400 mt-2">
                            Vencimento: <b>{formatDateBr(addOneMonth(convertDate))}</b>
                        </p>
                    </div>

                    <button
                        onClick={handleConfirmConvert}
                        disabled={processing}
                        className="w-full py-4 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-bold shadow-lg shadow-purple-100 flex justify-center items-center gap-2"
                    >
                        {processing ? <Loader2 className="animate-spin" /> : <>
                            <ArrowUpCircle size={20} /> Confirmar Conversão
                        </>}
                    </button>
                </div>
            </StandardModal>
        </div>
    );
};
