import React, { useState, useEffect, useRef } from 'react';
import {
    Trophy, UserPlus, Users, Shirt, Check, Loader2, Trash2, Download, Share2, X
} from 'lucide-react';
import { User } from '../types';
import { supabase } from '../lib/supabase';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// Types
interface Championship {
    id: string;
    name: string;
    registration_open: boolean;
}

interface Registration {
    id: string;
    championship_id: string;
    participant_type: 'socio' | 'guest';
    user_id: string | null;
    guest_name: string | null;
    class: string;
    shirt_size: string;
    created_at: string;
    user?: { name: string; avatar_url: string };
}

const CLASSES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe'];
const SHIRT_SIZES = ['P', 'M', 'G', 'GG', 'XGG'];

interface Props {
    currentUser: User;
}

export const ChampionshipAdmin: React.FC<Props> = ({ currentUser }) => {
    const [championship, setChampionship] = useState<Championship | null>(null);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const tableRef = useRef<HTMLDivElement>(null);

    // Form state
    const [participantType, setParticipantType] = useState<'socio' | 'guest'>('socio');
    const [selectedUserId, setSelectedUserId] = useState('');
    const [guestName, setGuestName] = useState('');
    const [selectedClass, setSelectedClass] = useState(CLASSES[0]);
    const [shirtSize, setShirtSize] = useState(SHIRT_SIZES[1]);

    // Load data
    useEffect(() => {
        let subscription: any;

        const fetchData = async () => {
            setLoading(true);

            // Get championship with registration open
            const { data: champData } = await supabase
                .from('championships')
                .select('id, name, registration_open')
                .eq('registration_open', true)
                .limit(1)
                .single();

            if (champData) {
                setChampionship(champData);

                // Function to fetch registrations
                const fetchRegistrations = async () => {
                    const { data: regsData } = await supabase
                        .from('championship_registrations')
                        .select('*, user:profiles!user_id(name, avatar_url)')
                        .eq('championship_id', champData.id)
                        .order('class', { ascending: true });

                    setRegistrations(regsData || []);
                };

                await fetchRegistrations();

                // Subscribe to changes
                subscription = supabase
                    .channel('admin-registrations')
                    .on(
                        'postgres_changes',
                        {
                            event: '*',
                            schema: 'public',
                            table: 'championship_registrations',
                            filter: `championship_id=eq.${champData.id}`
                        },
                        () => {
                            fetchRegistrations();
                        }
                    )
                    .subscribe();
            }

            // Get all active profiles for selection
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, name, avatar_url, category, role')
                .eq('is_active', true)
                .in('role', ['socio', 'admin'])
                .order('name');

            setProfiles((profilesData || []).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar_url,
                category: p.category,
                role: p.role,
                email: '',
                phone: '',
                balance: 0,
                isActive: true
            })));

            setLoading(false);
        };

        fetchData();

        return () => {
            if (subscription) {
                supabase.removeChannel(subscription);
            }
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!championship) return;

        // Validation
        if (participantType === 'socio' && !selectedUserId) {
            alert('Selecione um sócio');
            return;
        }
        if (participantType === 'guest' && !guestName.trim()) {
            alert('Digite o nome do convidado');
            return;
        }

        setSaving(true);

        const { data, error } = await supabase
            .from('championship_registrations')
            .insert({
                championship_id: championship.id,
                participant_type: participantType,
                user_id: participantType === 'socio' ? selectedUserId : null,
                guest_name: participantType === 'guest' ? guestName.trim() : null,
                class: selectedClass,
                shirt_size: shirtSize,
                registered_by: currentUser.id
            })
            .select('*, user:profiles!user_id(name, avatar_url)')
            .single();

        if (error) {
            console.error('Error registering:', error);
            alert('Erro ao inscrever. Tente novamente.');
        } else if (data) {
            setRegistrations([...registrations, data]);
            // Reset form
            setSelectedUserId('');
            setGuestName('');
        }

        setSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Remover esta inscrição?')) return;

        const { error } = await supabase
            .from('championship_registrations')
            .delete()
            .eq('id', id);

        if (!error) {
            setRegistrations(registrations.filter(r => r.id !== id));
        }
    };

    const getRegistrationsByClass = (className: string) => {
        return registrations.filter(r => r.class === className);
    };

    const getParticipantName = (reg: Registration) => {
        if (reg.participant_type === 'guest') return reg.guest_name || 'Convidado';
        return reg.user?.name || 'Sócio';
    };

    // PDF Export with multi-page support
    const handleExportPDF = async () => {
        if (!tableRef.current) return;

        const canvas = await html2canvas(tableRef.current, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');

        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth - 20; // 10mm margin each side
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        // Header
        pdf.setFontSize(18);
        pdf.text(championship?.name || 'Campeonato', pageWidth / 2, 15, { align: 'center' });
        pdf.setFontSize(12);
        pdf.text('Lista de Inscritos', pageWidth / 2, 22, { align: 'center' });

        const headerHeight = 30;
        const usableHeight = pageHeight - headerHeight - 10; // 10mm bottom margin

        // If content fits in one page
        if (imgHeight <= usableHeight) {
            pdf.addImage(imgData, 'PNG', 10, headerHeight, imgWidth, imgHeight);
        } else {
            // Multi-page export
            let remainingHeight = imgHeight;
            let position = 0;
            let page = 1;

            while (remainingHeight > 0) {
                const srcY = position * (canvas.height / imgHeight);
                const srcHeight = Math.min(usableHeight, remainingHeight) * (canvas.height / imgHeight);

                // Create a temporary canvas for the slice
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvas.width;
                sliceCanvas.height = srcHeight;
                const ctx = sliceCanvas.getContext('2d');

                if (ctx) {
                    ctx.drawImage(
                        canvas,
                        0, srcY, canvas.width, srcHeight,
                        0, 0, canvas.width, srcHeight
                    );

                    const sliceData = sliceCanvas.toDataURL('image/png');
                    const sliceImgHeight = (srcHeight * imgWidth) / canvas.width;

                    if (page > 1) {
                        pdf.addPage();
                    }

                    pdf.addImage(sliceData, 'PNG', 10, headerHeight, imgWidth, sliceImgHeight);
                }

                remainingHeight -= usableHeight;
                position += usableHeight;
                page++;
            }
        }

        pdf.save(`${championship?.name || 'inscritos'}.pdf`);
    };

    // WhatsApp Share
    const handleShareWhatsApp = () => {
        let message = `🏆 *${championship?.name}*\n📝 Lista de Inscritos\n\n`;

        CLASSES.forEach(cls => {
            const classRegs = getRegistrationsByClass(cls);
            if (classRegs.length > 0) {
                message += `*${cls}* (${classRegs.length})\n`;
                classRegs.forEach((reg, i) => {
                    const name = getParticipantName(reg);
                    const type = reg.participant_type === 'guest' ? '🎫' : '✅';
                    message += `${i + 1}. ${type} ${name} - ${reg.shirt_size}\n`;
                });
                message += '\n';
            }
        });

        message += `📊 Total: ${registrations.length} inscritos`;

        const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    if (loading) {
        return (
            <div className="p-8 flex flex-col items-center justify-center min-h-[50vh]">
                <Loader2 size={48} className="animate-spin text-saibro-600 mb-4" />
                <p className="text-stone-400">Carregando...</p>
            </div>
        );
    }

    if (!championship) {
        return (
            <div className="p-8 flex flex-col items-center justify-center min-h-[50vh]">
                <Trophy size={64} className="text-saibro-200 mb-4" />
                <h2 className="text-xl font-bold text-stone-600">Nenhum campeonato com inscrições abertas</h2>
            </div>
        );
    }

    return (
        <div className="p-4 pb-24 space-y-6">
            {/* Header */}
            <div className="bg-gradient-to-br from-saibro-600 to-saibro-500 p-6 rounded-3xl shadow-xl text-white relative overflow-hidden">
                <div className="absolute right-[-10px] top-[-10px] opacity-10 rotate-12">
                    <Trophy size={160} />
                </div>
                <div className="relative z-10">
                    <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full">
                        Inscrições Abertas
                    </span>
                    <h1 className="text-2xl font-black mt-2">{championship.name}</h1>
                    <p className="text-saibro-100 text-sm mt-1">
                        {registrations.length} inscritos
                    </p>
                </div>
            </div>

            {/* Registration Form */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
                <h2 className="text-lg font-bold text-stone-800 flex items-center gap-2 mb-4">
                    <UserPlus size={20} className="text-saibro-500" />
                    Nova Inscrição
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Participant Type */}
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => setParticipantType('socio')}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${participantType === 'socio'
                                ? 'bg-saibro-500 text-white shadow-lg'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                        >
                            <Users size={16} className="inline mr-2" />
                            Sócio
                        </button>
                        <button
                            type="button"
                            onClick={() => setParticipantType('guest')}
                            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${participantType === 'guest'
                                ? 'bg-saibro-500 text-white shadow-lg'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                        >
                            <UserPlus size={16} className="inline mr-2" />
                            Convidado
                        </button>
                    </div>

                    {/* Participant Selection */}
                    {participantType === 'socio' ? (
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-2">Selecionar Sócio</label>
                            <select
                                value={selectedUserId}
                                onChange={(e) => setSelectedUserId(e.target.value)}
                                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                            >
                                <option value="">Escolha um sócio...</option>
                                {profiles.map(p => (
                                    <option key={p.id} value={p.id}>{p.name} {p.category ? `(${p.category})` : ''}</option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-2">Nome do Convidado</label>
                            <input
                                type="text"
                                value={guestName}
                                onChange={(e) => setGuestName(e.target.value)}
                                placeholder="Digite o nome completo"
                                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                            />
                        </div>
                    )}

                    {/* Class & Shirt Size */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-2">Classe</label>
                            <select
                                value={selectedClass}
                                onChange={(e) => setSelectedClass(e.target.value)}
                                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                            >
                                {CLASSES.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-2">
                                <Shirt size={14} className="inline mr-1" />
                                Camisa
                            </label>
                            <select
                                value={shirtSize}
                                onChange={(e) => setShirtSize(e.target.value)}
                                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm"
                            >
                                {SHIRT_SIZES.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Submit */}
                    <button
                        type="submit"
                        disabled={saving}
                        className="w-full py-4 bg-saibro-600 text-white font-bold rounded-xl shadow-lg shadow-orange-100 hover:bg-saibro-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {saving ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
                        Inscrever
                    </button>
                </form>
            </div>

            {/* Export Buttons */}
            <div className="flex gap-3">
                <button
                    onClick={handleExportPDF}
                    className="flex-1 py-3 bg-white border border-stone-200 rounded-xl font-bold text-sm text-stone-700 hover:bg-stone-50 flex items-center justify-center gap-2"
                >
                    <Download size={18} />
                    Exportar PDF
                </button>
                <button
                    onClick={handleShareWhatsApp}
                    className="flex-1 py-3 bg-green-500 text-white rounded-xl font-bold text-sm hover:bg-green-600 flex items-center justify-center gap-2"
                >
                    <Share2 size={18} />
                    WhatsApp
                </button>
            </div>

            {/* Registrations Table */}
            <div ref={tableRef} className="space-y-4">
                {CLASSES.map(cls => {
                    const classRegs = getRegistrationsByClass(cls);
                    if (classRegs.length === 0) return null;

                    return (
                        <div key={cls} className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
                            <div className="bg-saibro-50 px-4 py-3 flex justify-between items-center border-b border-saibro-100">
                                <h3 className="font-bold text-saibro-800">{cls}</h3>
                                <span className="text-xs font-bold text-saibro-600 bg-saibro-100 px-2 py-1 rounded-full">
                                    {classRegs.length} inscritos
                                </span>
                            </div>
                            <div className="divide-y divide-stone-50">
                                {classRegs.map((reg, idx) => (
                                    <div key={reg.id} className="flex items-center justify-between px-4 py-3 hover:bg-stone-50">
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs font-bold text-stone-400 w-6">{idx + 1}</span>
                                            <div>
                                                <p className="font-semibold text-stone-800 text-sm">
                                                    {getParticipantName(reg)}
                                                </p>
                                                <p className="text-[10px] text-stone-400 uppercase">
                                                    {reg.participant_type === 'guest' ? '🎫 Convidado' : '✅ Sócio'}
                                                    {' • '} Camisa {reg.shirt_size}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleDelete(reg.id)}
                                            className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Empty State */}
            {registrations.length === 0 && (
                <div className="text-center py-12">
                    <Users size={48} className="mx-auto text-stone-200 mb-4" />
                    <p className="text-stone-400">Nenhuma inscrição ainda</p>
                </div>
            )}
        </div>
    );
};
