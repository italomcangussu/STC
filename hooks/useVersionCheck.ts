import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface VersionCheckConfig {
    checkInterval?: number; // em minutos, default: 5
    enableBroadcast?: boolean; // default: true
}

export function useVersionCheck(config: VersionCheckConfig = {}) {
    const { checkInterval = 5, enableBroadcast = true } = config;
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [currentVersion, setCurrentVersion] = useState<string | null>(null);
    const [availableVersion, setAvailableVersion] = useState<string | null>(null);

    // Função para buscar versão do servidor
    const checkVersion = async () => {
        try {
            const response = await fetch(`/version.json?v=${Date.now()}`, { cache: 'no-store' });

            if (!response.ok) {
                // Em desenvolvimento, /version.json pode não existir.
                if (!import.meta.env.DEV) {
                    console.warn('Falha ao buscar version.json:', response.status);
                }
                return;
            }

            const rawBody = await response.text();
            let data: { version?: string };

            try {
                data = JSON.parse(rawBody);
            } catch {
                // Evita erro quando o servidor retorna HTML (ex.: fallback do SPA).
                if (!import.meta.env.DEV) {
                    console.warn('Resposta inválida ao verificar versão.');
                }
                return;
            }

            const serverVersion = data.version;

            if (!serverVersion || typeof serverVersion !== 'string') {
                return;
            }

            const storedVersion = localStorage.getItem('app_version');

            if (!storedVersion) {
                // Primeira vez, salvar versão atual
                setCurrentVersion(serverVersion);
                localStorage.setItem('app_version', serverVersion);
            } else if (serverVersion !== storedVersion) {
                // Nova versão detectada!
                console.log('🎉 Nova versão disponível:', serverVersion);
                setUpdateAvailable(true);
                setAvailableVersion(serverVersion);
            }
        } catch (error) {
            if (!import.meta.env.DEV) {
                console.error('Erro ao verificar versão:', error);
            }
        }
    };

    useEffect(() => {
        // Carregar versão do localStorage na inicialização
        const storedVersion = localStorage.getItem('app_version');
        if (storedVersion) {
            setCurrentVersion(storedVersion);
        }

        // Verificação inicial
        checkVersion();

        // Verificação periódica
        const intervalId = setInterval(() => {
            checkVersion();
        }, checkInterval * 60 * 1000);

        return () => clearInterval(intervalId);
    }, [checkInterval]);

    useEffect(() => {
        if (!enableBroadcast) return;

        // Supabase Realtime: escutar broadcasts de deploy
        const channel = supabase.channel('app_updates');

        channel
            .on('broadcast', { event: 'new_deploy' }, (payload) => {
                console.log('📡 Deploy detectado via broadcast:', payload);
                setUpdateAvailable(true);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [enableBroadcast]);

    const reloadApp = () => {
        if (availableVersion) {
            localStorage.setItem('app_version', availableVersion);
        } else {
            // Sem versão conhecida (broadcast apenas): força re-sync no próximo load.
            localStorage.removeItem('app_version');
        }
        window.location.reload();
    };

    return {
        updateAvailable,
        currentVersion,
        reloadApp
    };
}
