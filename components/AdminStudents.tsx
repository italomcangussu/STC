import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { NonSocioStudent, Professor, User, RelationshipType } from '../types';
import {
    Users, Plus, Search, Edit, Trash2, CheckCircle, AlertCircle,
    Calendar, Loader2, DollarSign, X, UserPlus
} from 'lucide-react';
import { getNowInFortaleza, formatDate, formatDateBr } from '../utils';
import { StandardModal } from './StandardModal';

const CARD_MENSAL_PRICE = 200;

export const AdminStudents: React.FC = () => {
    const [students, setStudents] = useState<NonSocioStudent[]>([]);
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [socios, setSocios] = useState<User[]>([]); // Lista de sócios para dependentes
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
        planType: 'Day Card' as 'Day Card' | 'Card Mensal'
    });

    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentStudent, setPaymentStudent] = useState<NonSocioStudent | null>(null);
    const [paymentDate, setPaymentDate] = useState(formatDate(getNowInFortaleza()));
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () =>{
        setLoading(true);
        const { data: sData } = await supabase.from('non_socio_students').select('*').order('name');
        const { data: pData } = await supabase.from('professors').select('*').eq('is_active', true);
        const { data: sociosData } = await supabase
            .from('profiles')
            .select('id, name, email, phone, role')
            .eq('role', 'socio')
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
        // Validação aprimorada
        if (!studentForm.name || !studentForm.name.trim()) {
            return alert('❌ O nome do aluno é obrigatório.');
        }

        // Validações específicas por tipo
        if (studentForm.studentType === 'dependent') {
            // Para dependentes: responsável sócio e relação são obrigatórios
            if (!studentForm.responsibleSocioId) {
                return alert('❌ Selecione o sócio responsável pelo dependente.');
            }
            if (!studentForm.relationshipType) {
                return alert('❌ Selecione o tipo de relacionamento.');
            }
        } else {
            // Para alunos regulares: professor é obrigatório SE houver professores
            if (professors.length > 0 && !studentForm.professorId) {
                return alert('❌ Selecione um professor responsável.');
            }
        }

        setProcessing(true);
        try {
            const studentData = {
                name: studentForm.name,
                phone: studentForm.phone,
                professor_id: studentForm.studentType === 'regular' ? (studentForm.professorId || null) : null,
                student_type: studentForm.studentType,
                responsible_socio_id: studentForm.studentType === 'dependent' ? studentForm.responsibleSocioId : null,
                relationship_type: studentForm.studentType === 'dependent' ? studentForm.relationshipType : null,
                plan_type: studentForm.studentType === 'dependent' ? 'Dependente' : studentForm.planType,
                plan_status: studentForm.studentType === 'dependent' ? 'active' : 'inactive'
            };

            if (editingStudent) {
                await supabase.from('non_socio_students').update(studentData).eq('id', editingStudent.id);
            } else {
                await supabase.from('non_socio_students').insert(studentData);
            }
            await fetchData();
            setShowStudentModal(false);
            setEditingStudent(null);
            setStudentForm({ name: '', phone: '', professorId: '', studentType: 'regular', responsibleSocioId: '', relationshipType: '' });
            alert('✅ Aluno salvo com sucesso!');
        } catch (error: any) {
            console.error('Erro ao salvar aluno:', error);
            alert('❌ Erro ao salvar: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteStudent = async (id: string) => {
        if (!confirm('Tem certeza? Isso apagará histórico e pagamentos.')) return;
        setProcessing(true);
        await supabase.from('non_socio_students').delete().eq('id', id);
        fetchData();
        setProcessing(false);
    };

    // --- Payment Logic ---
    const handleOpenPayment = (student: NonSocioStudent) => {
        setPaymentStudent(student);
        setPaymentDate(formatDate(getNowInFortaleza()));
        setShowPaymentModal(true);
    };

    const handleConfirmPayment = async () => {
        if (!paymentStudent || !paymentDate) return;
        setProcessing(true);

        try {
            // Calculate Expiration: Payment Date + 1 Month
            // Example: 2026-01-15 -> 2026-02-15
            // Handle edge cases: Jan 31 -> Feb 28/29?
            const payDate = new Date(paymentDate + 'T00:00:00');
            // We want same day next month
            const expDate = new Date(payDate);
            expDate.setMonth(expDate.getMonth() + 1);

            // Edge case check: Jan 31 -> Mar 3 is wrong, should be last day of Feb?
            // JS setMonth handles overflow automatically (Jan 31 + 1 mo -> Feb 28/29 is hard, usually goes to Mar 2/3)
            // Let's implement strict "Same Day or Last Day of Month" if needed?
            // Standard business logic usually accepts overflow or snaps to last day.
            // Let's use straightforward JS date math unless user complains. Jan 31 -> Mar 3 gives 31 days. Fair.

            const isoExp = expDate.toISOString().split('T')[0];

            // 1. Insert Payment Record
            const { error: payError } = await supabase.from('student_payments').insert({
                student_id: paymentStudent.id,
                amount: CARD_MENSAL_PRICE,
                payment_date: getNowInFortaleza().toISOString(), // save full timestamp with offset? using provided date at 00:00
                valid_until: expDate.toISOString(),
                approved_by: (await supabase.auth.getUser()).data.user?.id
            });
            if (payError) throw payError;

            // 2. Update Student Status
            const { error: upError } = await supabase.from('non_socio_students').update({
                plan_type: 'Card Mensal',
                plan_status: 'active',
                master_expiration_date: isoExp
            }).eq('id', paymentStudent.id);
            if (upError) throw upError;

            fetchData();
            setShowPaymentModal(false);
            setPaymentStudent(null);
            alert(`Pagamento registrado! Vencimento: ${isoExp}`);

        } catch (error: any) {
            alert('Erro ao registrar pagamento: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    // --- Render ---
    const filteredStudents = students.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()));

    return (
        <div className="p-4 md:p-6 pb-40 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
                        <Users className="text-saibro-500" /> Gestão de Alunos (Non-Sócio)
                    </h1>
                    <p className="text-sm text-stone-500">Cadastre alunos e gerencie o Card Mensal</p>
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
            <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100 flex items-center gap-2">
                <Search className="text-stone-400" size={20} />
                <input
                    type="text"
                    placeholder="Buscar aluno..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    className="flex-1 outline-none text-stone-600"
                />
            </div>

            {/* List */}
            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-saibro-500" /></div>
            ) : (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                    {filteredStudents.map(student => {
                        const isExpired = !student.masterExpirationDate || new Date(student.masterExpirationDate + 'T00:00:00') < getNowInFortaleza();
                        const isActive = student.planStatus === 'active' && !isExpired;
                        const profName = professors.find(p => p.id === student.professorId)?.name || 'N/A';

                        return (
                            <div key={student.id} className={`relative p-5 rounded-2xl border-2 transition-all ${isActive ? 'bg-white border-green-100' : 'bg-stone-50 border-stone-100 opacity-90'}`}>
                                <div className="flex justify-between items-start mb-3">
                                    <div className={`p-2 rounded-lg ${student.studentType === 'dependent' ? 'bg-blue-50' : 'bg-stone-100'}`}>
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
                                                    planType: (student.planType === 'Day Card' || student.planType === 'Card Mensal') ? student.planType : 'Day Card'
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
                                            👨‍👩‍👧 Dependente
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
                                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                            student.studentType === 'dependent' 
                                                ? 'bg-blue-100 text-blue-700'
                                                : isActive ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-500'
                                        }`}>
                                            {student.studentType === 'dependent' 
                                                ? 'Dependente - Sem Cobrança' 
                                                : isActive ? 'Card Mensal Ativo' : 'Day Card / Inativo'}
                                        </span>
                                        {student.masterExpirationDate && student.studentType !== 'dependent' && (
                                            <span className={`text-xs font-mono font-bold ${isActive ? 'text-green-600' : 'text-red-400'}`}>
                                                Vence: {formatDateBr(student.masterExpirationDate)}
                                            </span>
                                        )}
                                    </div>

                                    {student.studentType !== 'dependent' && (
                                        <button
                                            onClick={() => handleOpenPayment(student)}
                                            className={`w-full py-2.5 rounded-xl font-bold text-sm flex justify-center items-center gap-2 transition-colors ${isActive
                                                ? 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                                : 'bg-green-500 text-white hover:bg-green-600 shadow-md shadow-green-100'
                                                }`}
                                        >
                                            <DollarSign size={16} />
                                            {isActive ? 'Renovar Plano' : 'Ativar Card Mensal'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* --- Modals --- */}
            {/* Student Edit Modal */}
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
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setStudentForm({ ...studentForm, planType: 'Day Card' })}
                                            className={`py-3 px-4 rounded-xl font-bold text-sm transition-all ${studentForm.planType === 'Day Card'
                                                ? 'bg-saibro-600 text-white shadow-lg'
                                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                                }`}
                                        >
                                            Day Card
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStudentForm({ ...studentForm, planType: 'Card Mensal' })}
                                            className={`py-3 px-4 rounded-xl font-bold text-sm transition-all ${studentForm.planType === 'Card Mensal'
                                                ? 'bg-saibro-600 text-white shadow-lg'
                                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                                }`}
                                        >
                                            Card Mensal
                                        </button>
                                    </div>
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

            {/* Payment Modal */}
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
                        <div className="h-px bg-stone-200 my-3"></div>
                        <div className="flex justify-between items-center">
                            <span className="text-stone-500 text-sm">Valor</span>
                            <span className="font-bold text-xl text-green-600">R$ {CARD_MENSAL_PRICE},00</span>
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
                        <p className="text-xs text-stone-400 mt-2">
                            O vencimento será calculado para <b>1 mês</b> após esta data.
                        </p>
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
        </div>
    );
};
