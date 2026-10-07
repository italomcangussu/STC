import React, { useState, useEffect } from 'react';
import { Bell, ShieldCheck } from 'lucide-react';
import { isPushSupported, getPermissionStatus, subscribeToPush } from '../../lib/pushNotifications';

interface AdminPushPermissionBannerProps {
  userId?: string;
  onSubscribed?: () => void;
  className?: string;
}

const DISMISSED_KEY = 'admin_push_banner_dismissed_until';

/**
 * Banner de permissão de notificações de acordo com as diretrizes do Apple Human Interface Guidelines (HIG).
 *
 * Características essenciais:
 * - Exibição automática não invasiva apenas quando o status é 'default' (usuário ainda não respondeu).
 * - Sem indução, sem padrões escuros (dark patterns), sem botões apelativos.
 * - Dois botões neutros: "Voltar" (dispensa temporária) e "Continuar" (aciona o diálogo oficial do navegador/sistema).
 * - Alvos de toque de no mínimo 44px (padrão iOS / HIG).
 */
export const AdminPushPermissionBanner: React.FC<AdminPushPermissionBannerProps> = ({
  userId,
  onSubscribed,
  className = '',
}) => {
  const [visivel, setVisivel] = useState(false);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    // 1. Verifica se a API de notificações é suportada
    if (!isPushSupported()) return;

    // 2. Só exibe de forma automática quando a permissão ainda NÃO foi respondida ('default')
    const status = getPermissionStatus();
    if (status !== 'default') return;

    // 3. Verifica se o usuário clicou em 'Voltar' recentemente (pausa de 24 horas para respeitar a atenção)
    try {
      const ate = localStorage.getItem(DISMISSED_KEY);
      if (ate && Number(ate) > Date.now()) return;
    } catch {
      // Storage não disponível
    }

    setVisivel(true);
  }, []);

  const handleVoltar = () => {
    setVisivel(false);
    try {
      // Guarda dispensa por 24 horas
      localStorage.setItem(DISMISSED_KEY, (Date.now() + 24 * 60 * 60 * 1000).toString());
    } catch {
      // ignore
    }
  };

  const handleContinuar = async () => {
    setCarregando(true);
    try {
      // Aciona o diálogo nativo do sistema operacional/navegador
      const sub = await subscribeToPush(userId);
      setVisivel(false);
      if (sub) {
        onSubscribed?.();
      }
    } catch (err) {
      console.error('[AdminPushBanner] Falha ao solicitar permissão:', err);
    } finally {
      setCarregando(false);
    }
  };

  if (!visivel) return null;

  return (
    <div
      role="region"
      aria-label="Aviso de notificações do sistema"
      className={`relative overflow-hidden rounded-2xl border border-stone-200/90 bg-stone-50/95 p-4 shadow-sm backdrop-blur-md transition-all sm:p-5 ${className}`}
    >
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        {/* Lado Esquerdo: Ícone + Explicação Transparente */}
        <div className="flex items-start gap-3.5">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-200/70 text-stone-700 shadow-inner"
            aria-hidden="true"
          >
            <Bell size={20} className="stroke-[2.2]" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-stone-900 sm:text-base">
                Notificações de Mensagens
              </h2>
              <span className="inline-flex items-center gap-1 rounded-md bg-stone-200/60 px-1.5 py-0.5 text-[10px] font-medium text-stone-600">
                <ShieldCheck size={11} aria-hidden="true" />
                Administração
              </span>
            </div>
            <p className="text-xs leading-relaxed text-stone-600 sm:text-sm">
              Receba avisos instantâneos quando sócios e atletas enviarem mensagens no WhatsApp do clube, inclusive com a aba fechada.
            </p>
          </div>
        </div>

        {/* Lado Direito: Botões Neutros (HIG: Voltar / Continuar) */}
        <div className="flex items-center gap-2.5 pt-1 sm:shrink-0 sm:pt-0">
          <button
            type="button"
            onClick={handleVoltar}
            disabled={carregando}
            className="inline-flex min-h-[44px] min-w-[80px] items-center justify-center rounded-xl border border-stone-300 bg-white px-4 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 hover:text-stone-900 active:scale-95 disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleContinuar}
            disabled={carregando}
            className="inline-flex min-h-[44px] min-w-[96px] items-center justify-center rounded-xl bg-stone-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-stone-800 active:scale-95 disabled:opacity-50"
          >
            {carregando ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              'Continuar'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminPushPermissionBanner;
