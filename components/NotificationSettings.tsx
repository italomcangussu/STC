/**
 * Configurações de Notificações Push Customizáveis
 *
 * Permite usuário escolher quais tipos de notificações deseja receber
 */

import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Check, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { User } from '../types';
import { logger } from '../lib/logger';
import { notify } from '../lib/notifications';
import { LoadingButton } from './ui/LoadingStates';

interface NotificationPreferences {
  challengeReceived: boolean;
  challengeAccepted: boolean;
  matchReminder: boolean;
  reservationConfirmed: boolean;
  championshipUpdate: boolean;
  rankingChange: boolean;
  systemAnnouncements: boolean;
}

interface NotificationSettingsProps {
  currentUser: User;
}

export const NotificationSettings: React.FC<NotificationSettingsProps> = ({
  currentUser,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  const [preferences, setPreferences] = useState<NotificationPreferences>({
    challengeReceived: true,
    challengeAccepted: true,
    matchReminder: true,
    reservationConfirmed: true,
    championshipUpdate: true,
    rankingChange: false,
    systemAnnouncements: true,
  });

  useEffect(() => {
    loadPreferences();
    checkPushPermission();
  }, [currentUser.id]);

  const checkPushPermission = () => {
    if ('Notification' in window) {
      setPushEnabled(Notification.permission === 'granted');
    }
  };

  const loadPreferences = async () => {
    try {
      setLoading(true);

      // Carregar preferências salvas (pode ser uma nova tabela ou JSON no perfil)
      const savedPrefs = localStorage.getItem(`notification-prefs-${currentUser.id}`);

      if (savedPrefs) {
        setPreferences(JSON.parse(savedPrefs));
      }

      logger.debug('notification_preferences_loaded', { userId: currentUser.id });
    } catch (error: any) {
      logger.error('load_notification_preferences_failed', { error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    try {
      setSaving(true);

      // Salvar no localStorage (ou enviar para Supabase)
      localStorage.setItem(
        `notification-prefs-${currentUser.id}`,
        JSON.stringify(preferences)
      );

      // Opcionalmente, salvar no Supabase
      // await supabase.from('user_preferences').upsert({
      //   user_id: currentUser.id,
      //   notification_settings: preferences
      // });

      logger.info('notification_preferences_saved', {
        userId: currentUser.id,
        preferences,
      });

      notify.success('Preferências salvas com sucesso!');
    } catch (error: any) {
      logger.error('save_notification_preferences_failed', {
        userId: currentUser.id,
        error: error.message,
      });
      notify.error('Erro ao salvar preferências');
    } finally {
      setSaving(false);
    }
  };

  const requestPushPermission = async () => {
    try {
      if (!('Notification' in window)) {
        notify.error('Notificações não suportadas neste navegador');
        return;
      }

      const permission = await Notification.requestPermission();

      if (permission === 'granted') {
        setPushEnabled(true);
        notify.success('Notificações ativadas!');
        logger.info('push_permission_granted', { userId: currentUser.id });
      } else {
        notify.warning('Permissão negada', {
          description: 'Você pode ativar nas configurações do navegador',
        });
        logger.warn('push_permission_denied', { userId: currentUser.id });
      }
    } catch (error: any) {
      logger.error('request_push_permission_failed', { error: error.message });
      notify.error('Erro ao solicitar permissão');
    }
  };

  const togglePreference = (key: keyof NotificationPreferences) => {
    setPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const notificationOptions: Array<{
    key: keyof NotificationPreferences;
    label: string;
    description: string;
    icon: string;
  }> = [
    {
      key: 'challengeReceived',
      label: 'Desafio Recebido',
      description: 'Quando alguém te desafiar',
      icon: '🎯',
    },
    {
      key: 'challengeAccepted',
      label: 'Desafio Aceito',
      description: 'Quando seu desafio for aceito',
      icon: '✅',
    },
    {
      key: 'matchReminder',
      label: 'Lembrete de Partida',
      description: '1 hora antes da partida agendada',
      icon: '⏰',
    },
    {
      key: 'reservationConfirmed',
      label: 'Reserva Confirmada',
      description: 'Quando sua reserva for criada',
      icon: '📅',
    },
    {
      key: 'championshipUpdate',
      label: 'Atualizações de Campeonato',
      description: 'Novos jogos, resultados e classificação',
      icon: '🏆',
    },
    {
      key: 'rankingChange',
      label: 'Mudanças no Ranking',
      description: 'Quando sua posição mudar',
      icon: '📊',
    },
    {
      key: 'systemAnnouncements',
      label: 'Anúncios do Sistema',
      description: 'Novidades e comunicados importantes',
      icon: '📢',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-blue-100 rounded-xl">
          <Bell size={24} className="text-blue-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-stone-800">Notificações</h2>
          <p className="text-stone-600 text-sm">Personalize suas preferências</p>
        </div>
      </div>

      {/* Push Permission */}
      <div
        className={`rounded-2xl p-6 border-2 ${
          pushEnabled
            ? 'bg-green-50 border-green-200'
            : 'bg-orange-50 border-orange-200'
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            {pushEnabled ? (
              <Bell size={24} className="text-green-600 mt-1" />
            ) : (
              <BellOff size={24} className="text-orange-600 mt-1" />
            )}
            <div>
              <h3 className="font-semibold text-stone-800 mb-1">
                Notificações Push
              </h3>
              <p className="text-sm text-stone-600">
                {pushEnabled
                  ? 'Você receberá notificações no navegador'
                  : 'Ative para receber notificações no navegador'}
              </p>
            </div>
          </div>
          {!pushEnabled && (
            <button
              onClick={requestPushPermission}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors"
            >
              Ativar
            </button>
          )}
        </div>
      </div>

      {/* Notification Options */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Settings size={20} className="text-stone-600" />
          <h3 className="font-semibold text-stone-800">Tipos de Notificação</h3>
        </div>

        <div className="space-y-3">
          {notificationOptions.map((option) => (
            <div
              key={option.key}
              className="flex items-center justify-between p-4 bg-stone-50 rounded-xl hover:bg-stone-100 transition-colors"
            >
              <div className="flex items-start gap-3 flex-1">
                <span className="text-2xl">{option.icon}</span>
                <div>
                  <div className="font-medium text-stone-800">{option.label}</div>
                  <div className="text-sm text-stone-600">{option.description}</div>
                </div>
              </div>
              <button
                onClick={() => togglePreference(option.key)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  preferences[option.key] ? 'bg-green-500' : 'bg-stone-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    preferences[option.key] ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <LoadingButton
          loading={saving}
          onClick={savePreferences}
          className="px-6 py-3 bg-saibro-600 hover:bg-saibro-700 text-white font-semibold rounded-xl shadow-lg transition-colors flex items-center gap-2"
        >
          <Check size={18} />
          Salvar Preferências
        </LoadingButton>
      </div>

      {/* Info Footer */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm text-blue-800">
          💡 <strong>Dica:</strong> Você pode desativar notificações específicas a qualquer
          momento. As configurações são salvas automaticamente.
        </p>
      </div>
    </div>
  );
};
