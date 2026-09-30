import React, { useState, useEffect } from 'react';
import {
    Calendar, Users, Trophy, LayoutDashboard,
    Sandwich, Menu, X, LogOut, GraduationCap, Briefcase, Swords, Settings, DollarSign, Bell, Gamepad2, Shuffle, ChevronRight, Vote
} from 'lucide-react';
import { User } from '../types';
import { supabase } from '../lib/supabase';
import { isPushSupported, isInstalledPWA, isIOS, getPermissionStatus, subscribeToPush, isSubscribed } from '../lib/pushNotifications';
import { PushPermissionPrompt } from './PushPermissionPrompt';
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
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [_hasActiveChamps, setHasActiveChamps] = useState(false);
    const [_pushEnabled, setPushEnabled] = useState<boolean | null>(null);
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

            if (!supported) {
                setShowPushBanner(false);
                return;
            }

            setPushEnabled(subscribed);

            const shouldShow = !subscribed && permission !== 'denied';
            setShowPushBanner(shouldShow);

            if ('setAppBadge' in navigator && isInstalledPWA()) {
                navigator.clearAppBadge().catch(err => console.debug('[Badge] Error clearing:', err));
            }
        };
        checkPush();
    }, []);

    const handleEnablePush = async () => {
        const subscription = await subscribeToPush();
        if (subscription) {
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
        { id: 'ranking', label: 'Ranking', icon: <Trophy size={20} />, roles: ['admin', 'socio'] },
        { id: 'desafios', label: 'Desafios', icon: <Swords size={20} />, roles: ['admin', 'socio'] },
        { id: 'superset', label: 'SuperSet', icon: <Trophy size={20} />, roles: ['admin', 'socio'] },
        { id: 'campeonatos', label: 'Campeonatos', icon: <Trophy size={20} />, roles: ['admin', 'socio'] },
        { id: 'tenisproplayer', label: 'TenisProPlayer', icon: <Gamepad2 size={20} />, roles: ['admin', 'socio'] },
        { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, roles: ['admin', 'socio'] },
        { id: 'klanches', label: 'Klanches', icon: <Sandwich size={20} />, roles: ['admin', 'socio', 'lanchonete'] },
    ];

    if (currentUser.isProfessor) {
        navItems.push({ id: 'professor', label: 'Área do Professor', icon: <GraduationCap size={20} />, roles: ['socio', 'admin'] });
    }

    if (currentUser.role === 'admin') {
        navItems.push({ id: 'championship-admin', label: 'Campeonato Admin', icon: <Trophy size={20} />, roles: ['admin'] });
        navItems.push({ id: 'championship-creator', label: 'Criador de Campeonatos', icon: <Shuffle size={20} />, roles: ['admin'] });
        navItems.push({ id: 'admin-forms', label: 'Formulários', icon: <Vote size={20} />, roles: ['admin'] });
        navItems.push({ id: 'financeiro-admin', label: 'Financeiro', icon: <DollarSign size={20} />, roles: ['admin'] });
        navItems.push({ id: 'admin-students', label: 'Alunos', icon: <Users size={20} />, roles: ['admin'] });
        navItems.push({ id: 'admin-professors', label: 'Gerenciar Pro.', icon: <Briefcase size={20} />, roles: ['admin'] });
        navItems.push({ id: 'admin-panel', label: 'Painel Admin', icon: <Settings size={20} />, roles: ['admin'] });
    }

    const filteredNav = navItems.filter(item => (!item.roles || item.roles.includes(currentUser.role)));

    return (
        <div className="relative h-full flex flex-col md:flex-row overflow-hidden bg-clay-pattern">
            {/* Mobile Header Bar (HIG Standard Navigation Bar) */}
            <header className="flex-none md:hidden bg-white/85 backdrop-blur-xl border-b border-saibro-200/80 px-4 py-3 flex justify-between items-center z-50 pt-safe sticky top-0 shadow-xs">
                <div className="flex items-center gap-2.5">
                    <img
                        src="https://smztsayzldjmkzmufqcz.supabase.co/storage/v1/object/public/logoapp/SOBRAL.zip%20-%201.png"
                        className="w-8 h-8 object-contain cursor-pointer active:scale-90 transition-transform duration-150"
                        alt="Logo"
                        onClick={handleLogoClick}
                    />
                    <div className="flex flex-col">
                        <h1 className="text-lg font-extrabold text-saibro-700 tracking-tight leading-none">STC Play</h1>
                        <span className="text-[10px] text-stone-400 font-semibold tracking-wider uppercase leading-none mt-0.5">Clube de Tênis</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {showPushBanner && (
                        <button
                            onClick={handleEnablePush}
                            aria-label="Ativar Notificações"
                            className="w-9 h-9 rounded-full bg-saibro-100 text-saibro-700 flex items-center justify-center active:scale-90 transition-transform shadow-xs"
                        >
                            <Bell size={18} />
                        </button>
                    )}

                    {/* Tactile Menu Trigger */}
                    <button
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className={`flex items-center gap-1.5 p-1 pl-1.5 pr-2 rounded-full border transition-all shadow-xs ${
                            isMenuOpen
                                ? 'bg-saibro-500 border-saibro-600 text-white'
                                : 'bg-saibro-50/90 border-saibro-200/90 text-saibro-900 active:scale-95'
                        }`}
                        aria-label="Menu Principal"
                    >
                        <div className="relative">
                            <img
                                src={currentUser.avatar}
                                alt={currentUser.name}
                                className="w-7 h-7 rounded-full object-cover border border-saibro-400"
                            />
                            {currentUser.role === 'admin' && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-saibro-600 border border-white rounded-full" />
                            )}
                        </div>
                        {isMenuOpen ? (
                            <X size={18} className="text-white transition-transform duration-200" />
                        ) : (
                            <Menu size={18} className="text-saibro-800 transition-transform duration-200" />
                        )}
                    </button>
                </div>
            </header>

            {/* Mobile Toolbar Popover Menu */}
            {isMenuOpen && (
                <>
                    {/* Backdrop overlay */}
                    <div
                        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs md:hidden animate-fade-in"
                        onClick={() => setIsMenuOpen(false)}
                    />

                    {/* Origin-aware Popover Menu */}
                    <div className="fixed top-16 right-3 z-50 w-[calc(100vw-24px)] max-w-sm bg-white/95 backdrop-blur-2xl border border-stone-200/90 rounded-3xl shadow-2xl overflow-hidden animate-popover-enter max-h-[80vh] flex flex-col md:hidden">
                        {/* User Profile Snippet */}
                        <div className="p-4 bg-gradient-to-b from-saibro-50/80 to-transparent border-b border-saibro-100 flex-none">
                            <button
                                onClick={() => { setView('perfil'); setIsMenuOpen(false); }}
                                className="flex items-center justify-between w-full bg-white/80 p-3 rounded-2xl border border-saibro-200/60 shadow-xs hover:bg-white active:scale-[0.98] transition-all text-left group"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <img src={currentUser.avatar} alt="User" className="w-11 h-11 rounded-full bg-stone-200 object-cover border-2 border-saibro-300 group-hover:scale-105 transition-transform" />
                                    <div className="overflow-hidden">
                                        <p className="font-bold text-sm text-stone-900 truncate group-hover:text-saibro-700">{currentUser.name}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-saibro-100 text-saibro-700 border border-saibro-200">
                                                {currentUser.role}
                                            </span>
                                            {currentUser.isProfessor && (
                                                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-court-green/10 text-court-green border border-court-green/20">
                                                    PROF
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <ChevronRight size={18} className="text-stone-400 group-hover:text-saibro-600 transition-colors shrink-0" />
                            </button>

                            {/* Push Notification Banner */}
                            {showPushBanner && (
                                <button
                                    onClick={handleEnablePush}
                                    className="mt-3 w-full flex items-center gap-2.5 bg-saibro-50 border border-saibro-200 p-2.5 rounded-xl text-left active:scale-[0.98] transition-all"
                                >
                                    <div className="w-7 h-7 bg-saibro-500 rounded-full flex items-center justify-center text-white shrink-0 shadow-xs">
                                        <Bell size={14} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-saibro-900">
                                            {(isInstalledPWA() || !isIOS()) ? 'Ativar Notificações' : 'Instalar App para Notificar'}
                                        </p>
                                        <p className="text-[10px] text-stone-500 truncate">
                                            {(isInstalledPWA() || !isIOS()) ? 'Receba alertas de desafios' : 'Adicione à Tela de Início'}
                                        </p>
                                    </div>
                                </button>
                            )}
                        </div>

                        {/* Nav Menu Content */}
                        <div className="p-3 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
                            {/* Regular Navigation Items */}
                            <div className="space-y-1">
                                <p className="text-[10px] font-extrabold tracking-wider uppercase text-stone-400 px-3 mb-1">Menu Principal</p>
                                {filteredNav.filter(item => !item.id.startsWith('admin-') && item.id !== 'championship-admin' && item.id !== 'championship-creator' && item.id !== 'financeiro-admin').map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => { setView(item.id); setIsMenuOpen(false); }}
                                        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
                                            view === item.id
                                                ? 'bg-sunset-gradient text-white shadow-md shadow-orange-200/50 font-bold'
                                                : 'text-stone-700 hover:bg-saibro-50 hover:text-saibro-700'
                                        }`}
                                    >
                                        <div className={`${view === item.id ? 'text-white' : 'text-saibro-600'}`}>
                                            {item.icon}
                                        </div>
                                        <span>{item.label}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Admin Section if Admin */}
                            {currentUser.role === 'admin' && (
                                <div className="space-y-1 pt-2 border-t border-stone-100">
                                    <div className="flex items-center justify-between px-3 mb-1">
                                        <p className="text-[10px] font-extrabold tracking-wider uppercase text-saibro-700">Administração</p>
                                        <span className="text-[9px] font-bold bg-saibro-100 text-saibro-800 px-1.5 py-0.5 rounded">PAINEL</span>
                                    </div>
                                    {filteredNav.filter(item => item.id.startsWith('admin-') || item.id === 'championship-admin' || item.id === 'championship-creator' || item.id === 'financeiro-admin').map(item => (
                                        <button
                                            key={item.id}
                                            onClick={() => { setView(item.id); setIsMenuOpen(false); }}
                                            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
                                                view === item.id
                                                    ? 'bg-sunset-gradient text-white shadow-md shadow-orange-200/50 font-bold'
                                                    : 'text-stone-700 hover:bg-saibro-50 hover:text-saibro-700'
                                            }`}
                                        >
                                            <div className={`${view === item.id ? 'text-white' : 'text-saibro-600'}`}>
                                                {item.icon}
                                            </div>
                                            <span>{item.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Menu Footer */}
                        <div className="p-3 border-t border-stone-100 bg-stone-50/50 flex-none">
                            <button
                                onClick={() => { setIsMenuOpen(false); onLogout(); }}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100 active:scale-[0.98] transition-all"
                            >
                                <LogOut size={18} /> Sair do App
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Sidebar (Desktop Only) */}
            <aside className="hidden md:flex md:flex-col md:relative w-64 bg-white border-r border-saibro-200 inset-y-0 left-0 z-30 flex-none">
                <div className="p-6 flex-none flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <img
                            src="https://smztsayzldjmkzmufqcz.supabase.co/storage/v1/object/public/logoapp/SOBRAL.zip%20-%201.png"
                            className="w-10 h-10 object-contain cursor-pointer active:scale-95 transition-transform"
                            alt="Logo"
                            onClick={handleLogoClick}
                        />
                        <h1 className="text-2xl font-bold text-saibro-700">STC Play</h1>
                    </div>
                </div>

                {/* User Profile Snippet */}
                <div className="px-6 mb-6 flex-none">
                    <button
                        onClick={() => setView('perfil')}
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
                            onClick={() => setView(item.id)}
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
                <div className={`mx-auto ${view === 'admin-panel' ? 'w-full px-2 md:px-0 pb-main-content md:pb-4' : 'max-w-4xl p-4 md:p-6 pb-main-content md:pb-12'}`}>
                    {children}
                </div>
            </main>

            {/* Bottom Nav (Mobile Only) */}
            <div className="absolute bottom-0 left-0 right-0 md:hidden bg-white/95 backdrop-blur-md border-t border-saibro-200 flex justify-around px-6 pt-3 pb-navbottom z-40 shadow-[0_-8px_20px_rgba(0,0,0,0.08)]">
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
