import React from 'react';
import { RefreshCw } from 'lucide-react';

interface UpdateNotificationProps {
  onUpdate: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({ onUpdate }) => {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-9999 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl shadow-stone-400/50 border-2 border-stone-100 animate-in zoom-in duration-200">
        {/* Header */}
        <div className="bg-linear-to-br from-saibro-600 via-saibro-500 to-orange-500 px-6 py-4 -mx-6 -mt-6 mb-6 rounded-t-3xl shadow-xl shadow-saibro-300/30 border-b-2 border-white/10">
          <div className="flex items-center gap-3">
            <RefreshCw size={24} className="text-white animate-spin" strokeWidth={3} />
            <h3 className="text-xl font-black uppercase tracking-tight text-white drop-shadow-lg">
              🎉 Nova Versão Disponível
            </h3>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-5">
          <div className="bg-linear-to-br from-saibro-50 to-orange-50 p-4 rounded-xl border-2 border-saibro-200 shadow-lg shadow-saibro-100">
            <p className="text-sm font-bold text-saibro-800">
              ✨ Uma nova versão do STC está disponível com melhorias e correções!
            </p>
          </div>

          <div className="bg-linear-to-br from-stone-50 to-stone-100 p-4 rounded-xl border-2 border-stone-200">
            <p className="text-xs font-bold text-stone-600">
              💡 <strong>Recomendado:</strong> Atualize agora para garantir a melhor experiência e evitar problemas.
            </p>
          </div>

          {/* Action Button */}
          <button
            onClick={onUpdate}
            className="w-full py-4 bg-linear-to-br from-saibro-600 to-saibro-700 text-white font-black text-sm uppercase tracking-tight rounded-xl shadow-lg shadow-saibro-200 hover:shadow-xl hover:scale-105 transition-all duration-200 flex items-center justify-center gap-2"
          >
            <RefreshCw size={18} strokeWidth={3} />
            Atualizar Agora
          </button>
        </div>
      </div>
    </div>
  );
};
