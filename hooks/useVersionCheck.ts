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

    // Função para buscar versão do servidor
    const checkVersion = async () => {
        try {
            const response = await fetch('/version.json?' + Date.now()); // Cache bust
            const data = await response.json();
            const serverVersion = data.version;

            if (!currentVersion) {
                // Primeira vez, salvar versão atual
                setCurrentVersion(serverVersion);
                localStorage.setItem('app_version', serverVersion);
            } else if (serverVersion !== currentVersion) {
                // Nova versão detectada!
                console.log('🎉 Nova versão disponível:', serverVersion);
                setUpdateAvailable(true);
            }
        } catch (error) {
            console.error('Erro ao verificar versão:', error);
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
        window.location.reload();
    };

    return {
        updateAvailable,
        currentVersion,
        reloadApp
    };
}
