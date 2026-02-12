import React, { useState, useEffect } from 'react';
import { Download, Share, PlusSquare, X } from 'lucide-react';
import { isIOS, isInstalledPWA } from '../lib/pushNotifications';

export const InstallPrompt: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [showIOSInstructions, setShowIOSInstructions] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isIOSDevice, setIsIOSDevice] = useState(false);

    useEffect(() => {
        // Don't show if already installed
        if (isInstalledPWA()) return;

        // Check platform
        const ios = isIOS();
        setIsIOSDevice(ios);

        if (ios) {
            // Show prompt for iOS after a small delay
            // Check if dismissed previously
            const dismissed = localStorage.getItem('install_prompt_dismissed');
            if (!dismissed) {
                setTimeout(() => setIsVisible(true), 2000);
            }
        } else {
            // Android / Desktop - Listen for install prompt
            const handleBeforeInstallPrompt = (e: any) => {
                e.preventDefault();
                setDeferredPrompt(e);
                setIsVisible(true);
            };

            window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

            return () => {
                window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            };
        }
    }, []);

    const handleInstallClick = async () => {
        if (isIOSDevice) {
            setShowIOSInstructions(true);
        } else if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                setDeferredPrompt(null);
                setIsVisible(false);
            }
        }
    };

    const handleDismiss = () => {
        setIsVisible(false);
        localStorage.setItem('install_prompt_dismissed', 'true');
    };

    if (!isVisible) return null;

    return (
        <>
            {/* Floating Action Button */}
            <div className="fixed bottom-20 right-4 z-90 animate-in slide-in-from-bottom-4 duration-500">
                <button
                    onClick={handleInstallClick}
                    className="flex items-center gap-2 bg-linear-to-r from-saibro-600 to-saibro-500 text-white pl-4 pr-5 py-3 rounded-full shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all"
                >
                    <div className="bg-white/20 p-1.5 rounded-full">
                        <Download size={18} className="text-white" />
                    </div>
                    <div className="text-left">
                        <p className="text-[10px] font-medium text-saibro-100 uppercase tracking-wider leading-none mb-0.5">App Disponível</p>
                        <p className="text-sm font-bold leading-none">Instalar App</p>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
                        className="ml-2 -mr-2 p-2 hover:bg-black/10 rounded-full transition-colors"
                    >
                        <X size={14} className="text-saibro-100" />
                    </button>
                </button>
            </div>

            {/* iOS Instructions Modal */}
            {showIOSInstructions && (
                <div className="fixed inset-0 z-100 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl relative animate-in slide-in-from-bottom-10 duration-300">
                        <button
                            onClick={() => setShowIOSInstructions(false)}
                            className="absolute top-4 right-4 text-stone-400 hover:text-stone-600"
                        >
                            <X size={24} />
                        </button>

                        <div className="text-center mb-6">
                            <div className="w-16 h-16 bg-saibro-100 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-inner">
                                <img src="/favicon-192.png" alt="Icon" className="w-10 h-10 object-contain" onError={(e) => e.currentTarget.style.display = 'none'} />
                                <Download className="text-saibro-600 w-8 h-8 absolute" style={{ opacity: 0.5 }} />
                            </div>
                            <h3 className="text-xl font-bold text-stone-800">Instalar STC Play</h3>
                            <p className="text-stone-500 text-sm mt-1">
                                Instale na sua Tela de Início para uma melhor experiência.
                            </p>
                        </div>

                        <div className="space-y-4 bg-stone-50 p-4 rounded-xl border border-stone-100">
                            <div className="flex items-center gap-4">
                                <div className="w-8 h-8 flex items-center justify-center text-blue-600">
                                    <Share size={24} />
                                </div>
                                <div className="text-sm text-stone-600">
                                    1. Toque no botão <span className="font-bold text-stone-800">Compartilhar</span> na barra inferior.
                                </div>
                            </div>
                            <div className="w-full h-px bg-stone-200"></div>
                            <div className="flex items-center gap-4">
                                <div className="w-8 h-8 flex items-center justify-center text-stone-700">
                                    <PlusSquare size={24} />
                                </div>
                                <div className="text-sm text-stone-600">
                                    2. Role para baixo e toque em <span className="font-bold text-stone-800">Adicionar à Tela de Início</span>.
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => setShowIOSInstructions(false)}
                            className="mt-6 w-full py-3 bg-saibro-600 text-white font-bold rounded-xl active:scale-95 transition-transform"
                        >
                            Entendi
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};
