import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    ArrowLeft, Trophy, Shuffle, Crown, Users, Save, Check,
    Loader2, Sparkles, Star, Dices, PartyPopper, Download, FileImage, ListChecks, X
} from 'lucide-react';
import { User } from '../types';
import { supabase } from '../lib/supabase';
import { getNowInFortaleza } from '../utils';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

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
    user?: { name: string; avatar_url: string; category?: string };
}

interface DrawnGroup {
    groupA: { seed: Registration | null; members: Registration[] };
    groupB: { seed: Registration | null; members: Registration[] };
    isDrawn: boolean;
    isSaved: boolean;
}

interface Props {
    currentUser: User;
    onBack: () => void;
}

const CLASSES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe'];

// Shuffle array using Fisher-Yates algorithm
const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

export const GroupDrawPage: React.FC<Props> = ({ currentUser, onBack }) => {
    const [championship, setChampionship] = useState<Championship | null>(null);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [exporting, setExporting] = useState<string | null>(null);

    // Refs for export
    const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // State for each category's group draw
    const [categoryDraws, setCategoryDraws] = useState<Record<string, DrawnGroup>>({});
    const [animatingCategory, setAnimatingCategory] = useState<string | null>(null);
    const [animationNames, setAnimationNames] = useState<string[]>([]);

    // State for manual group definition
    const [manualDefineCategory, setManualDefineCategory] = useState<string | null>(null);
    const [manualGroupA, setManualGroupA] = useState<Registration[]>([]);
    const [manualGroupB, setManualGroupB] = useState<Registration[]>([]);

    // Load championship and registrations
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            // Get championship that is closed for registrations (for draw)
            // This is a championship with registration_open = false and status = ongoing or draft
            const { data: champData } = await supabase
                .from('championships')
                .select('id, name, registration_open, status')
                .eq('registration_open', false)
                .in('status', ['ongoing', 'draft'])
                .limit(1)
                .maybeSingle();

            if (champData) {
                setChampionship({
                    id: champData.id,
                    name: champData.name,
                    registration_open: champData.registration_open,
                    registration_closed: true
                });

                // Fetch registrations for this championship
                const { data: regsData } = await supabase
                    .from('championship_registrations')
                    .select('*, user:profiles!user_id(name, avatar_url, category)')
                    .eq('championship_id', champData.id)
                    .order('class', { ascending: true });

                setRegistrations(regsData || []);

                // Check for existing drawn groups (the tables might not exist yet)
                try {
                    const { data: existingGroups } = await supabase
                        .from('championship_groups')
                        .select(`
                            *,
                            members:championship_group_members(
                                id,
                                registration_id,
                                is_seed,
                                draw_order
                            )
                        `)
                        .eq('championship_id', champData.id);

                    // Populate with existing groups if any
                    if (existingGroups && existingGroups.length > 0) {
                        const draws: Record<string, DrawnGroup> = {};
                        CLASSES.forEach(cls => {
                            draws[cls] = {
                                groupA: { seed: null, members: [] },
                                groupB: { seed: null, members: [] },
                                isDrawn: false,
                                isSaved: false
                            };
                        });

                        for (const group of existingGroups) {
                            const category = group.category;
                            if (!draws[category]) continue;

                            const groupMembers = (group.members || [])
                                .sort((a: any, b: any) => (a.draw_order || 0) - (b.draw_order || 0))
                                .map((m: any) => regsData?.find(r => r.id === m.registration_id))
                                .filter(Boolean) as Registration[];

                            const seed = regsData?.find(r => r.id === group.seed_registration_id) || null;

                            if (group.group_name === 'A') {
                                draws[category].groupA = { seed, members: groupMembers };
                            } else {
                                draws[category].groupB = { seed, members: groupMembers };
                            }
                            draws[category].isDrawn = true;
                            draws[category].isSaved = true;
                        }

                        setCategoryDraws(draws);
                    } else {
                        // Initialize empty draws
                        const draws: Record<string, DrawnGroup> = {};
                        CLASSES.forEach(cls => {
                            draws[cls] = {
                                groupA: { seed: null, members: [] },
                                groupB: { seed: null, members: [] },
                                isDrawn: false,
                                isSaved: false
                            };
                        });
                        setCategoryDraws(draws);
                    }
                } catch (error) {
                    // Tables might not exist yet, initialize empty draws
                    console.log('Group tables not found, initializing empty draws');
                    const draws: Record<string, DrawnGroup> = {};
                    CLASSES.forEach(cls => {
                        draws[cls] = {
                            groupA: { seed: null, members: [] },
                            groupB: { seed: null, members: [] },
                            isDrawn: false,
                            isSaved: false
                        };
                    });
                    setCategoryDraws(draws);
                }
            } else {
                // Initialize empty draws even if no championship
                const draws: Record<string, DrawnGroup> = {};
                CLASSES.forEach(cls => {
                    draws[cls] = {
                        groupA: { seed: null, members: [] },
                        groupB: { seed: null, members: [] },
                        isDrawn: false,
                        isSaved: false
                    };
                });
                setCategoryDraws(draws);
            }

            setLoading(false);
        };

        fetchData();
    }, []);

    const getRegistrationsByClass = useCallback((cls: string) => {
        return registrations.filter(r => r.class === cls);
    }, [registrations]);

    const getParticipantName = (reg: Registration): string => {
        if (reg.participant_type === 'guest') return reg.guest_name || 'Convidado';
        return reg.user?.name || 'Sócio';
    };

    const getParticipantLevel = (reg: Registration): string => {
        if (reg.participant_type === 'guest') return 'Convidado';
        return reg.user?.category || 'Sem categoria';
    };

    // Set seed for a group
    const handleSetSeed = (cls: string, group: 'A' | 'B', registration: Registration | null) => {
        setCategoryDraws(prev => {
            const categoryDraw = { ...prev[cls] };
            if (group === 'A') {
                categoryDraw.groupA = { ...categoryDraw.groupA, seed: registration };
            } else {
                categoryDraw.groupB = { ...categoryDraw.groupB, seed: registration };
            }
            // Reset drawn state if seeds changed
            categoryDraw.isDrawn = false;
            return { ...prev, [cls]: categoryDraw };
        });
    };

    // Perform the draw for a category
    const handleDraw = async (cls: string) => {
        const classRegs = getRegistrationsByClass(cls);
        const categoryDraw = categoryDraws[cls];

        if (!categoryDraw.groupA.seed || !categoryDraw.groupB.seed) {
            alert('Selecione os cabeças de chave para ambos os grupos antes de sortear.');
            return;
        }

        // Get all participants except the seeds
        const nonSeeds = classRegs.filter(
            r => r.id !== categoryDraw.groupA.seed?.id && r.id !== categoryDraw.groupB.seed?.id
        );

        // Start animation
        setAnimatingCategory(cls);
        const allNames = classRegs.map(r => getParticipantName(r));

        // Animation loop - show random names for 5 seconds
        const animationDuration = 5000;
        const intervalTime = 100;
        let elapsed = 0;

        const interval = setInterval(() => {
            const shuffledNames = shuffleArray(allNames);
            setAnimationNames(shuffledNames.slice(0, Math.min(6, shuffledNames.length)));
            elapsed += intervalTime;

            if (elapsed >= animationDuration) {
                clearInterval(interval);
            }
        }, intervalTime);

        // Wait for animation to complete
        await new Promise(resolve => setTimeout(resolve, animationDuration + 200));

        clearInterval(interval);
        setAnimatingCategory(null);
        setAnimationNames([]);

        // Perform the actual draw
        const shuffled = shuffleArray(nonSeeds);
        const halfSize = Math.ceil(shuffled.length / 2);

        const groupAMembers = shuffled.slice(0, halfSize);
        const groupBMembers = shuffled.slice(halfSize);

        // Include seeds in members
        const groupAFull = [categoryDraw.groupA.seed!, ...groupAMembers];
        const groupBFull = [categoryDraw.groupB.seed!, ...groupBMembers];

        setCategoryDraws(prev => ({
            ...prev,
            [cls]: {
                groupA: { seed: categoryDraw.groupA.seed, members: groupAFull },
                groupB: { seed: categoryDraw.groupB.seed, members: groupBFull },
                isDrawn: true,
                isSaved: false
            }
        }));
    };

    // Start manual group definition for a category
    const handleStartManualDefine = (cls: string) => {
        const categoryDraw = categoryDraws[cls];

        // Initialize with seeds if they exist
        if (categoryDraw?.groupA.seed) {
            setManualGroupA([categoryDraw.groupA.seed]);
        } else {
            setManualGroupA([]);
        }

        if (categoryDraw?.groupB.seed) {
            setManualGroupB([categoryDraw.groupB.seed]);
        } else {
            setManualGroupB([]);
        }

        setManualDefineCategory(cls);
    };

    // Toggle player assignment in manual mode
    const handleTogglePlayer = (reg: Registration, targetGroup: 'A' | 'B') => {
        const categoryDraw = categoryDraws[manualDefineCategory || ''];
        const isSeedA = reg.id === categoryDraw?.groupA.seed?.id;
        const isSeedB = reg.id === categoryDraw?.groupB.seed?.id;

        // Seeds cannot be moved
        if (isSeedA || isSeedB) return;

        if (targetGroup === 'A') {
            if (manualGroupA.some(r => r.id === reg.id)) {
                setManualGroupA(prev => prev.filter(r => r.id !== reg.id));
            } else {
                setManualGroupB(prev => prev.filter(r => r.id !== reg.id));
                setManualGroupA(prev => [...prev, reg]);
            }
        } else {
            if (manualGroupB.some(r => r.id === reg.id)) {
                setManualGroupB(prev => prev.filter(r => r.id !== reg.id));
            } else {
                setManualGroupA(prev => prev.filter(r => r.id !== reg.id));
                setManualGroupB(prev => [...prev, reg]);
            }
        }
    };

    // Confirm manual group definition
    const handleConfirmManualDefine = () => {
        if (!manualDefineCategory) return;

        const categoryDraw = categoryDraws[manualDefineCategory];
        if (!categoryDraw?.groupA.seed || !categoryDraw?.groupB.seed) {
            alert('Selecione os cabeças de chave para ambos os grupos antes de definir.');
            return;
        }

        const classRegs = getRegistrationsByClass(manualDefineCategory);
        const allAssigned = classRegs.every(r =>
            manualGroupA.some(m => m.id === r.id) || manualGroupB.some(m => m.id === r.id)
        );

        if (!allAssigned) {
            alert('Todos os jogadores devem ser atribuídos a um grupo.');
            return;
        }

        setCategoryDraws(prev => ({
            ...prev,
            [manualDefineCategory]: {
                groupA: { seed: categoryDraw.groupA.seed, members: manualGroupA },
                groupB: { seed: categoryDraw.groupB.seed, members: manualGroupB },
                isDrawn: true,
                isSaved: false
            }
        }));

        setManualDefineCategory(null);
        setManualGroupA([]);
        setManualGroupB([]);
    };

    // Save groups to database
    const handleSaveGroups = async (cls: string) => {
        if (!championship) return;

        const categoryDraw = categoryDraws[cls];
        if (!categoryDraw.isDrawn || !categoryDraw.groupA.seed || !categoryDraw.groupB.seed) return;

        setSaving(cls);

        try {
            // Delete existing groups for this category if any
            await supabase
                .from('championship_groups')
                .delete()
                .eq('championship_id', championship.id)
                .eq('category', cls);

            // Create Group A
            const { data: groupAData, error: errorA } = await supabase
                .from('championship_groups')
                .insert({
                    championship_id: championship.id,
                    category: cls,
                    group_name: 'A',
                    seed_registration_id: categoryDraw.groupA.seed.id
                })
                .select()
                .single();

            if (errorA) throw errorA;

            // Create Group B
            const { data: groupBData, error: errorB } = await supabase
                .from('championship_groups')
                .insert({
                    championship_id: championship.id,
                    category: cls,
                    group_name: 'B',
                    seed_registration_id: categoryDraw.groupB.seed.id
                })
                .select()
                .single();

            if (errorB) throw errorB;

            // Insert Group A members
            const groupAInserts = categoryDraw.groupA.members.map((member, idx) => ({
                group_id: groupAData.id,
                registration_id: member.id,
                is_seed: member.id === categoryDraw.groupA.seed?.id,
                draw_order: member.id === categoryDraw.groupA.seed?.id ? 0 : idx + 1
            }));

            const { error: membersAError } = await supabase
                .from('championship_group_members')
                .insert(groupAInserts);

            if (membersAError) throw membersAError;

            // Insert Group B members
            const groupBInserts = categoryDraw.groupB.members.map((member, idx) => ({
                group_id: groupBData.id,
                registration_id: member.id,
                is_seed: member.id === categoryDraw.groupB.seed?.id,
                draw_order: member.id === categoryDraw.groupB.seed?.id ? 0 : idx + 1
            }));

            const { error: membersBError } = await supabase
                .from('championship_group_members')
                .insert(groupBInserts);

            if (membersBError) throw membersBError;

            // Mark as saved
            setCategoryDraws(prev => ({
                ...prev,
                [cls]: { ...prev[cls], isSaved: true }
            }));

        } catch (error) {
            console.error('Error saving groups:', error);
            alert('Erro ao salvar grupos. Tente novamente.');
        }

        setSaving(null);
    };

    // Helper function to build group HTML for export (avoids oklab color issues)
    const buildGroupHTML = (cls: string, categoryDraw: DrawnGroup): string => {
        const buildMemberRow = (member: Registration, idx: number, isSeed: boolean, color: string) => {
            const bgColor = isSeed ? (color === 'amber' ? 'rgba(245,158,11,0.2)' : 'rgba(249,115,22,0.2)') : 'rgba(255,255,255,0.05)';
            const borderColor = isSeed ? (color === 'amber' ? 'rgba(245,158,11,0.3)' : 'rgba(249,115,22,0.3)') : 'transparent';
            const textColor = color === 'amber' ? '#fbbf24' : '#fb923c';
            const name = getParticipantName(member);

            return `
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 8px; background: ${bgColor}; border: 1px solid ${borderColor}; margin-bottom: 8px;">
                    <span style="width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: ${textColor};">
                        ${isSeed ? '👑' : idx}
                    </span>
                    <span style="color: white; font-size: 14px; font-weight: 500;">
                        ${name}
                    </span>
                </div>
            `;
        };

        const groupAMembers = categoryDraw.groupA.members.map((m, i) =>
            buildMemberRow(m, i, m.id === categoryDraw.groupA.seed?.id, 'amber')
        ).join('');

        const groupBMembers = categoryDraw.groupB.members.map((m, i) =>
            buildMemberRow(m, i, m.id === categoryDraw.groupB.seed?.id, 'orange')
        ).join('');

        return `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <!-- Group A -->
                <div style="background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); border-radius: 16px; overflow: hidden;">
                    <div style="background: rgba(245,158,11,0.2); padding: 8px 12px; border-bottom: 1px solid rgba(245,158,11,0.2);">
                        <h4 style="font-weight: 900; color: #fbbf24; font-size: 14px; margin: 0;">Grupo A</h4>
                    </div>
                    <div style="padding: 12px;">
                        ${groupAMembers}
                    </div>
                </div>
                <!-- Group B -->
                <div style="background: rgba(249,115,22,0.1); border: 1px solid rgba(249,115,22,0.2); border-radius: 16px; overflow: hidden;">
                    <div style="background: rgba(249,115,22,0.2); padding: 8px 12px; border-bottom: 1px solid rgba(249,115,22,0.2);">
                        <h4 style="font-weight: 900; color: #fb923c; font-size: 14px; margin: 0;">Grupo B</h4>
                    </div>
                    <div style="padding: 12px;">
                        ${groupBMembers}
                    </div>
                </div>
            </div>
        `;
    };

    // Export group as PNG
    const handleExportPNG = async (cls: string) => {
        const categoryDraw = categoryDraws[cls];
        if (!categoryDraw || !championship) return;

        setExporting(`${cls}-png`);

        try {
            // Create a temporary wrapper with styling for export
            const wrapper = document.createElement('div');
            wrapper.style.cssText = `
                background: linear-gradient(135deg, #1c1917 0%, #292524 100%);
                padding: 24px;
                border-radius: 24px;
                width: 420px;
                font-family: system-ui, -apple-system, sans-serif;
            `;

            wrapper.innerHTML = `
                <div style="text-align: center; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 10px; color: #fbbf24; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px;">
                        🏆 ${championship.name}
                    </div>
                    <div style="font-size: 18px; color: white; font-weight: 900;">
                        ${cls}
                    </div>
                </div>
                ${buildGroupHTML(cls, categoryDraw)}
                <div style="text-align: center; margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 10px; color: rgba(255,255,255,0.4);">
                        Gerado em ${getNowInFortaleza().toLocaleString('pt-BR')}
                    </div>
                </div>
            `;

            // Append to body temporarily (off-screen)
            wrapper.style.position = 'fixed';
            wrapper.style.left = '-9999px';
            wrapper.style.top = '0';
            document.body.appendChild(wrapper);

            const canvas = await html2canvas(wrapper, {
                scale: 2,
                backgroundColor: '#1c1917',
                useCORS: true,
                logging: false
            });

            // Remove wrapper
            document.body.removeChild(wrapper);

            // Download
            const link = document.createElement('a');
            link.download = `${championship.name}-${cls}-grupos.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

        } catch (error) {
            console.error('Error exporting PNG:', error);
            alert('Erro ao exportar PNG. Tente novamente.');
        }

        setExporting(null);
    };

    // Export group as PDF
    const handleExportPDF = async (cls: string) => {
        const categoryDraw = categoryDraws[cls];
        if (!categoryDraw || !championship) return;

        setExporting(`${cls}-pdf`);

        try {
            // Create a temporary wrapper with styling for export
            const wrapper = document.createElement('div');
            wrapper.style.cssText = `
                background: linear-gradient(135deg, #1c1917 0%, #292524 100%);
                padding: 24px;
                border-radius: 24px;
                width: 420px;
                font-family: system-ui, -apple-system, sans-serif;
            `;

            wrapper.innerHTML = `
                <div style="text-align: center; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 10px; color: #fbbf24; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px;">
                        🏆 ${championship.name}
                    </div>
                    <div style="font-size: 18px; color: white; font-weight: 900;">
                        ${cls}
                    </div>
                </div>
                ${buildGroupHTML(cls, categoryDraw)}
            `;

            // Append to body temporarily (off-screen)
            wrapper.style.position = 'fixed';
            wrapper.style.left = '-9999px';
            wrapper.style.top = '0';
            document.body.appendChild(wrapper);

            const canvas = await html2canvas(wrapper, {
                scale: 2,
                backgroundColor: '#1c1917',
                useCORS: true,
                logging: false
            });

            // Remove wrapper
            document.body.removeChild(wrapper);

            // Create PDF
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const imgWidth = pageWidth - 40;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            // Add title
            pdf.setFontSize(18);
            pdf.setTextColor(234, 88, 12); // saibro-600
            pdf.text(championship.name, pageWidth / 2, 20, { align: 'center' });

            pdf.setFontSize(14);
            pdf.setTextColor(68, 64, 60); // stone-700
            pdf.text(`Sorteio de Grupos - ${cls}`, pageWidth / 2, 28, { align: 'center' });

            // Add image
            const imgData = canvas.toDataURL('image/png');
            pdf.addImage(imgData, 'PNG', 20, 35, imgWidth, imgHeight);

            // Add footer
            const currentY = 35 + imgHeight + 10;
            pdf.setFontSize(8);
            pdf.setTextColor(168, 162, 158); // stone-400
            pdf.text(`Gerado em ${getNowInFortaleza().toLocaleString('pt-BR')}`, pageWidth / 2, currentY, { align: 'center' });

            // Download
            pdf.save(`${championship.name}-${cls}-grupos.pdf`);

        } catch (error) {
            console.error('Error exporting PDF:', error);
            alert('Erro ao exportar PDF. Tente novamente.');
        }

        setExporting(null);
    };

    // Check if all categories have been drawn and saved
    const allCategoriesSaved = CLASSES.every(cls => {
        const classRegs = getRegistrationsByClass(cls);
        if (classRegs.length === 0) return true; // Skip empty categories
        return categoryDraws[cls]?.isSaved === true;
    });

    if (loading) {
        return (
            <div className="p-8 flex flex-col items-center justify-center min-h-[50vh]">
                <Loader2 size={48} className="animate-spin text-saibro-600 mb-4" />
                <p className="text-stone-400">Carregando sorteador...</p>
            </div>
        );
    }

    if (!championship) {
        return (
            <div className="p-8 flex flex-col items-center justify-center min-h-[50vh]">
                <Trophy size={64} className="text-saibro-200 mb-4" />
                <h2 className="text-xl font-bold text-stone-600">Nenhum campeonato pronto para sorteio</h2>
                <p className="text-stone-400 mt-2">Encerre as inscrições primeiro para iniciar o sorteio.</p>
                <button
                    onClick={onBack}
                    className="mt-6 px-6 py-3 bg-saibro-600 text-white font-bold rounded-xl hover:bg-saibro-700 transition-all"
                >
                    Voltar
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-stone-900 via-stone-800 to-stone-900 pb-24">
            {/* Premium Header */}
            <div className="relative overflow-hidden">
                <div className="absolute inset-0 bg-linear-to-r from-amber-500/20 via-orange-500/10 to-red-500/20" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(251,191,36,0.1),transparent_50%)]" />

                {/* Floating particles */}
                <div className="absolute inset-0 overflow-hidden">
                    {[...Array(20)].map((_, i) => (
                        <div
                            key={i}
                            className="absolute w-1 h-1 bg-amber-400/30 rounded-full animate-pulse"
                            style={{
                                left: `${Math.random() * 100}%`,
                                top: `${Math.random() * 100}%`,
                                animationDelay: `${Math.random() * 2}s`,
                                animationDuration: `${2 + Math.random() * 2}s`
                            }}
                        />
                    ))}
                </div>

                <div className="relative p-6">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 text-amber-200/80 hover:text-amber-100 transition-colors mb-6"
                    >
                        <ArrowLeft size={20} />
                        <span className="text-sm font-medium">Voltar</span>
                    </button>

                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                            <Dices className="text-white" size={32} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-white tracking-tight">
                                Sorteador de Grupos
                            </h1>
                            <p className="text-amber-200/70 text-sm mt-1 flex items-center gap-2">
                                <Trophy size={14} />
                                {championship.name}
                            </p>
                        </div>
                    </div>

                    {/* Progress indicator */}
                    <div className="mt-6 flex items-center gap-3">
                        <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-linear-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-500"
                                style={{
                                    width: `${(CLASSES.filter(cls => {
                                        const classRegs = getRegistrationsByClass(cls);
                                        return classRegs.length > 0 && categoryDraws[cls]?.isSaved;
                                    }).length / CLASSES.filter(cls => getRegistrationsByClass(cls).length > 0).length) * 100}%`
                                }}
                            />
                        </div>
                        <span className="text-xs font-bold text-amber-200/70">
                            {CLASSES.filter(cls => {
                                const classRegs = getRegistrationsByClass(cls);
                                return classRegs.length > 0 && categoryDraws[cls]?.isSaved;
                            }).length}/{CLASSES.filter(cls => getRegistrationsByClass(cls).length > 0).length}
                        </span>
                    </div>
                </div>
            </div>

            {/* Animation Overlay */}
            {animatingCategory && (
                <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center">
                    <div className="relative max-w-md w-full mx-6">
                        {/* Spinning background effect */}
                        <div className="absolute inset-0 animate-spin-slow">
                            {[...Array(12)].map((_, i) => (
                                <div
                                    key={i}
                                    className="absolute w-2 h-20 bg-linear-to-t from-amber-400/50 to-transparent rounded-full"
                                    style={{
                                        left: '50%',
                                        top: '50%',
                                        transformOrigin: '0 100px',
                                        transform: `rotate(${i * 30}deg) translateX(-50%)`
                                    }}
                                />
                            ))}
                        </div>

                        <div className="relative bg-linear-to-br from-stone-800 to-stone-900 rounded-3xl p-8 border border-amber-500/30 shadow-2xl shadow-amber-500/20">
                            <div className="text-center">
                                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-linear-to-br from-amber-400 to-orange-500 mb-6 animate-bounce">
                                    <Shuffle className="text-white" size={40} />
                                </div>

                                <h3 className="text-xl font-black text-white mb-2">
                                    Sorteando {animatingCategory}
                                </h3>
                                <p className="text-amber-200/60 text-sm mb-6">
                                    Definindo grupos aleatoriamente...
                                </p>

                                {/* Animated names */}
                                <div className="space-y-2 min-h-[180px]">
                                    {animationNames.map((name, idx) => (
                                        <div
                                            key={`${name}-${idx}`}
                                            className="py-2 px-4 bg-white/10 rounded-xl text-white font-bold text-sm animate-pulse"
                                            style={{
                                                animationDelay: `${idx * 0.1}s`
                                            }}
                                        >
                                            {name}
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-6 flex justify-center">
                                    <Loader2 className="animate-spin text-amber-400" size={24} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Manual Define Modal */}
            {manualDefineCategory && (
                <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-4">
                    <div className="relative max-w-2xl w-full max-h-[90vh] overflow-auto">
                        <div className="bg-linear-to-br from-stone-800 to-stone-900 rounded-3xl border border-violet-500/30 shadow-2xl shadow-violet-500/20">
                            {/* Header */}
                            <div className="p-6 border-b border-white/10">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
                                            <ListChecks className="text-white" size={28} />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-white">Definir Grupos</h2>
                                            <p className="text-violet-200/60 text-sm">{manualDefineCategory}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setManualDefineCategory(null);
                                            setManualGroupA([]);
                                            setManualGroupB([]);
                                        }}
                                        className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>
                                <p className="text-white/50 text-xs mt-3">
                                    Clique nos jogadores para atribuí-los ao Grupo A ou B. Cabeças de chave não podem ser movidos.
                                </p>
                            </div>

                            {/* Content */}
                            <div className="p-6">
                                <div className="grid grid-cols-2 gap-4 mb-6">
                                    {/* Group A */}
                                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl overflow-hidden">
                                        <div className="bg-amber-500/20 px-4 py-3 border-b border-amber-500/20">
                                            <h4 className="font-black text-amber-400 flex items-center gap-2">
                                                <Crown size={16} />
                                                Grupo A ({manualGroupA.length})
                                            </h4>
                                        </div>
                                        <div className="p-3 space-y-2 min-h-[200px]">
                                            {manualGroupA.map((member, idx) => {
                                                const categoryDraw = categoryDraws[manualDefineCategory];
                                                const isSeed = member.id === categoryDraw?.groupA.seed?.id;
                                                return (
                                                    <div
                                                        key={member.id}
                                                        onClick={() => !isSeed && handleTogglePlayer(member, 'B')}
                                                        className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${isSeed
                                                            ? 'bg-amber-500/30 border border-amber-500/40 cursor-not-allowed'
                                                            : 'bg-white/5 hover:bg-amber-500/20 hover:border-amber-500/30 border border-transparent'
                                                            }`}
                                                    >
                                                        <span className="w-5 h-5 flex items-center justify-center text-xs font-bold text-amber-400">
                                                            {isSeed ? <Crown size={14} /> : idx}
                                                        </span>
                                                        <span className="text-white text-sm font-medium truncate flex-1">
                                                            {getParticipantName(member)}
                                                        </span>
                                                        {!isSeed && (
                                                            <span className="text-white/30 text-xs">→ B</span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Group B */}
                                    <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl overflow-hidden">
                                        <div className="bg-orange-500/20 px-4 py-3 border-b border-orange-500/20">
                                            <h4 className="font-black text-orange-400 flex items-center gap-2">
                                                <Crown size={16} />
                                                Grupo B ({manualGroupB.length})
                                            </h4>
                                        </div>
                                        <div className="p-3 space-y-2 min-h-[200px]">
                                            {manualGroupB.map((member, idx) => {
                                                const categoryDraw = categoryDraws[manualDefineCategory];
                                                const isSeed = member.id === categoryDraw?.groupB.seed?.id;
                                                return (
                                                    <div
                                                        key={member.id}
                                                        onClick={() => !isSeed && handleTogglePlayer(member, 'A')}
                                                        className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${isSeed
                                                            ? 'bg-orange-500/30 border border-orange-500/40 cursor-not-allowed'
                                                            : 'bg-white/5 hover:bg-orange-500/20 hover:border-orange-500/30 border border-transparent'
                                                            }`}
                                                    >
                                                        <span className="w-5 h-5 flex items-center justify-center text-xs font-bold text-orange-400">
                                                            {isSeed ? <Crown size={14} /> : idx}
                                                        </span>
                                                        <span className="text-white text-sm font-medium truncate flex-1">
                                                            {getParticipantName(member)}
                                                        </span>
                                                        {!isSeed && (
                                                            <span className="text-white/30 text-xs">→ A</span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                {/* Unassigned Players */}
                                {(() => {
                                    const classRegs = getRegistrationsByClass(manualDefineCategory);
                                    const unassigned = classRegs.filter(r =>
                                        !manualGroupA.some(m => m.id === r.id) &&
                                        !manualGroupB.some(m => m.id === r.id)
                                    );

                                    if (unassigned.length === 0) return null;

                                    return (
                                        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden mb-6">
                                            <div className="bg-white/5 px-4 py-3 border-b border-white/10">
                                                <h4 className="font-bold text-white/70 flex items-center gap-2">
                                                    <Users size={16} />
                                                    Sem Grupo ({unassigned.length})
                                                </h4>
                                            </div>
                                            <div className="p-3 grid grid-cols-2 gap-2">
                                                {unassigned.map((member) => (
                                                    <div key={member.id} className="flex gap-2">
                                                        <button
                                                            onClick={() => handleTogglePlayer(member, 'A')}
                                                            className="flex-1 flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 hover:border-amber-500/40 transition-all"
                                                        >
                                                            <span className="text-amber-400 text-xs font-bold">A</span>
                                                            <span className="text-white text-sm font-medium truncate">
                                                                {getParticipantName(member)}
                                                            </span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleTogglePlayer(member, 'B')}
                                                            className="px-3 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 hover:border-orange-500/40 text-orange-400 text-xs font-bold transition-all"
                                                        >
                                                            B
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Confirm Button */}
                                <button
                                    onClick={handleConfirmManualDefine}
                                    disabled={(() => {
                                        const classRegs = getRegistrationsByClass(manualDefineCategory);
                                        return !classRegs.every(r =>
                                            manualGroupA.some(m => m.id === r.id) || manualGroupB.some(m => m.id === r.id)
                                        );
                                    })()}
                                    className="w-full py-4 bg-linear-to-r from-violet-500 to-purple-500 text-white font-black rounded-xl shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                >
                                    <Check size={20} />
                                    Confirmar Grupos
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Categories */}
            <div className="p-4 space-y-6">
                {CLASSES.map(cls => {
                    const classRegs = getRegistrationsByClass(cls);
                    if (classRegs.length === 0) return null;

                    const categoryDraw = categoryDraws[cls];
                    const hasEnoughPlayers = classRegs.length >= 2;

                    return (
                        <div
                            key={cls}
                            className={`bg-linear-to-br from-stone-800/80 to-stone-900/80 rounded-3xl border overflow-hidden backdrop-blur-sm transition-all ${categoryDraw?.isSaved
                                ? 'border-green-500/30 shadow-lg shadow-green-500/10'
                                : categoryDraw?.isDrawn
                                    ? 'border-amber-500/30 shadow-lg shadow-amber-500/10'
                                    : 'border-white/10'
                                }`}
                        >
                            {/* Category Header */}
                            <div className={`p-4 border-b backdrop-blur-sm flex items-center justify-between ${categoryDraw?.isSaved
                                ? 'bg-green-500/10 border-green-500/20'
                                : 'bg-white/5 border-white/10'
                                }`}>
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${categoryDraw?.isSaved
                                        ? 'bg-green-500'
                                        : 'bg-linear-to-br from-amber-400 to-orange-500'
                                        }`}>
                                        {categoryDraw?.isSaved ? (
                                            <Check className="text-white" size={20} />
                                        ) : (
                                            <Trophy className="text-white" size={20} />
                                        )}
                                    </div>
                                    <div>
                                        <h3 className="font-black text-white">{cls}</h3>
                                        <p className="text-xs text-white/50">
                                            {classRegs.length} inscritos
                                        </p>
                                    </div>
                                </div>

                                {categoryDraw?.isSaved && (
                                    <span className="px-3 py-1 bg-green-500/20 text-green-400 text-xs font-bold rounded-full flex items-center gap-1">
                                        <Check size={12} /> Salvo
                                    </span>
                                )}
                            </div>

                            <div className="p-4 space-y-4">
                                {!hasEnoughPlayers ? (
                                    <div className="text-center py-8 text-white/40">
                                        <Users size={32} className="mx-auto mb-2" />
                                        <p className="text-sm">Mínimo de 2 jogadores necessários</p>
                                    </div>
                                ) : !categoryDraw?.isDrawn ? (
                                    <>
                                        {/* Seed Selection */}
                                        <div className="grid grid-cols-2 gap-4">
                                            {/* Group A Seed */}
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider">
                                                    <Crown size={12} />
                                                    Cabeça Grupo A
                                                </label>
                                                <select
                                                    value={categoryDraw?.groupA.seed?.id || ''}
                                                    onChange={(e) => {
                                                        const reg = classRegs.find(r => r.id === e.target.value);
                                                        handleSetSeed(cls, 'A', reg || null);
                                                    }}
                                                    className="w-full p-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50"
                                                >
                                                    <option value="">Selecione...</option>
                                                    {classRegs
                                                        .filter(r => r.id !== categoryDraw?.groupB.seed?.id)
                                                        .map(r => (
                                                            <option key={r.id} value={r.id}>
                                                                {getParticipantName(r)} ({getParticipantLevel(r)})
                                                            </option>
                                                        ))}
                                                </select>
                                            </div>

                                            {/* Group B Seed */}
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-xs font-bold text-orange-400 uppercase tracking-wider">
                                                    <Crown size={12} />
                                                    Cabeça Grupo B
                                                </label>
                                                <select
                                                    value={categoryDraw?.groupB.seed?.id || ''}
                                                    onChange={(e) => {
                                                        const reg = classRegs.find(r => r.id === e.target.value);
                                                        handleSetSeed(cls, 'B', reg || null);
                                                    }}
                                                    className="w-full p-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-orange-500/50"
                                                >
                                                    <option value="">Selecione...</option>
                                                    {classRegs
                                                        .filter(r => r.id !== categoryDraw?.groupA.seed?.id)
                                                        .map(r => (
                                                            <option key={r.id} value={r.id}>
                                                                {getParticipantName(r)} ({getParticipantLevel(r)})
                                                            </option>
                                                        ))}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Draw Button */}
                                        <button
                                            onClick={() => handleDraw(cls)}
                                            disabled={!categoryDraw?.groupA.seed || !categoryDraw?.groupB.seed}
                                            className="w-full py-4 bg-linear-to-r from-amber-500 to-orange-500 text-white font-black rounded-xl shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                        >
                                            <Shuffle size={20} />
                                            Sortear Grupos
                                            <Sparkles size={16} />
                                        </button>

                                        {/* Manual Define Button */}
                                        <button
                                            onClick={() => handleStartManualDefine(cls)}
                                            disabled={!categoryDraw?.groupA.seed || !categoryDraw?.groupB.seed}
                                            className="w-full py-4 bg-linear-to-r from-violet-500 to-purple-500 text-white font-black rounded-xl shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                        >
                                            <ListChecks size={20} />
                                            Definir Grupo
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        {/* Drawn Groups Display - with ref for export */}
                                        <div
                                            ref={(el) => { groupRefs.current[cls] = el; }}
                                            className="grid grid-cols-2 gap-4"
                                        >
                                            {/* Group A */}
                                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl overflow-hidden">
                                                <div className="bg-amber-500/20 px-3 py-2 border-b border-amber-500/20">
                                                    <h4 className="font-black text-amber-400 text-sm">Grupo A</h4>
                                                </div>
                                                <div className="p-3 space-y-2">
                                                    {categoryDraw.groupA.members.map((member, idx) => (
                                                        <div
                                                            key={member.id}
                                                            className={`flex items-center gap-2 p-2 rounded-lg ${member.id === categoryDraw.groupA.seed?.id
                                                                ? 'bg-amber-500/20 border border-amber-500/30'
                                                                : 'bg-white/5'
                                                                }`}
                                                        >
                                                            <span className="w-5 h-5 flex items-center justify-center text-xs font-bold text-amber-400">
                                                                {member.id === categoryDraw.groupA.seed?.id ? (
                                                                    <Crown size={14} />
                                                                ) : (
                                                                    idx
                                                                )}
                                                            </span>
                                                            <span className="text-white text-sm font-medium truncate">
                                                                {getParticipantName(member)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Group B */}
                                            <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl overflow-hidden">
                                                <div className="bg-orange-500/20 px-3 py-2 border-b border-orange-500/20">
                                                    <h4 className="font-black text-orange-400 text-sm">Grupo B</h4>
                                                </div>
                                                <div className="p-3 space-y-2">
                                                    {categoryDraw.groupB.members.map((member, idx) => (
                                                        <div
                                                            key={member.id}
                                                            className={`flex items-center gap-2 p-2 rounded-lg ${member.id === categoryDraw.groupB.seed?.id
                                                                ? 'bg-orange-500/20 border border-orange-500/30'
                                                                : 'bg-white/5'
                                                                }`}
                                                        >
                                                            <span className="w-5 h-5 flex items-center justify-center text-xs font-bold text-orange-400">
                                                                {member.id === categoryDraw.groupB.seed?.id ? (
                                                                    <Crown size={14} />
                                                                ) : (
                                                                    idx
                                                                )}
                                                            </span>
                                                            <span className="text-white text-sm font-medium truncate">
                                                                {getParticipantName(member)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Save Button */}
                                        {!categoryDraw.isSaved && (
                                            <button
                                                onClick={() => handleSaveGroups(cls)}
                                                disabled={saving === cls}
                                                className="w-full py-4 bg-linear-to-r from-green-500 to-emerald-500 text-white font-black rounded-xl shadow-lg shadow-green-500/30 hover:shadow-green-500/50 disabled:opacity-50 flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                            >
                                                {saving === cls ? (
                                                    <Loader2 className="animate-spin" size={20} />
                                                ) : (
                                                    <Save size={20} />
                                                )}
                                                Salvar Grupos
                                            </button>
                                        )}

                                        {/* Export and Re-draw options - shown when saved */}
                                        {categoryDraw.isSaved && (
                                            <div className="space-y-3">
                                                {/* Export Buttons */}
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleExportPDF(cls)}
                                                        disabled={exporting === `${cls}-pdf`}
                                                        className="flex-1 py-3 bg-linear-to-r from-red-500 to-rose-500 text-white font-bold rounded-xl shadow-lg shadow-red-500/20 hover:shadow-red-500/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99]"
                                                    >
                                                        {exporting === `${cls}-pdf` ? (
                                                            <Loader2 className="animate-spin" size={16} />
                                                        ) : (
                                                            <Download size={16} />
                                                        )}
                                                        PDF
                                                    </button>
                                                    <button
                                                        onClick={() => handleExportPNG(cls)}
                                                        disabled={exporting === `${cls}-png`}
                                                        className="flex-1 py-3 bg-linear-to-r from-blue-500 to-cyan-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 disabled:opacity-50 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99]"
                                                    >
                                                        {exporting === `${cls}-png` ? (
                                                            <Loader2 className="animate-spin" size={16} />
                                                        ) : (
                                                            <FileImage size={16} />
                                                        )}
                                                        PNG
                                                    </button>
                                                </div>

                                                {/* Re-draw button */}
                                                <button
                                                    onClick={() => {
                                                        setCategoryDraws(prev => ({
                                                            ...prev,
                                                            [cls]: {
                                                                ...prev[cls],
                                                                isDrawn: false,
                                                                isSaved: false,
                                                                groupA: { ...prev[cls].groupA, members: [] },
                                                                groupB: { ...prev[cls].groupB, members: [] }
                                                            }
                                                        }));
                                                    }}
                                                    className="w-full py-3 bg-white/5 border border-white/10 text-white/60 font-bold rounded-xl hover:bg-white/10 hover:text-white/80 flex items-center justify-center gap-2 transition-all"
                                                >
                                                    <Shuffle size={16} />
                                                    Ressortear Categoria
                                                </button>

                                                {/* Manual Redefine button */}
                                                <button
                                                    onClick={() => {
                                                        // Pre-populate with existing group members
                                                        setManualGroupA([...categoryDraw.groupA.members]);
                                                        setManualGroupB([...categoryDraw.groupB.members]);
                                                        setManualDefineCategory(cls);
                                                    }}
                                                    className="w-full py-3 bg-violet-500/10 border border-violet-500/30 text-violet-300 font-bold rounded-xl hover:bg-violet-500/20 hover:text-violet-200 flex items-center justify-center gap-2 transition-all"
                                                >
                                                    <ListChecks size={16} />
                                                    Redefinir Grupos
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* All Done Celebration */}
            {allCategoriesSaved && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-linear-to-t from-black/90 via-black/70 to-transparent">
                    <div className="flex items-center justify-center gap-4 p-4 bg-linear-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-2xl backdrop-blur-sm">
                        <PartyPopper className="text-green-400" size={32} />
                        <div>
                            <h3 className="text-white font-black">Todos os grupos sorteados!</h3>
                            <p className="text-green-200/70 text-sm">O campeonato está pronto para começar.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
