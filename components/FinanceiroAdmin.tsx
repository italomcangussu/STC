import React, { useState, useEffect, useMemo } from 'react';
import {
    DollarSign, CheckCircle, AlertCircle, Loader2, TrendingUp, Calendar, Users, ArrowUpRight
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Reservation, NonSocioStudent } from '../types';

// Day Use price constant
const DAY_USE_PRICE = 50;
const CARD_MENSAL_PRICE = 200;

interface StudentPayment {
    amount: number;
    paymentDate: string;
    studentId: string;
}

export const FinanceiroAdmin: React.FC = () => {
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [monthlyStudents, setMonthlyStudents] = useState<NonSocioStudent[]>([]);
    const [studentPayments, setStudentPayments] = useState<StudentPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
    const [processingPayment, setProcessingPayment] = useState<string | null>(null);

    const fetchData = async () => {
        setLoading(true);

        // 1. Fetch Reservations (Play & Aula) to calculate Day Uses
        const { data: resData } = await supabase
            .from('reservations')
            .select('*')
            .neq('status', 'cancelled')
            .order('date', { ascending: false });

        if (resData) {
            setReservations(resData.map(r => ({
                id: r.id,
                type: r.type,
                date: r.date,
                startTime: r.start_time,
                endTime: r.end_time,
                courtId: r.court_id,
                creatorId: r.creator_id,
                participantIds: r.participant_ids || [],
                guestName: r.guest_name,
                studentType: r.student_type,
                nonSocioStudentId: r.non_socio_student_id,
                status: r.status
            } as Reservation)));
        }

        // 2. Fetch Card Mensal Students
        const { data: studentsData } = await supabase
            .from('non_socio_students')
            .select('*')
            .eq('plan_type', 'Card Mensal')
            .order('name');

        if (studentsData) {
            setMonthlyStudents(studentsData.map(s => ({
                id: s.id,
                name: s.name,
                planType: s.plan_type,
                planStatus: s.plan_status,
                masterExpirationDate: s.master_expiration_date,
                professorId: s.professor_id
            })));
        }

        // 3. Fetch Historical Student Payments (for Card Mensal Revenue)
        const { data: paymentsData } = await supabase
            .from('student_payments')
            .select('amount, payment_date, student_id');

        if (paymentsData) {
            setStudentPayments(paymentsData.map(p => ({
                amount: p.amount,
                paymentDate: p.payment_date,
                studentId: p.student_id
            })));
        }

        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleRegisterPayment = async (student: NonSocioStudent) => {
        if (!confirm(`Confirmar pagamento de R$ ${CARD_MENSAL_PRICE},00 para ${student.name}? Isso ativará o plano por 30 dias.`)) return;

        setProcessingPayment(student.id);
        try {
            const now = new Date();
            const validUntil = new Date(now);
            validUntil.setDate(validUntil.getDate() + 30);

            const { error: auditError } = await supabase.from('student_payments').insert({
                student_id: student.id,
                amount: CARD_MENSAL_PRICE,
                valid_until: validUntil.toISOString(),
                payment_date: now.toISOString()
            });

            if (auditError) throw auditError;

            const { error: updateError } = await supabase
                .from('non_socio_students')
                .update({
                    plan_status: 'active',
                    master_expiration_date: validUntil.toISOString().split('T')[0]
                })
                .eq('id', student.id);

            if (updateError) throw updateError;

            alert('Pagamento registrado e plano ativado com sucesso!');
            fetchData();

        } catch (error: any) {
            console.error('Payment Error:', error);
            alert(`Erro ao registrar pagamento: ${error.message}`);
        } finally {
            setProcessingPayment(null);
        }
    };

    // Calculate Financial Data grouped by month
    const financialData = useMemo(() => {
        const grouped: Record<string, {
            friendlyDayCount: number,
            studentDayCount: number,
            cardMensalTotal: number
        }> = {};

        reservations.forEach(r => {
            const month = r.date.slice(0, 7);
            if (!grouped[month]) grouped[month] = { friendlyDayCount: 0, studentDayCount: 0, cardMensalTotal: 0 };

            if (r.type === 'Play' && r.guestName) {
                grouped[month].friendlyDayCount++;
            }

            if (r.type === 'Aula' && r.studentType === 'non-socio') {
                grouped[month].studentDayCount++;
            }
        });

        studentPayments.forEach(p => {
            const month = p.paymentDate.slice(0, 7);
            if (!grouped[month]) grouped[month] = { friendlyDayCount: 0, studentDayCount: 0, cardMensalTotal: 0 };
            grouped[month].cardMensalTotal += p.amount;
        });

        return Object.entries(grouped)
            .map(([month, data]) => ({
                month,
                friendlyCount: data.friendlyDayCount,
                friendlyTotal: data.friendlyDayCount * DAY_USE_PRICE,
                studentCount: data.studentDayCount,
                studentTotal: data.studentDayCount * DAY_USE_PRICE,
                cardMensalTotal: data.cardMensalTotal,
                grandTotal: (data.friendlyDayCount * DAY_USE_PRICE) + (data.studentDayCount * DAY_USE_PRICE) + data.cardMensalTotal
            }))
            .sort((a, b) => b.month.localeCompare(a.month));

    }, [reservations, studentPayments]);

    // Dashboard Metrics
    const dashboardMetrics = useMemo(() => {
        const totalAllTime = financialData.reduce((sum, m) => sum + m.grandTotal, 0);
        const thisMonth = financialData.find(m => m.month === new Date().toISOString().slice(0, 7));
        const pendingCount = monthlyStudents.filter(s => {
            const isExpired = !s.masterExpirationDate || new Date(s.masterExpirationDate) < new Date();
            const isInactive = s.planStatus !== 'active';
            return isExpired || isInactive;
        }).length;
        const activeCount = monthlyStudents.length - pendingCount;

        return {
            totalAllTime,
            thisMonthTotal: thisMonth?.grandTotal || 0,
            pendingPayments: pendingCount,
            activeSubscribers: activeCount,
            totalPayments: studentPayments.length
        };
    }, [financialData, monthlyStudents, studentPayments]);

    const currentMonthData = financialData.find(m => m.month === selectedMonth);

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-[50vh]">
                <Loader2 className="animate-spin text-saibro-500" size={48} />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-8">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-3 bg-linear-to-br from-green-500 to-emerald-600 rounded-2xl shadow-lg shadow-green-200">
                    <DollarSign size={28} className="text-white" />
                </div>
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-stone-800">Painel Financeiro</h1>
                    <p className="text-sm text-stone-500">Controle de receitas e mensalidades</p>
                </div>
            </div>

            {/* --- DASHBOARD CARDS --- */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-linear-to-br from-green-500 to-emerald-600 rounded-2xl p-4 text-white shadow-lg shadow-green-100">
                    <div className="flex items-center justify-between mb-2">
                        <TrendingUp size={20} className="opacity-80" />
                        <span className="text-[10px] font-bold uppercase bg-white/20 px-2 py-0.5 rounded">Total</span>
                    </div>
                    <p className="text-2xl md:text-3xl font-bold">R$ {dashboardMetrics.totalAllTime.toFixed(2)}</p>
                    <p className="text-xs opacity-80 mt-1">Receita Total</p>
                </div>

                <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <Calendar size={20} className="text-saibro-500" />
                        <ArrowUpRight size={16} className="text-green-500" />
                    </div>
                    <p className="text-2xl md:text-3xl font-bold text-stone-800">R$ {dashboardMetrics.thisMonthTotal.toFixed(2)}</p>
                    <p className="text-xs text-stone-500 mt-1">Este Mês</p>
                </div>

                <div className="bg-white rounded-2xl p-4 border border-orange-200 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <AlertCircle size={20} className="text-orange-500" />
                    </div>
                    <p className="text-2xl md:text-3xl font-bold text-orange-600">{dashboardMetrics.pendingPayments}</p>
                    <p className="text-xs text-stone-500 mt-1">Pendências</p>
                </div>

                <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <Users size={20} className="text-stone-500" />
                        <CheckCircle size={16} className="text-green-500" />
                    </div>
                    <p className="text-2xl md:text-3xl font-bold text-stone-800">{dashboardMetrics.activeSubscribers}</p>
                    <p className="text-xs text-stone-500 mt-1">Mensalistas Ativos</p>
                </div>
            </div>

            {/* --- SECTION 1: CARD MENSAL MANAGEMENT --- */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
                <h3 className="text-lg font-bold text-saibro-800 mb-4 flex items-center gap-2">
                    <CheckCircle className="text-saibro-500" size={20} /> Gestão de Mensalidades (Card Mensal)
                </h3>

                {/* PENDING / EXPIRED LIST */}
                <div className="mb-8">
                    <h4 className="text-sm font-bold text-orange-600 uppercase mb-3 flex items-center gap-2">
                        <AlertCircle size={16} /> Pendências (Aprovação Necessária / Vencidos)
                    </h4>
                    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                        {monthlyStudents.filter(s => {
                            const isExpired = !s.masterExpirationDate || new Date(s.masterExpirationDate) < new Date();
                            const isInactive = s.planStatus !== 'active';
                            return isExpired || isInactive;
                        }).length === 0 && <p className="text-stone-400 text-sm italic">Nenhuma pendência.</p>}

                        {monthlyStudents.filter(s => {
                            const isExpired = !s.masterExpirationDate || new Date(s.masterExpirationDate) < new Date();
                            const isInactive = s.planStatus !== 'active';
                            return isExpired || isInactive;
                        }).map(student => {
                            const isExpired = !student.masterExpirationDate || new Date(student.masterExpirationDate) < new Date();
                            return (
                                <div key={student.id} className="p-4 rounded-xl border-2 flex flex-col justify-between gap-3 bg-red-50 text-red-600 border-red-100">
                                    <div>
                                        <h4 className="font-bold text-lg text-stone-800">{student.name}</h4>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-[10px] font-bold uppercase tracking-wider bg-white/50 px-2 py-0.5 rounded border border-current">
                                                {student.planStatus === 'active' ? 'VENCIDO' : 'AGUARDANDO PAGAMENTO'}
                                            </span>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-xs font-medium mb-3">
                                            {isExpired
                                                ? `Venceu em: ${new Date(student.masterExpirationDate!).toLocaleDateString()}`
                                                : 'Novo Aluno (Sem validade)'}
                                        </p>
                                        <button
                                            onClick={() => handleRegisterPayment(student)}
                                            disabled={!!processingPayment}
                                            className="w-full py-2 bg-saibro-600 hover:bg-saibro-700 text-white rounded-lg font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition-all active:scale-95"
                                        >
                                            {processingPayment === student.id ? <Loader2 className="animate-spin" size={16} /> : <DollarSign size={16} />}
                                            Aprovar Pagamento (R$ {CARD_MENSAL_PRICE})
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* ACTIVE LIST */}
                <div>
                    <h4 className="text-sm font-bold text-stone-500 uppercase mb-3 flex items-center gap-2">
                        <CheckCircle size={16} /> Mensalistas Ativos
                    </h4>
                    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                        {monthlyStudents.filter(s => {
                            const isExpired = !s.masterExpirationDate || new Date(s.masterExpirationDate) < new Date();
                            const isInactive = s.planStatus !== 'active';
                            return !isExpired && !isInactive;
                        }).length === 0 && <p className="text-stone-400 text-sm italic">Nenhum mensalista ativo.</p>}

                        {monthlyStudents.filter(s => {
                            const isExpired = !s.masterExpirationDate || new Date(s.masterExpirationDate) < new Date();
                            const isInactive = s.planStatus !== 'active';
                            return !isExpired && !isInactive;
                        }).map(student => (
                            <div key={student.id} className="p-4 rounded-xl border border-green-200 bg-green-50 flex flex-col justify-between gap-3">
                                <div>
                                    <h4 className="font-bold text-lg text-green-900">{student.name}</h4>
                                    <p className="text-xs text-green-700 font-bold uppercase tracking-wider">Ativo</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-green-600 uppercase font-bold">Vence em</p>
                                    <p className="font-mono font-bold text-green-800">{new Date(student.masterExpirationDate!).toLocaleDateString()}</p>
                                    <button
                                        onClick={() => handleRegisterPayment(student)}
                                        className="mt-2 text-xs text-saibro-600 hover:text-saibro-800 underline font-bold"
                                    >
                                        Renovar Antecipado
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* --- SECTION 2: RELATÓRIO FINANCEIRO DETALHADO --- */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100 space-y-6">
                <h3 className="text-lg font-bold text-stone-700 flex items-center gap-2">
                    <DollarSign className="text-green-600" size={20} /> Relatório Financeiro Mensal
                </h3>

                {/* Month Selector */}
                <div>
                    <label className="text-xs text-stone-500 uppercase font-semibold block mb-2">Selecionar Mês</label>
                    <select
                        value={selectedMonth}
                        onChange={e => setSelectedMonth(e.target.value)}
                        className="w-full px-4 py-3 border border-stone-200 rounded-xl bg-white"
                    >
                        {financialData.map(m => (
                            <option key={m.month} value={m.month}>
                                {new Date(m.month + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Summary Cards for Selected Month */}
                {currentMonthData && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-stone-50 rounded-xl p-4 border border-stone-100">
                            <p className="text-[10px] text-stone-500 uppercase font-semibold">Day Use (Amistoso)</p>
                            <p className="text-xl font-bold text-saibro-600">{currentMonthData.friendlyCount}</p>
                            <p className="text-xs text-green-600 font-semibold">R$ {currentMonthData.friendlyTotal.toFixed(2)}</p>
                        </div>
                        <div className="bg-stone-50 rounded-xl p-4 border border-stone-100">
                            <p className="text-[10px] text-stone-500 uppercase font-semibold">Day Use (Aluno)</p>
                            <p className="text-xl font-bold text-saibro-600">{currentMonthData.studentCount}</p>
                            <p className="text-xs text-green-600 font-semibold">R$ {currentMonthData.studentTotal.toFixed(2)}</p>
                        </div>
                        <div className="bg-stone-50 rounded-xl p-4 border border-stone-100">
                            <p className="text-[10px] text-stone-500 uppercase font-semibold">Card Mensal</p>
                            <p className="text-xl font-bold text-saibro-600">-</p>
                            <p className="text-xs text-green-600 font-semibold">R$ {currentMonthData.cardMensalTotal.toFixed(2)}</p>
                        </div>
                        <div className="bg-saibro-600 rounded-xl p-4 text-white">
                            <p className="text-[10px] text-saibro-100 uppercase font-semibold">Total do Mês</p>
                            <p className="text-xl font-bold">R$ {currentMonthData.grandTotal.toFixed(2)}</p>
                        </div>
                    </div>
                )}

                {/* Detailed Table */}
                <div className="rounded-xl border border-stone-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-stone-50 text-stone-500 font-semibold uppercase text-xs">
                                <tr>
                                    <th className="px-4 py-3">Mês</th>
                                    <th className="px-4 py-3 text-right">Day Use (Amistoso)</th>
                                    <th className="px-4 py-3 text-right">Day Use (Aluno)</th>
                                    <th className="px-4 py-3 text-right">Card Mensal</th>
                                    <th className="px-4 py-3 text-right text-green-700">Total Arrecadado</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {financialData.map(m => (
                                    <tr key={m.month} className="hover:bg-stone-50 transition-colors">
                                        <td className="px-4 py-3 font-medium text-stone-700">
                                            {new Date(m.month + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="text-stone-800">{m.friendlyCount} <span className="text-xs text-stone-400">un</span></div>
                                            <div className="text-xs text-green-600">R$ {m.friendlyTotal.toFixed(2)}</div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="text-stone-800">{m.studentCount} <span className="text-xs text-stone-400">un</span></div>
                                            <div className="text-xs text-green-600">R$ {m.studentTotal.toFixed(2)}</div>
                                        </td>
                                        <td className="px-4 py-3 text-right text-green-600 font-medium">
                                            R$ {m.cardMensalTotal.toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-saibro-700 bg-saibro-50/50">
                                            R$ {m.grandTotal.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
