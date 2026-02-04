import React, { useState, useEffect, useMemo } from 'react';
import {
    DollarSign, CheckCircle, AlertCircle, Loader2, TrendingUp, Calendar, Users, ArrowUpRight, Download, PieChart as PieChartIcon, BarChart as BarChartIcon, Trash2, Sparkles, CreditCard, UserCheck, Receipt
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Reservation, NonSocioStudent } from '../types';
import { getNowInFortaleza, formatDateBr } from '../utils';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell
} from 'recharts';

// Day Use price constant
const DAY_USE_PRICE = 50;
const CARD_MENSAL_PRICE = 200;

interface StudentPayment {
    id?: string;
    amount: number;
    paymentDate: string;
    studentId: string;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

export const FinanceiroAdmin: React.FC = () => {
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [monthlyStudents, setMonthlyStudents] = useState<NonSocioStudent[]>([]);
    const [studentPayments, setStudentPayments] = useState<StudentPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(getNowInFortaleza().toISOString().slice(0, 7));
    const [processingPayment, setProcessingPayment] = useState<string | null>(null);
    const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

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
                status: r.status,
                payment_status: r.payment_status
            } as any)));
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
            .select('id, amount, payment_date, student_id');

        if (paymentsData) {
            setStudentPayments(paymentsData.map(p => ({
                id: p.id,
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

    // --- Actions ---
    const handleDeletePayment = async (id: string) => {
        if (!confirm('Deseja excluir este pagamento de Card Mensal? O valor será removido do relatório.')) return;
        setProcessingPayment(id);
        const { error } = await supabase.from('student_payments').delete().eq('id', id);
        if (error) {
            alert('Erro ao excluir: ' + error.message);
        } else {
            setDeleteSuccess(id);
            setTimeout(() => setDeleteSuccess(null), 1500);
            fetchData();
        }
        setProcessingPayment(null);
    };

    const handleToggleDayUseExempt = async (reservation: Reservation) => {
        if (!confirm('Tem certeza que deseja isentar este Day Use? O valor será removido do relatório mensal.')) return;

        const newStatus = (reservation as any).payment_status === 'exempt' ? 'paid' : 'exempt';
        setProcessingPayment(reservation.id);

        const { error } = await supabase
            .from('reservations')
            .update({ payment_status: newStatus })
            .eq('id', reservation.id);

        if (error) {
            alert('Erro ao atualizar: ' + error.message);
        } else {
            setDeleteSuccess(reservation.id);
            setTimeout(() => setDeleteSuccess(null), 1500);
            fetchData();
        }
        setProcessingPayment(null);
    };

    // Calculate Financial Data for SELECTED MONTH ONLY
    const reportData = useMemo(() => {
        const [year, month] = selectedMonth.split('-');

        // Filter Reservations for this month
        const monthReservations = reservations.filter(r => r.date.startsWith(selectedMonth));

        // Filter Payments for this month
        const monthPayments = studentPayments.filter(p => p.paymentDate.startsWith(selectedMonth));

        // Group Day Uses
        const friendlyDayUses = monthReservations.filter(r => r.type === 'Play' && r.guestName && (r as any).payment_status !== 'exempt');
        const studentDayUses = monthReservations.filter(r => r.type === 'Aula' && r.studentType === 'non-socio' && (r as any).payment_status !== 'exempt');

        const friendlyCount = friendlyDayUses.length;
        const friendlyTotal = friendlyCount * DAY_USE_PRICE;

        const studentCount = studentDayUses.length;
        const studentTotal = studentCount * DAY_USE_PRICE;

        const cardMensalTotal = monthPayments.reduce((sum, p) => sum + p.amount, 0);

        return {
            friendlyCount,
            friendlyTotal,
            studentCount,
            studentTotal,
            cardMensalTotal,
            grandTotal: friendlyTotal + studentTotal + cardMensalTotal,
            details: {
                friendly: friendlyDayUses,
                student: studentDayUses,
                payments: monthPayments
            }
        };
    }, [reservations, studentPayments, selectedMonth]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="animate-spin text-saibro-600 mb-4" size={40} />
                <p className="text-stone-500 font-medium">Carregando dados financeiros...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-4 bg-linear-to-br from-green-500 to-emerald-600 rounded-2xl shadow-lg shadow-green-200">
                        <DollarSign size={32} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-stone-800 tracking-tight">Painel Financeiro</h1>
                        <p className="text-sm text-stone-500 font-medium">Controle de receitas e mensalidades</p>
                    </div>
                </div>

                {/* Month Selector */}
                <div className="flex items-center gap-3 bg-linear-to-r from-stone-50 to-stone-100 p-4 rounded-2xl border-2 border-stone-200 shadow-sm">
                    <Calendar className="text-stone-600" size={20} />
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase text-stone-400 tracking-wider">Mês de Referência</span>
                        <input
                            type="month"
                            value={selectedMonth}
                            onChange={e => setSelectedMonth(e.target.value)}
                            className="bg-transparent font-black text-stone-800 text-lg outline-none cursor-pointer"
                        />
                    </div>
                </div>
            </div>

            {/* Dashboard Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Total Revenue */}
                <div className="md:col-span-2 bg-linear-to-br from-saibro-500 via-saibro-600 to-orange-600 p-8 rounded-2xl shadow-xl shadow-saibro-200 text-white relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Sparkles size={80} className="text-white" />
                    </div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-2">
                            <DollarSign size={24} className="opacity-90" />
                            <p className="text-xs font-black uppercase tracking-wider opacity-90">Receita Total</p>
                        </div>
                        <p className="text-5xl font-black mb-2">R$ {reportData.grandTotal.toFixed(2)}</p>
                        <div className="flex items-center gap-2 text-saibro-100">
                            <TrendingUp size={16} />
                            <span className="text-sm font-bold">
                                {new Date(selectedMonth + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Fortaleza' })}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Day Use Total */}
                <div className="bg-linear-to-br from-blue-500 to-blue-600 p-6 rounded-2xl shadow-lg shadow-blue-200 text-white relative overflow-hidden group">
                    <div className="absolute right-0 bottom-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Users size={60} />
                    </div>
                    <div className="relative z-10">
                        <p className="text-[10px] font-black uppercase tracking-wider mb-2 opacity-90">Day Use</p>
                        <p className="text-3xl font-black mb-1">R$ {(reportData.friendlyTotal + reportData.studentTotal).toFixed(2)}</p>
                        <div className="flex items-center gap-1 text-blue-100 text-xs font-bold">
                            <UserCheck size={14} />
                            <span>{reportData.friendlyCount + reportData.studentCount} usos</span>
                        </div>
                    </div>
                </div>

                {/* Monthly Cards */}
                <div className="bg-linear-to-br from-emerald-500 to-emerald-600 p-6 rounded-2xl shadow-lg shadow-emerald-200 text-white relative overflow-hidden group">
                    <div className="absolute right-0 bottom-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <CreditCard size={60} />
                    </div>
                    <div className="relative z-10">
                        <p className="text-[10px] font-black uppercase tracking-wider mb-2 opacity-90">Card Mensal</p>
                        <p className="text-3xl font-black mb-1">R$ {reportData.cardMensalTotal.toFixed(2)}</p>
                        <div className="flex items-center gap-1 text-emerald-100 text-xs font-bold">
                            <Receipt size={14} />
                            <span>{reportData.details.payments.length} pagamentos</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Detailed Reports */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Day Use Transactions */}
                <div className="bg-white rounded-2xl border-2 border-stone-100 overflow-hidden shadow-sm">
                    <div className="bg-linear-to-r from-blue-50 to-indigo-50 p-5 border-b-2 border-blue-100">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 rounded-xl">
                                    <Users className="text-blue-600" size={20} />
                                </div>
                                <div>
                                    <h3 className="font-black text-stone-800">Day Uses</h3>
                                    <p className="text-xs text-stone-500 font-medium">
                                        {reportData.friendlyCount + reportData.studentCount} transações • R$ {(reportData.friendlyTotal + reportData.studentTotal).toFixed(2)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-5 space-y-3 max-h-[500px] overflow-y-auto">
                        {[...reportData.details.friendly, ...reportData.details.student].length === 0 && (
                            <div className="text-center py-12">
                                <Users className="mx-auto text-stone-300 mb-3" size={48} />
                                <p className="text-stone-400 font-medium">Nenhum Day Use neste mês</p>
                            </div>
                        )}
                        {[...reportData.details.friendly, ...reportData.details.student]
                            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                            .map(r => {
                                const isDeleting = processingPayment === r.id;
                                const isDeleted = deleteSuccess === r.id;

                                return (
                                    <div
                                        key={r.id}
                                        className={`group p-4 rounded-xl border-2 transition-all duration-300 ${isDeleted
                                            ? 'bg-red-50 border-red-200 scale-95'
                                            : 'bg-stone-50 border-stone-100 hover:border-blue-200 hover:shadow-sm'
                                            }`}
                                    >
                                        <div className="flex justify-between items-start gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <p className="font-bold text-stone-800 truncate">
                                                        {r.guestName || (monthlyStudents.find(s => s.id === r.nonSocioStudentId)?.name || 'Aluno')}
                                                    </p>
                                                    <span className={`px-2 py-0.5 text-[10px] font-black rounded-full ${r.type === 'Play'
                                                        ? 'bg-orange-100 text-orange-700'
                                                        : 'bg-purple-100 text-purple-700'
                                                        }`}>
                                                        {r.type === 'Play' ? 'AMISTOSO' : 'AULA'}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-stone-500 font-medium">
                                                    📅 {formatDateBr(r.date).slice(0, 5)}
                                                </p>
                                            </div>

                                            <div className="flex items-center gap-3">
                                                <span className="font-black text-green-600 text-lg">R$ {DAY_USE_PRICE}</span>
                                                <button
                                                    onClick={() => handleToggleDayUseExempt(r)}
                                                    disabled={isDeleting}
                                                    title="Isentar (Remover do relatório)"
                                                    className="p-2.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                                                >
                                                    {isDeleting ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>

                {/* Monthly Card Payments */}
                <div className="bg-white rounded-2xl border-2 border-stone-100 overflow-hidden shadow-sm">
                    <div className="bg-linear-to-r from-emerald-50 to-green-50 p-5 border-b-2 border-emerald-100">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-100 rounded-xl">
                                    <CreditCard className="text-emerald-600" size={20} />
                                </div>
                                <div>
                                    <h3 className="font-black text-stone-800">Mensalidades</h3>
                                    <p className="text-xs text-stone-500 font-medium">
                                        {reportData.details.payments.length} pagamentos • R$ {reportData.cardMensalTotal.toFixed(2)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-5 space-y-3 max-h-[500px] overflow-y-auto">
                        {reportData.details.payments.length === 0 && (
                            <div className="text-center py-12">
                                <CreditCard className="mx-auto text-stone-300 mb-3" size={48} />
                                <p className="text-stone-400 font-medium">Nenhum pagamento neste mês</p>
                            </div>
                        )}
                        {reportData.details.payments.map((p: any) => {
                            const studentName = monthlyStudents.find(s => s.id === p.studentId)?.name || 'Aluno Excluído';
                            const isDeleting = processingPayment === p.id;
                            const isDeleted = deleteSuccess === p.id;

                            return (
                                <div
                                    key={p.id || Math.random()}
                                    className={`group p-4 rounded-xl border-2 transition-all duration-300 ${isDeleted
                                        ? 'bg-red-50 border-red-200 scale-95'
                                        : 'bg-stone-50 border-stone-100 hover:border-emerald-200 hover:shadow-sm'
                                        }`}
                                >
                                    <div className="flex justify-between items-start gap-3">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-stone-800 truncate mb-1">{studentName}</p>
                                            <p className="text-xs text-stone-500 font-medium">
                                                💳 Pago em {formatDateBr(p.paymentDate?.split('T')[0] || p.paymentDate).slice(0, 5)}
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <span className="font-black text-green-600 text-lg">R$ {p.amount}</span>
                                            <button
                                                onClick={() => handleDeletePayment(p.id)}
                                                disabled={isDeleting}
                                                title="Excluir pagamento"
                                                className="p-2.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-all active:scale-95 disabled:opacity-50 opacity-0 group-hover:opacity-100"
                                            >
                                                {isDeleting ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};
