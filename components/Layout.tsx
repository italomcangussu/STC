import React, { useState, useEffect } from 'react';
import {
    Calendar, Users, Trophy, LayoutDashboard,
    Sandwich, Menu, X, LogOut, GraduationCap, Briefcase, Swords, Settings, DollarSign
} from 'lucide-react';
import { User } from '../types';
import { supabase } from '../lib/supabase';

interface NavItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    roles: string[];
}

interface LayoutProps {
    children: React.ReactNode;
    view: string;
    setView: (v: string) => void;
    currentUser: User;
    onLogout: () => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, view, setView, currentUser, onLogout }) => {
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [hasActiveChamps, setHasActiveChamps] = useState(false);

    // Check for active championships
    useEffect(() => {
        const checkChamps = async () => {
            const { data } = await supabase
                .from('championships')
                .select('id')
                .eq('status', 'ongoing')
                .limit(1);
            setHasActiveChamps((data || []).length > 0);
        };
        checkChamps();
    }, []);

    // Dynamic Navigation Items
    const navItems: NavItem[] = [
        { id: 'agenda', label: 'Agenda', icon: <Calendar size={20} />, roles: ['admin', 'socio'] },
        //{ id: 'atletas', label: 'Atletas', icon: <Users size={20} />, roles: ['admin', 'socio'] },
        { id: 'ranking', label: 'Ranking', icon: <Trophy size={20} />, roles: ['admin', 'socio'] },
        { id: 'desafios', label: 'Desafios', icon: <Swords size={20} />, roles: ['admin', 'socio'] },
        { id: 'superset', label: 'SuperSet', icon: <Trophy size={20} />, roles: ['admin', 'socio'] },
        //{ id: 'competicao', label: 'Competição', icon: <Trophy size={20} />, roles: ['admin', 'socio'] },
        { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, roles: ['admin', 'socio'] },
        { id: 'klanches', label: 'Klanches', icon: <Sandwich size={20} />, roles: ['admin', 'socio', 'lanchonete'] },
    ];

    // Add Competição if there are ongoing championships
    if (hasActiveChamps) {
        navItems.splice(4, 0, { id: 'competicao', label: 'Competição', icon: <Trophy size={20} />, roles: ['admin', 'socio'] });
    }

    // Add Professor Link if applicable
    if (currentUser.isProfessor) {
        navItems.push({ id: 'professor', label: 'Área do Professor', icon: <GraduationCap size={20} />, roles: ['socio', 'admin'] });
    }

    // Add Admin-Specific Links
    if (currentUser.role === 'admin') {
        navItems.push({ id: 'financeiro-admin', label: 'Financeiro', icon: <DollarSign size={20} />, roles: ['admin'] });
        navItems.push({ id: 'admin-professors', label: 'Gerenciar Pro.', icon: <Briefcase size={20} />, roles: ['admin'] });
        navItems.push({ id: 'admin-panel', label: 'Painel Admin', icon: <Settings size={20} />, roles: ['admin'] });
    }

    const filteredNav = navItems.filter(item => (!item.roles || item.roles.includes(currentUser.role)));

    return (
        <div className="min-h-screen bg-clay-pattern flex flex-col md:flex-row">
            {/* Mobile Header */}
            <header className="md:hidden bg-white border-b border-saibro-200 p-4 flex justify-between items-center sticky top-0 z-50">
                <div className="flex items-center gap-3">
                    <img src="https://smztsayzldjmkzmufqcz.supabase.co/storage/v1/object/public/logoapp/SOBRAL.zip%20-%201.png" className="w-8 h-8 object-contain" alt="Logo" />
                    <h1 className="text-xl font-bold text-saibro-700">STC Play</h1>
                </div>
                <button onClick={() => setSidebarOpen(true)} className="text-saibro-800">
                    <Menu size={24} />
                </button>
            </header>

            {/* Sidebar Overlay (Mobile) */}
            {isSidebarOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
            )}

            {/* Sidebar (Desktop & Mobile Drawer) */}
            <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-saibro-200 transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
      `}>
                <div className="p-6 flex justify-between items-center">
                    <div className="flex items-center gap-2 hidden md:flex">
                        <img src="https://smztsayzldjmkzmufqcz.supabase.co/storage/v1/object/public/logoapp/SOBRAL.zip%20-%201.png" className="w-10 h-10 object-contain" alt="Logo" />
                        <h1 className="text-2xl font-bold text-saibro-700">STC Play</h1>
                    </div>
                    <button onClick={() => setSidebarOpen(false)} className="md:hidden text-stone-500">
                        <X size={24} />
                    </button>
                </div>

                {/* User Profile Snippet */}
                <div className="px-6 mb-6">
                    <button
                        onClick={() => { setView('perfil'); setSidebarOpen(false); }}
                        className="flex items-center gap-3 bg-saibro-50 p-3 rounded-xl border border-saibro-100 w-full hover:bg-saibro-100 transition-colors text-left group"
                    >
                        <img src={currentUser.avatar} alt="User" className="w-10 h-10 rounded-full bg-stone-300 object-cover group-hover:scale-105 transition-transform" />
                        <div className="overflow-hidden">
                            <p className="font-semibold text-sm text-stone-800 truncate group-hover:text-saibro-700">{currentUser.name}</p>
                            <p className="text-xs text-saibro-600 uppercase font-bold flex items-center gap-1">
                                {currentUser.role}
                                {currentUser.isProfessor && <span className="text-[9px] bg-saibro-200 px-1 rounded">PROF</span>}
                            </p>
                        </div>
                    </button>
                    <p className="text-[10px] text-stone-400 text-center mt-1">Toque para ver/editar perfil</p>
                </div>

                <nav className="px-4 space-y-1 overflow-y-auto max-h-[calc(100vh-200px)]">
                    {filteredNav.map(item => (
                        <button
                            key={item.id}
                            onClick={() => { setView(item.id); setSidebarOpen(false); }}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${view === item.id
                                ? 'bg-saibro-500 text-white shadow-md shadow-orange-200'
                                : 'text-stone-600 hover:bg-saibro-50 hover:text-saibro-700'
                                }`}
                        >
                            {item.icon}
                            {item.label}
                        </button>
                    ))}

                    <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 mt-8">
                        <LogOut size={20} /> Sair
                    </button>
                </nav>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto h-[calc(100vh-64px)] md:h-screen">
                <div className="max-w-4xl mx-auto">
                    {children}
                </div>
            </main>

            {/* Bottom Nav (Mobile Only) */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-saibro-200 flex justify-around p-2 z-40 pb-safe">
                {filteredNav.slice(0, 5).map(item => (
                    <button
                        key={item.id}
                        onClick={() => setView(item.id)}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg w-16 ${view === item.id ? 'text-saibro-600' : 'text-stone-400'
                            }`}
                    >
                        {React.cloneElement(item.icon as React.ReactElement<any>, { size: 24 })}
                        <span className="text-[10px] mt-1 font-medium truncate w-full text-center">{item.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};
