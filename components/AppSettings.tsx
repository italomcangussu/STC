import React, { useCallback, useEffect, useState } from 'react';
import {
    Bell, BellOff, Download, Smartphone, RefreshCw, Trash2, Share, PlusSquare,
    Loader2, CheckCircle2, AlertTriangle, Sparkles, MonitorSmartphone, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { User } from '../types';
import {
    getPermissionStatus, isIOS, isInstalledPWA, isPushSupported, isSubscribed,
    subscribeToPush, unsubscribeFromPush,
} from '../lib/pushNotifications';
import { sendPushNotification } from '../lib/notificationService';
import {
    AppPreferences, applyPreferences, isWakeLockSupported, loadPreferences, savePreferences,
} from '../lib/appPreferences';

interface AppSettingsProps {
    currentUser: User;
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const Section: React.FC<{ icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }> = ({ icon, title, hint, children }) => (
    <section className="rounded-3xl border border-saibro-200/80 bg-white p-4 shadow-xs md:p-5">
        <header className="mb-3 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-saibro-50 text-saibro-600">{icon}</div>
            <div className="min-w-0">
                <h2 className="text-base font-bold text-stone-900">{title}</h2>
                {hint && <p className="text-xs text-stone-500">{hint}</p>}
            </div>
        </header>
        <div className="space-y-2">{children}</div>
    </section>
);

const Toggle: React.FC<{ label: string; description: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({ label, description, checked, disabled, onChange }) => (
    <label className={`flex min-h-[52px] items-center justify-between gap-4 rounded-2xl px-1 py-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
        <span className="min-w-0">
            <span className="block text-sm font-semibold text-stone-800">{label}</span>
            <span className="block text-xs text-stone-500">{description}</span>
        </span>
        <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
        />
        <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-stone-300 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-saibro-400 after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
    </label>
);

const ActionButton: React.FC<{ onClick: () => void; busy?: boolean; disabled?: boolean; tone?: 'primary' | 'neutral' | 'danger'; children: React.ReactNode }> = ({ onClick, busy, disabled, tone = 'neutral', children }) => {
    const tones = {
        primary: 'bg-saibro-600 text-white hover:bg-saibro-700',
        neutral: 'border border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100',
        danger: 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
    };
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy || disabled}
            className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50 sm:w-auto ${tones[tone]}`}
        >
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {children}
        </button>
    );
};

export const AppSettings: React.FC<AppSettingsProps> = ({ currentUser }) => {
    const [prefs, setPrefs] = useState<AppPreferences>(() => loadPreferences());
    const [installed] = useState(() => isInstalledPWA());
    const [ios] = useState(() => isIOS());
    const [permission, setPermission] = useState<NotificationPermission>(() => getPermissionStatus());
    const [subscribed, setSubscribed] = useState(false);
    const [pushBusy, setPushBusy] = useState(false);
    const [testBusy, setTestBusy] = useState(false);
    const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
    const [maintenanceBusy, setMaintenanceBusy] = useState<'update' | 'cache' | null>(null);

    const pushSupported = isPushSupported();
    // No iPhone o push só existe com o app instalado na Tela de Início (iOS 16.4+).
    const pushNeedsInstall = ios && !installed;

    const refreshPush = useCallback(async () => {
        setPermission(getPermissionStatus());
        setSubscribed(await isSubscribed());
    }, []);

    useEffect(() => { void refreshPush(); }, [refreshPush]);

    useEffect(() => {
        const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvent(e as InstallEvent); };
        const onInstalled = () => setInstallEvent(null);
        window.addEventListener('beforeinstallprompt', onPrompt);
        window.addEventListener('appinstalled', onInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', onPrompt);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    const updatePref = <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
        const next = { ...prefs, [key]: value };
        setPrefs(next);
        savePreferences(next);
        applyPreferences(next);
    };

    const handleInstall = async () => {
        if (!installEvent) return;
        await installEvent.prompt();
        await installEvent.userChoice;
        setInstallEvent(null);
    };

    const handleEnablePush = async () => {
        setPushBusy(true);
        try {
            const sub = await subscribeToPush(currentUser.id);
            await refreshPush();
            if (sub) toast.success('Notificações ativadas neste aparelho.');
            else if (getPermissionStatus() === 'denied') toast.error('Permissão negada. Libere nas configurações do sistema.');
            else toast.error('Não foi possível ativar as notificações.');
        } finally {
            setPushBusy(false);
        }
    };

    const handleDisablePush = async () => {
        setPushBusy(true);
        try {
            await unsubscribeFromPush();
            await refreshPush();
            toast.success('Notificações desativadas neste aparelho.');
        } finally {
            setPushBusy(false);
        }
    };

    const handleTestPush = async () => {
        setTestBusy(true);
        try {
            const ok = await sendPushNotification({
                userId: currentUser.id,
                title: 'STC Play',
                body: 'Notificação de teste: está tudo certo neste aparelho.',
                url: '/',
                tag: 'stc-test',
            });
            if (ok) toast.success('Teste enviado. Ele deve chegar em instantes.');
            else toast.error('O envio do teste falhou.');
        } finally {
            setTestBusy(false);
        }
    };

    const handleCheckUpdate = async () => {
        setMaintenanceBusy('update');
        try {
            const registration = await navigator.serviceWorker?.getRegistration();
            await registration?.update();
        } catch {
            // Sem rede ou sem service worker: o recarregamento abaixo ainda busca a versão nova.
        }
        window.location.reload();
    };

    const handleClearCache = async () => {
        setMaintenanceBusy('cache');
        try {
            if ('caches' in window) {
                const nomes = await caches.keys();
                await Promise.all(nomes.map((n) => caches.delete(n)));
            }
        } catch {
            // Sem acesso ao cache: só recarrega.
        }
        window.location.reload();
    };

    const pushActive = permission === 'granted' && subscribed;

    return (
        <div className="mx-auto max-w-2xl space-y-4 pb-6">
            <header className="px-1">
                <h1 className="text-2xl font-extrabold tracking-tight text-stone-900">Configurações</h1>
                <p className="text-sm text-stone-500">Ajustes deste aparelho para o STC Play se comportar como um app nativo.</p>
            </header>

            <Section
                icon={<Smartphone size={18} />}
                title="Aplicativo"
                hint={installed ? 'Aberto como app instalado.' : 'Aberto no navegador.'}
            >
                {installed ? (
                    <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                        <CheckCircle2 size={16} /> Instalado na Tela de Início
                    </p>
                ) : ios ? (
                    <ol className="space-y-2 text-sm text-stone-700">
                        <li className="flex items-center gap-2"><Share size={16} className="text-saibro-600" /> Toque em Compartilhar no Safari.</li>
                        <li className="flex items-center gap-2"><PlusSquare size={16} className="text-saibro-600" /> Escolha “Adicionar à Tela de Início”.</li>
                        <li className="flex items-center gap-2"><Smartphone size={16} className="text-saibro-600" /> Abra o STC Play pelo novo ícone.</li>
                    </ol>
                ) : installEvent ? (
                    <ActionButton tone="primary" onClick={handleInstall}><Download size={16} /> Instalar o app</ActionButton>
                ) : (
                    <p className="text-sm text-stone-500">Use o menu do navegador e escolha “Instalar app” para adicioná-lo ao aparelho.</p>
                )}
            </Section>

            <Section
                icon={pushActive ? <Bell size={18} /> : <BellOff size={18} />}
                title="Notificações"
                hint="Avisos de desafios, reservas e, para administradores, novas mensagens."
            >
                {!pushSupported ? (
                    <p className="flex items-start gap-2 text-sm text-stone-600"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" /> Este navegador não oferece notificações push.</p>
                ) : pushNeedsInstall ? (
                    <p className="flex items-start gap-2 text-sm text-stone-600"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" /> No iPhone, as notificações só funcionam depois de instalar o app na Tela de Início (iOS 16.4 ou superior).</p>
                ) : permission === 'denied' ? (
                    <p className="flex items-start gap-2 text-sm text-stone-600"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" /> As notificações estão bloqueadas. Libere em Ajustes do sistema, na seção do STC Play, e volte aqui.</p>
                ) : (
                    <>
                        <p className={`flex items-center gap-2 text-sm font-medium ${pushActive ? 'text-emerald-700' : 'text-stone-600'}`}>
                            {pushActive ? <CheckCircle2 size={16} /> : <BellOff size={16} />}
                            {pushActive ? 'Ativas neste aparelho' : 'Desativadas neste aparelho'}
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            {pushActive ? (
                                <>
                                    <ActionButton onClick={handleTestPush} busy={testBusy}>Enviar notificação de teste</ActionButton>
                                    <ActionButton tone="danger" onClick={handleDisablePush} busy={pushBusy}>Desativar</ActionButton>
                                </>
                            ) : (
                                <ActionButton tone="primary" onClick={handleEnablePush} busy={pushBusy}>Ativar notificações</ActionButton>
                            )}
                        </div>
                    </>
                )}
            </Section>

            <Section icon={<Sparkles size={18} />} title="Comportamento" hint="Valem só para este aparelho.">
                <Toggle
                    label="Sensação de app nativo"
                    description="Sem seleção de texto fora de campos, sem menu de toque longo e sem quique ao rolar."
                    checked={prefs.nativeFeel}
                    onChange={(v) => updatePref('nativeFeel', v)}
                />
                <Toggle
                    label="Manter a tela ligada"
                    description={isWakeLockSupported() ? 'A tela não apaga enquanto o app estiver aberto, útil no placar ao vivo.' : 'Este navegador não permite manter a tela ligada.'}
                    checked={prefs.keepAwake}
                    disabled={!isWakeLockSupported()}
                    onChange={(v) => updatePref('keepAwake', v)}
                />
                <Toggle
                    label="Reduzir animações"
                    description="Desliga transições e movimentos da interface."
                    checked={prefs.reduceMotion}
                    onChange={(v) => updatePref('reduceMotion', v)}
                />
            </Section>

            <Section icon={<MonitorSmartphone size={18} />} title="Manutenção" hint="Use se o app parecer desatualizado ou travado.">
                <div className="flex flex-col gap-2 sm:flex-row">
                    <ActionButton onClick={handleCheckUpdate} busy={maintenanceBusy === 'update'} disabled={maintenanceBusy !== null}>
                        <RefreshCw size={16} /> Buscar atualização
                    </ActionButton>
                    <ActionButton tone="danger" onClick={handleClearCache} busy={maintenanceBusy === 'cache'} disabled={maintenanceBusy !== null}>
                        <Trash2 size={16} /> Limpar cache e recarregar
                    </ActionButton>
                </div>
                <p className="flex items-center gap-2 text-xs text-stone-500"><Zap size={12} /> Seu login e suas preferências são mantidos.</p>
            </Section>
        </div>
    );
};

export default AppSettings;
