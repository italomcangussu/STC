/* eslint-disable react-refresh/only-export-components -- helpers puros exportados junto do componente (padrão do módulo financeiro) */
/**
 * Conversas (administrador): UM módulo com a caixa de atendimento, as automações, o agente de IA e o
 * canal do WhatsApp. As três capacidades usam o MESMO histórico de mensagens e a MESMA conexão.
 *
 * Quem pode: o administrador (`is_admin()`), garantido no BANCO e nas funções de borda — esconder o
 * botão não é a proteção; as RPCs e as funções recusam qualquer outro papel.
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Bot, MessageCircle, MessagesSquare, Plug, Zap } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAdminEmbedded } from '../admin/AdminEmbedContext';
import { SectionTabs, Spinner } from './ui';

const InboxTab = lazy(() => import('./InboxTab'));
const AutomationsTab = lazy(() => import('./AutomationsTab'));
const AiTab = lazy(() => import('./AiTab'));
const ChannelTab = lazy(() => import('./ChannelTab'));

export const CONVERSATION_TABS = [
  ['inbox', 'Conversas', MessageCircle],
  ['automations', 'Automações', Zap],
  ['ai', 'IA', Bot],
  ['channel', 'Canal', Plug],
] as const;

const KEY = 'conversations-hub-tab';
const ALL: string[] = CONVERSATION_TABS.map((t) => t[0]);

const loadTab = (): string => {
  try { const v = localStorage.getItem(KEY); if (v && ALL.includes(v)) return v; } catch { /* storage indisponível */ }
  return 'inbox';
};

export const ConversationsHub: React.FC<{ currentUserId?: string }> = ({ currentUserId }) => {
  const embedded = useAdminEmbedded();
  const [tab, setTab] = useState(loadTab);
  const [me, setMe] = useState(currentUserId ?? '');

  useEffect(() => {
    if (currentUserId) return;
    let vivo = true;
    supabase.auth.getUser().then(({ data }) => { if (vivo) setMe(data.user?.id ?? ''); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [currentUserId]);

  const go = (id: string) => {
    if (!ALL.includes(id)) return;
    setTab(id);
    try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  };

  const body = (() => {
    switch (tab) {
      case 'automations': return <AutomationsTab />;
      case 'ai': return <AiTab />;
      case 'channel': return <ChannelTab />;
      default: return <InboxTab currentUserId={me} />;
    }
  })();

  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-linear-to-br from-emerald-500 to-emerald-600 p-3 text-white shadow-lg shadow-emerald-200"><MessagesSquare size={24} /></div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-stone-800 md:text-2xl">Conversas e WhatsApp</h1>
            <p className="text-xs font-medium text-stone-500">Atendimento, automações e IA no mesmo número do clube</p>
          </div>
        </div>
      )}
      <SectionTabs variant="segmented" label="Áreas de Conversas" value={tab} onChange={go} items={CONVERSATION_TABS.map((t) => ({ id: t[0], label: t[1] }))} />
      <Suspense fallback={<Spinner />}>{body}</Suspense>
    </div>
  );
};

export default ConversationsHub;
