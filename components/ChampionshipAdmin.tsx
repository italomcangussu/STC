import React, { useState, useEffect, useRef } from 'react';
import {
    Trophy, UserPlus, Users, Shirt, Check, Loader2, Trash2, Download, Share2, X,
    Lock, Shuffle, AlertTriangle
} from 'lucide-react';
import { User } from '../types';
import { supabase } from '../lib/supabase';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { generatePremiumPDF } from '../lib/pdfExportPremium';
import { GroupDrawPage } from './GroupDrawPage';
import { ChampionshipInProgress } from './ChampionshipInProgress';

// Types
interface Championship {
    id: string;
    name: string;
    registration_open: boolean;
    registration_closed: boolean;
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

    // New states for group draw
    const [showDrawPage, setShowDrawPage] = useState(false);
    const [closingRegistration, setClosingRegistration] = useState(false);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);

    // Flag to switch to In Progress View
    const [hasGroups, setHasGroups] = useState(false);

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
            // Also try to get championships where registration was recently closed (for draw)
            const { data: champData, error: champError } = await supabase
                .from('championships')
                .select('id, name, registration_open')
                .eq('registration_open', true)
                .limit(1)
                .maybeSingle();

            // If no open championship, check if we have a closed one ready for draw
            let championshipToUse = champData;
            let registrationClosed = false;

            if (!champData || champError) {
                // Try to get a championship that was recently closed 
                // Could be 'ongoing' or 'draft' status with registration_open = false
                const { data: closedChampData } = await supabase
                    .from('championships')
                    .select('id, name, registration_open, status')
                    .eq('registration_open', false)
                    .in('status', ['ongoing', 'draft'])
                    .limit(1)
                    .maybeSingle();

                if (closedChampData) {
                    championshipToUse = closedChampData;
                    registrationClosed = true;
                }
            }

            // Check if groups exist (means DRAW IS DONE)
            let groupsExist = false;
            if (championshipToUse) {
                const { count } = await supabase
                    .from('championship_groups')
                    .select('*', { count: 'exact', head: true })
                    .eq('championship_id', championshipToUse.id);
                groupsExist = (count || 0) > 0;
            }

            if (championshipToUse) {
                setChampionship({
                    id: championshipToUse.id,
                    name: championshipToUse.name,
                    registration_open: championshipToUse.registration_open,
                    registration_closed: registrationClosed
                });

                // If groups exist, we show the In Progress Dashboard
                if (groupsExist) {
                    setHasGroups(true);
                    setLoading(false);
                    return; // Stop here, we switch view
                }

                // Function to fetch registrations
                const fetchRegistrations = async () => {
                    const { data: regsData } = await supabase
                        .from('championship_registrations')
                        .select('*, user:profiles!user_id(name, avatar_url)')
                        .eq('championship_id', championshipToUse.id)
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
                            filter: `championship_id=eq.${championshipToUse.id}`
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

    // Close registrations and prepare for group draw
    const handleCloseRegistrations = async () => {
        if (!championship) return;

        setClosingRegistration(true);

        try {
            // Only update registration_open - the status remains as 'ongoing'
            // This allows us to identify closed championships ready for draw
            const { error } = await supabase
                .from('championships')
                .update({
                    registration_open: false
                })
                .eq('id', championship.id);

            if (error) throw error;

            setChampionship({
                ...championship,
                registration_open: false,
                registration_closed: true // Local state only
            });

            setShowCloseConfirm(false);
        } catch (error) {
            console.error('Error closing registrations:', error);
            alert('Erro ao encerrar inscrições. Tente novamente.');
        }

        setClosingRegistration(false);
    };

    const getRegistrationsByClass = (className: string) => {
        return registrations.filter(r => r.class === className);
    };

    const getParticipantName = (reg: Registration) => {
        if (reg.participant_type === 'guest') return reg.guest_name || 'Convidado';
        return reg.user?.name || 'Sócio';
    };

    // PDF Export with multi-page support
    // PDF Export with DOM Clone Strategy (Fixes scroll/gap issues)
    const handleExportPDF = async () => {
        if (!tableRef.current) return;

        // 1. Create a clone of the table to render off-screen (but visible)
        // This avoids scroll position issues and viewport constraints
        const originalElement = tableRef.current;
        const clone = originalElement.cloneNode(true) as HTMLElement;

        // 2. Setup a container for the clone
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.top = '0';
        container.style.left = '0';
        container.style.width = `${originalElement.offsetWidth}px`;
        container.style.zIndex = '-9999'; // Behind everything
        container.style.background = '#fff7ed'; // Match app background

        container.appendChild(clone);
        document.body.appendChild(container);

        // 3. Wait for images/fonts in clone (small delay usually enough for clone)
        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            // 4. Capture the container
            const canvas = await html2canvas(container, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#fff7ed'
            });

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
            const usableHeight = pageHeight - headerHeight - 10; // 10mm bottom margin (first page)

            // Multi-page export logic
            let remainingHeight = imgHeight;
            let position = 0;
            let page = 1;

            while (remainingHeight > 0) {
                // Determine slice height for this page
                // For page 1 we use 'usableHeight' (less header). For page 2+ we have more space!
                const currentUsableHeight = page === 1 ? usableHeight : (pageHeight - 20); // 10mm top/bottom margin for sub-pages

                const sliceHeightMM = Math.min(remainingHeight, currentUsableHeight);

                // Convert back to pixels for canvas slicing
                const srcY = position * (canvas.height / imgHeight);
                const srcHeightPX = sliceHeightMM * (canvas.height / imgHeight);

                // Create a temporary canvas for the slice
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvas.width;
                sliceCanvas.height = srcHeightPX;

                const ctx = sliceCanvas.getContext('2d');

                if (ctx) {
                    ctx.drawImage(
                        canvas,
                        0, srcY, canvas.width, srcHeightPX,
                        0, 0, canvas.width, srcHeightPX
                    );

                    const sliceData = sliceCanvas.toDataURL('image/png');

                    if (page > 1) {
                        pdf.addPage();
                        pdf.addImage(sliceData, 'PNG', 10, 10, imgWidth, sliceHeightMM); // 10mm top margin
                    } else {
                        pdf.addImage(sliceData, 'PNG', 10, headerHeight, imgWidth, sliceHeightMM);
                    }
                }

                remainingHeight -= sliceHeightMM;
                position += sliceHeightMM;
                page++;
            }

            pdf.save(`${championship?.name || 'inscritos'}.pdf`);

        } catch (error) {
            console.error('PDF Export Error:', error);
            alert('Erro ao gerar PDF');
        } finally {
            // 5. Cleanup
            if (document.body.contains(container)) {
                document.body.removeChild(container);
            }
        }
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


    // Show In Progress Dashboard if groups created
    if (hasGroups && championship) {
        return (
            <ChampionshipInProgress
                championship={championship}
                currentUser={currentUser}
                onUpdate={() => { }} // Optional refresh logic
            />
        );
    }

    // Show Group Draw Page if flag is set
    if (showDrawPage) {
        return (
            <GroupDrawPage
                currentUser={currentUser}
                onBack={() => {
                    setShowDrawPage(false);
                    // Check if groups were created when coming back
                    // Reload data basically
                    // Simple refresh:
                    window.location.reload();
                }}
            />
        );
    }

    return (
        <div className="p-4 pb-24 space-y-6">
            {/* Header */}
            <div className={`p-6 rounded-3xl shadow-xl text-white relative overflow-hidden ${championship.registration_closed
                ? 'bg-linear-to-br from-stone-700 to-stone-600'
                : 'bg-linear-to-br from-saibro-600 to-saibro-500'
                }`}>
                <div className="absolute right-[-10px] top-[-10px] opacity-10 rotate-12">
                    <Trophy size={160} />
                </div>
                <div className="relative z-10">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${championship.registration_closed
                        ? 'bg-red-500/30 text-red-100'
                        : 'bg-white/20'
                        }`}>
                        {championship.registration_closed ? '🔒 Inscrições Encerradas' : '📝 Inscrições Abertas'}
                    </span>
                    <h1 className="text-2xl font-black mt-2">{championship.name}</h1>
                    <p className="text-saibro-100 text-sm mt-1">
                        {registrations.length} inscritos
                    </p>
                </div>
            </div>

            {/* Registration Form - Only show if registrations are open */}
            {championship.registration_open && !championship.registration_closed && (
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
            )}

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

            {/* Admin Action Buttons */}
            <div className="space-y-3">
                {/* Close Registrations Button - Only show if registrations are open */}
                {championship.registration_open && !championship.registration_closed && (
                    <button
                        onClick={() => setShowCloseConfirm(true)}
                        className="w-full py-4 bg-linear-to-r from-red-500 to-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-100 hover:shadow-red-200 flex items-center justify-center gap-3 transition-all hover:scale-[1.01]"
                    >
                        <Lock size={20} />
                        Encerrar Inscrições
                    </button>
                )}

                {/* Draw Groups Button - Only show if registrations are closed */}
                {championship.registration_closed && (
                    <button
                        onClick={() => setShowDrawPage(true)}
                        className="w-full py-4 bg-linear-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl shadow-lg shadow-orange-100 hover:shadow-orange-200 flex items-center justify-center gap-3 transition-all hover:scale-[1.01]"
                    >
                        <Shuffle size={20} />
                        Sorteador de Grupos
                    </button>
                )}
            </div>

            {/* Confirmation Modal for Closing Registrations */}
            {showCloseConfirm && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-300">
                        <div className="p-6 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-100 flex items-center justify-center">
                                <AlertTriangle className="text-red-500" size={32} />
                            </div>
                            <h3 className="text-xl font-black text-stone-800 mb-2">
                                Encerrar Inscrições?
                            </h3>
                            <p className="text-stone-500 text-sm mb-6">
                                Esta ação não pode ser desfeita. Após encerrar, você poderá sortear os grupos do campeonato.
                            </p>
                            <div className="space-y-3">
                                <button
                                    onClick={handleCloseRegistrations}
                                    disabled={closingRegistration}
                                    className="w-full py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {closingRegistration ? (
                                        <Loader2 className="animate-spin" size={20} />
                                    ) : (
                                        <Lock size={20} />
                                    )}
                                    Sim, Encerrar Inscrições
                                </button>
                                <button
                                    onClick={() => setShowCloseConfirm(false)}
                                    className="w-full py-3 bg-stone-100 text-stone-600 font-bold rounded-xl hover:bg-stone-200"
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
