import React, { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { isPushSupported, isInstalledPWA, isSubscribed, subscribeToPush, isIOS } from '../lib/pushNotifications';

export const PushPermissionPrompt: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const checkEligibility = async () => {
            // 1. Must be supported (Service Worker + Push API)
            if (!isPushSupported()) return;

            // 2. Must be installed PWA (Only strictly required for iOS)
            if (isIOS() && !isInstalledPWA()) return;

            // 3. Check if already subscribed
            const alreadySubscribed = await isSubscribed();
            if (alreadySubscribed) return;

            // 4. Check if user recently dismissed (prevent spamming)
            const lastDismissed = localStorage.getItem('push_prompt_dismissed');
            if (lastDismissed) {
                const hoursSinceDismiss = (Date.now() - parseInt(lastDismissed)) / (1000 * 60 * 60);
                // Show again only after 24 hours
                if (hoursSinceDismiss < 24) return;
            }

            // If all checks pass, show modal
            setIsVisible(true);
        };

        // Small delay to not overwhelm user immediately on load
        const timer = setTimeout(checkEligibility, 1500);
        return () => clearTimeout(timer);
    }, []);

    const handleEnable = async () => {
        setLoading(true);
        const result = await subscribeToPush();
        setLoading(false);

        if (result) {
            // Success! Close modal forever for this sub
            setIsVisible(false);
            // Optionally could show a success toast here
        }
    };

    const handleDismiss = () => {
        setIsVisible(false);
        // Save dismissal timestamp
        localStorage.setItem('push_prompt_dismissed', Date.now().toString());
    };

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 zoom-in-95 duration-300">
                {/* Visual Header */}
                <div className="bg-linear-to-br from-saibro-500 to-saibro-600 p-6 text-center">
                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-md border border-white/30 shadow-inner">
                        <Bell className="text-white" size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-1">Não perca nenhum jogo!</h3>
                    <p className="text-saibro-50 text-sm">
                        Receba avisos instantâneos sobre desafios e resultados.
                    </p>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    <ul className="space-y-3">
                        <li className="flex items-center gap-3 text-sm text-stone-600">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Saiba quando for desafiado
                        </li>
                        <li className="flex items-center gap-3 text-sm text-stone-600">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Confirmações de reserva
                        </li>
                        <li className="flex items-center gap-3 text-sm text-stone-600">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Atualizações do ranking
                        </li>
                    </ul>

                    <div className="pt-2 flex flex-col gap-3">
                        <button
                            onClick={handleEnable}
                            disabled={loading}
                            className="w-full py-3.5 bg-saibro-600 hover:bg-saibro-700 text-white font-bold rounded-xl shadow-lg shadow-saibro-600/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                'Ativar Notificações'
                            )}
                        </button>

                        <button
                            onClick={handleDismiss}
                            className="w-full py-3 text-stone-400 font-medium text-sm hover:text-stone-600 transition-colors"
                        >
                            Agora não
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
