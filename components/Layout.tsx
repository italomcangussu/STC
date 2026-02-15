import React, { useState, useEffect } from 'react';
import {
    Calendar, Users, Trophy, LayoutDashboard,
    Sandwich, Menu, X, LogOut, GraduationCap, Briefcase, Swords, Settings, DollarSign, Bell, BellOff
} from 'lucide-react';
import { User } from '../types';
import { supabase } from '../lib/supabase';
import { isPushSupported, isInstalledPWA, isIOS, getPermissionStatus, subscribeToPush, isSubscribed } from '../lib/pushNotifications';
import { PushPermissionPrompt } from './PushPermissionPrompt';
import { InstallPrompt } from './InstallPrompt';
import { AdminLogin } from './AdminLogin';

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
    const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
    const [showPushBanner, setShowPushBanner] = useState(false);
    const [showAdminLogin, setShowAdminLogin] = useState(false);
    const [logoClicks, setLogoClicks] = useState(0);

    // Secret Admin Trigger
    const handleLogoClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setLogoClicks(prev => prev + 1);

        // Reset clicks after 2 seconds of inactivity
        setTimeout(() => setLogoClicks(0), 2000);
    };

    // Handle Admin Trigger Effect
    useEffect(() => {
        if (logoClicks >= 5) {
            if (currentUser.role === 'admin') {
                setView('admin-panel');
            } else {
                setShowAdminLogin(true);
            }
            setLogoClicks(0);
        }
    }, [logoClicks, currentUser.role, setView]);

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

    // Check push notification status
    useEffect(() => {
        const checkPush = async () => {
            const supported = isPushSupported();
            const pwa = isInstalledPWA();
            const permission = getPermissionStatus();
            const subscribed = await isSubscribed();

            console.log('[Push Debug]', { supported, pwa, permission, subscribed });

            // Temporary: Show banner even if not installed (for testing)
            // But warn that it might not work
            if (!supported) {
                setShowPushBanner(false);
                return;
            }

            setPushEnabled(subscribed);

            // LOGIC FIX: Always show if supported and not subscribed, let the button handler deal with logic
            // so the user knows it exists
            const shouldShow = !subscribed && permission !== 'denied';
            setShowPushBanner(shouldShow);

            // Clear app badge if supported (Apple guideline constraint)
            if ('setAppBadge' in navigator && isInstalledPWA()) {
                navigator.clearAppBadge().catch(err => console.debug('[Badge] Error clearing:', err));
            }
        };
        checkPush();
    }, []);

    const handleEnablePush = async () => {
        const subscription = await subscribeToPush();
        if (subscription) {
            // Save subscription to database
            await supabase.from('push_subscriptions').upsert({
                user_id: currentUser.id,
                endpoint: subscription.endpoint,
                keys: subscription.keys
            }, { onConflict: 'user_id' });

            setPushEnabled(true);
            setShowPushBanner(false);
        }
    };

    // Dynamic Navigation Items
    const navItems: NavItem[] = [
        { id: 'agenda', label: 'Agenda', icon: <Calendar size={20} />, roles: ['admin', 'socio'] },
        //{ id: 'atletas', label: 'Atletas', icon: <Users size={20} />, roles: ['admin', 'socio'] },
        { id: 'ranking', label: 'Ranking', icon: <Trophy size={20} />, roles: ['admin', 'socio'] },
        { id: 'desafios', label: 'Desafios', icon: <Swords size={20} />, roles: ['admin', 'socio'] },
        { id: 'superset', label: 'SuperSet', icon: <Trophy size={20} />, roles: ['admin', 'socio'] },
        { id: 'campeonatos', label: 'Campeonatos', icon: <Trophy size={20} />, roles: ['admin', 'socio'] },
        { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, roles: ['admin', 'socio'] },
        { id: 'klanches', label: 'Klanches', icon: <Sandwich size={20} />, roles: ['admin', 'socio', 'lanchonete'] },
    ];

    // Add Professor Link if applicable
    if (currentUser.isProfessor) {
        navItems.push({ id: 'professor', label: 'Área do Professor', icon: <GraduationCap size={20} />, roles: ['socio', 'admin'] });
    }

    // Add Admin-Specific Links
    if (currentUser.role === 'admin') {
        navItems.push({ id: 'championship-admin', label: 'Campeonato Admin', icon: <Trophy size={20} />, roles: ['admin'] });
        navItems.push({ id: 'financeiro-admin', label: 'Financeiro', icon: <DollarSign size={20} />, roles: ['admin'] });
        navItems.push({ id: 'admin-students', label: 'Alunos', icon: <Users size={20} />, roles: ['admin'] });
        navItems.push({ id: 'admin-professors', label: 'Gerenciar Pro.', icon: <Briefcase size={20} />, roles: ['admin'] });
        navItems.push({ id: 'admin-panel', label: 'Painel Admin', icon: <Settings size={20} />, roles: ['admin'] });
    }

    const filteredNav = navItems.filter(item => (!item.roles || item.roles.includes(currentUser.role)));

    return (
        <div className="h-dvh flex flex-col md:flex-row overflow-hidden bg-clay-pattern">
            {/* Mobile Header */}
            <header className="flex-none md:hidden bg-white border-b border-saibro-200 p-4 flex justify-between items-center z-50 pt-safe">
                <div className="flex items-center gap-3">
                    <img
                        src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/logoapp/SOBRAL.zip%20-%201.png`}
                        className="w-8 h-8 object-contain active:scale-90 transition-transform"
                        alt="Logo"
                        onClick={handleLogoClick}
                    />
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
                md:relative md:translate-x-0 md:flex md:flex-col
            `}>
                <div className="p-6 flex-none flex justify-between items-center">
                    <div className="hidden md:flex items-center gap-2">
                        <img
                            src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/logoapp/SOBRAL.zip%20-%201.png`}
                            className="w-10 h-10 object-contain cursor-pointer active:scale-95 transition-transform"
                            alt="Logo"
                            onClick={handleLogoClick}
                        />
                        <h1 className="text-2xl font-bold text-saibro-700">STC Play</h1>
                    </div>
                    <button onClick={() => setSidebarOpen(false)} className="md:hidden text-stone-500">
                        <X size={24} />
                    </button>
                </div>

                {/* User Profile Snippet */}
                <div className="px-6 mb-6 flex-none">
                    <button
                        onClick={() => { setView('perfil'); setSidebarOpen(false); }}
                        className="flex items-center gap-3 bg-saibro-50 p-3 rounded-2xl card-court w-full hover:bg-saibro-100 transition-smooth text-left group"
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

                    {/* Push Notification Banner */}
                    {showPushBanner && (
                        <button
                            onClick={handleEnablePush}
                            className="mt-3 w-full flex items-center gap-2 bg-saibro-100 border border-saibro-200 p-3 rounded-xl text-left hover:bg-saibro-200 transition-colors"
                        >
                            <div className="w-8 h-8 bg-saibro-500 rounded-full flex items-center justify-center text-white shrink-0">
                                <Bell size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-saibro-800">
                                    {(isInstalledPWA() || !isIOS()) ? 'Ativar Notificações' : 'Instalar App para Notificar'}
                                </p>
                                <p className="text-[10px] text-saibro-600 truncate">
                                    {(isInstalledPWA() || !isIOS()) ? 'Receba alertas de desafios' : 'Adicione à Tela de Início primeiro'}
                                </p>
                            </div>
                        </button>
                    )}
                </div>

                <nav className="px-4 pb-6 space-y-1 overflow-y-auto flex-1 custom-scrollbar">
                    {filteredNav.map(item => (
                        <button
                            key={item.id}
                            onClick={() => { setView(item.id); setSidebarOpen(false); }}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-smooth ${view === item.id
                                ? 'bg-sunset-gradient text-white shadow-lg shadow-orange-200/50'
                                : 'text-stone-600 hover:bg-saibro-100 hover:text-saibro-700'
                                }`}
                        >
                            {item.icon}
                            {item.label}
                        </button>
                    ))}

                    <div className="divider-net mx-4 my-4"></div>

                    <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition-smooth">
                        <LogOut size={20} /> Sair
                    </button>
                </nav>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto overscroll-contain relative custom-scrollbar">
                <div className={`mx-auto ${view === 'admin-panel' ? 'w-full px-2 md:px-0 pb-32 md:pb-4' : 'max-w-4xl p-4 md:p-6 pb-32 md:pb-12'}`}>
                    {children}
                </div>
            </main>

            {/* Bottom Nav (Mobile Only) */}
            <div className="flex-none md:hidden bg-white/95 backdrop-blur-md border-t border-saibro-200 flex justify-around px-6 pt-3 pb-[calc(35px+env(safe-area-inset-bottom,20px))] z-40 shadow-[0_-8px_20px_rgba(0,0,0,0.08)]">
                {filteredNav.slice(0, 5).map(item => (
                    <button
                        key={item.id}
                        onClick={() => setView(item.id)}
                        className={`flex flex-col items-center justify-center py-1 px-1 rounded-xl flex-1 transition-all duration-300 active:scale-75 ${view === item.id ? 'text-saibro-600 bg-saibro-50/50 shadow-inner' : 'text-stone-400 hover:text-stone-600'}`}
                    >
                        <div className={`transition-transform duration-300 ${view === item.id ? 'scale-110 drop-shadow-[0_0_8px_rgba(249,115,22,0.3)]' : ''}`}>
                            {React.cloneElement(item.icon as React.ReactElement<any>, { size: 22 })}
                        </div>
                        <span className={`text-[9px] mt-1 font-bold uppercase tracking-tighter truncate w-full text-center transition-all ${view === item.id ? 'opacity-100 scale-105' : 'opacity-70'}`}>{item.label}</span>
                    </button>
                ))}
            </div>

            <PushPermissionPrompt />

            {showAdminLogin && (
                <AdminLogin
                    onSuccess={() => {
                        setShowAdminLogin(false);
                        setView('admin-panel');
                    }}
                    onClose={() => setShowAdminLogin(false)}
                />
            )}
        </div>
    );
};
