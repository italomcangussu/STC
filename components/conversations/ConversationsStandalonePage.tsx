import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Bot,
  ExternalLink,
  MessageCircle,
  MessagesSquare,
  Plug,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { getPermissionStatus, isPushSupported, subscribeToPush } from '../../lib/pushNotifications';
import AdminPushPermissionBanner from './AdminPushPermissionBanner';
import { Spinner } from './ui';

const InboxTab = lazy(() => import('./InboxTab'));
const AutomationsTab = lazy(() => import('./AutomationsTab'));
const AiTab = lazy(() => import('./AiTab'));
const ChannelTab = lazy(() => import('./ChannelTab'));

type StandaloneTab = 'inbox' | 'automations' | 'ai' | 'channel';

const TABS: { id: StandaloneTab; label: string; icon: typeof MessageCircle }[] = [
  { id: 'inbox', label: 'Mensagens', icon: MessageCircle },
  { id: 'automations', label: 'Automações', icon: Zap },
  { id: 'ai', label: 'Agente IA', icon: Bot },
  { id: 'channel', label: 'Canal', icon: Plug },
];

export const ConversationsStandalonePage: React.FC = () => {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<StandaloneTab>('inbox');
  const [pushStatus, setPushStatus] = useState<NotificationPermission>('default');
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    // Sincroniza status de notificações
    if (isPushSupported()) {
      setPushStatus(getPermissionStatus());
    }
  }, []);

  const handleTogglePush = async () => {
    if (!isPushSupported()) return;
    if (pushStatus === 'granted') return;

    setPushLoading(true);
    try {
      const res = await subscribeToPush(currentUser?.id);
      if (res) {
        setPushStatus('granted');
      }
    } catch (err) {
      console.error('[ConversationsStandalonePage] Erro ao ativar push:', err);
    } finally {
      setPushLoading(false);
    }
  };

  const handleVoltarAoApp = () => {
    // Se a aba foi aberta via window.open, tenta fechar; senão navega para a home
    if (window.opener && window.history.length <= 1) {
      window.close();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-stone-100 antialiased select-none">
      {/* ----------------- Top Header Estilo Mensageiro Nativo Desktop/Mobile ----------------- */}
      <header
        role="banner"
        className="z-30 flex shrink-0 items-center justify-between border-b border-stone-200/90 bg-white/95 px-3 py-2 shadow-xs backdrop-blur-md md:px-4 md:py-2.5"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
      >
        {/* Identificação Esquerda */}
        <div className="flex items-center gap-2.5 md:gap-3">
          <button
            type="button"
            onClick={handleVoltarAoApp}
            title="Voltar ao STC Play"
            aria-label="Voltar ao STC Play"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-stone-50 text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 active:scale-95"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-500/20">
              <MessagesSquare size={19} />
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight text-stone-900 md:text-base">
                  Conversas
                </span>
                <span className="hidden items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 sm:inline-flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  WhatsApp
                </span>
              </div>
              <span className="block text-[11px] font-medium text-stone-500">
                STC Play Admin
              </span>
            </div>
          </div>
        </div>

        {/* Abas Centrais: Mensagens, Automações, IA, Canal */}
        <nav
          role="tablist"
          aria-label="Seções de Conversas"
          className="flex items-center gap-1 rounded-2xl bg-stone-100/90 p-1"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={isSelected}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex min-h-[36px] items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold transition-all active:scale-95 sm:px-3 ${
                  isSelected
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="hidden min-[480px]:inline">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Ações da Direita: Notificações Push + Retorno */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Botão de Notificações Push */}
          {isPushSupported() && (
            <button
              type="button"
              onClick={handleTogglePush}
              disabled={pushLoading || pushStatus === 'granted'}
              title={
                pushStatus === 'granted'
                  ? 'Notificações push ativas neste dispositivo'
                  : 'Ativar notificações push para administradores'
              }
              aria-label={
                pushStatus === 'granted'
                  ? 'Notificações ativas'
                  : 'Ativar notificações'
              }
              className={`flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition active:scale-95 ${
                pushStatus === 'granted'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              <Bell size={15} className={pushStatus === 'granted' ? 'fill-emerald-600 text-emerald-600' : ''} />
              <span className="hidden lg:inline">
                {pushStatus === 'granted' ? 'Notificações Ativas' : 'Ativar Push'}
              </span>
            </button>
          )}

          {/* Link para Painel Completo do Clube */}
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir o STC Play em outra janela"
            className="hidden h-9 items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 sm:flex"
          >
            <span>Clube</span>
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </header>

      {/* ----------------- Banner de Consentimento de Push (Apple HIG) ----------------- */}
      <AdminPushPermissionBanner
        userId={currentUser?.id}
        onSubscribed={() => setPushStatus('granted')}
        className="mx-3 mt-2 md:mx-4"
      />

      {/* ----------------- Área Principal Fullscreen ----------------- */}
      <main className="relative flex flex-1 min-h-0 w-full overflow-hidden">
        <Suspense
          fallback={
            <div className="grid flex-1 place-items-center">
              <Spinner />
            </div>
          }
        >
          {activeTab === 'inbox' && (
            <div className="h-full w-full">
              <InboxTab currentUserId={currentUser?.id || ''} standalone={true} />
            </div>
          )}

          {activeTab === 'automations' && (
            <div className="h-full w-full overflow-y-auto p-4 md:p-6">
              <div className="mx-auto max-w-5xl space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-stone-800">Automações do Clube</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('inbox')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-saibro-600 hover:underline"
                  >
                    <ArrowLeft size={14} /> Voltar para o Chat
                  </button>
                </div>
                <AutomationsTab />
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="h-full w-full overflow-y-auto p-4 md:p-6">
              <div className="mx-auto max-w-5xl space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-stone-800">Agente de IA</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('inbox')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-saibro-600 hover:underline"
                  >
                    <ArrowLeft size={14} /> Voltar para o Chat
                  </button>
                </div>
                <AiTab />
              </div>
            </div>
          )}

          {activeTab === 'channel' && (
            <div className="h-full w-full overflow-y-auto p-4 md:p-6">
              <div className="mx-auto max-w-5xl space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-stone-800">Canal e Conexão do WhatsApp</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('inbox')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-saibro-600 hover:underline"
                  >
                    <ArrowLeft size={14} /> Voltar para o Chat
                  </button>
                </div>
                <ChannelTab />
              </div>
            </div>
          )}
        </Suspense>
      </main>
    </div>
  );
};

export default ConversationsStandalonePage;
