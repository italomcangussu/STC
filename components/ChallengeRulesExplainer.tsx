/**
 * Componente para explicar regras de desafio com tooltips
 *
 * Uso em Challenges.tsx:
 * <ChallengeRulesExplainer currentUser={currentUser} ranking={ranking} />
 */

import React from 'react';
import { Info, Users, Calendar, TrendingUp } from 'lucide-react';
import { InfoTooltip } from './ui/Tooltip';

interface ChallengeRulesExplainerProps {
  compact?: boolean;
}

export const ChallengeRulesExplainer: React.FC<ChallengeRulesExplainerProps> = ({
  compact = false,
}) => {
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm text-stone-600">
        <Info size={16} />
        <span>Regras de Desafio</span>
        <InfoTooltip
          content={
            <div className="space-y-2 text-left max-w-xs">
              <p><strong>Posição:</strong> Desafie até 3 posições acima/abaixo</p>
              <p><strong>Limite:</strong> 1 desafio/mês (como desafiante e desafiado)</p>
              <p><strong>Pontuação:</strong> Vitória = 100pts, SuperSet = 10pts</p>
            </div>
          }
          position="bottom"
        />
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-orange-50 to-yellow-50 border border-orange-200 rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2 text-saibro-800 font-bold text-lg">
        <Info size={20} />
        <span>Como Funcionam os Desafios</span>
      </div>

      <div className="grid gap-4">
        {/* Regra de Posição */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center flex-shrink-0">
            <TrendingUp size={20} className="text-saibro-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-stone-800">Regra de Posição</h4>
              <InfoTooltip
                content={
                  <div className="space-y-1">
                    <p>Você pode desafiar jogadores que estejam até <strong>3 posições</strong> de distância no Ranking Geral.</p>
                    <p className="text-xs mt-2">Exemplo: Se você está na posição 5, pode desafiar posições 2-8.</p>
                  </div>
                }
              />
            </div>
            <p className="text-sm text-stone-600">
              Desafie qualquer jogador até <span className="font-semibold text-saibro-700">3 posições</span> acima
              ou abaixo de você no ranking geral.
            </p>
          </div>
        </div>

        {/* Limite Mensal */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center flex-shrink-0">
            <Calendar size={20} className="text-saibro-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-stone-800">Limite Mensal</h4>
              <InfoTooltip
                content={
                  <div className="space-y-1">
                    <p>Cada jogador pode:</p>
                    <ul className="list-disc list-inside text-xs space-y-1 mt-1">
                      <li><strong>Desafiar 1 pessoa</strong> por mês</li>
                      <li><strong>Ser desafiado 1 vez</strong> por mês</li>
                    </ul>
                    <p className="text-xs mt-2">Isso garante que todos tenham oportunidades justas.</p>
                  </div>
                }
              />
            </div>
            <p className="text-sm text-stone-600">
              Máximo de <span className="font-semibold text-saibro-700">1 desafio enviado</span> e{' '}
              <span className="font-semibold text-saibro-700">1 desafio recebido</span> por mês.
            </p>
          </div>
        </div>

        {/* Pontuação */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center flex-shrink-0">
            <Users size={20} className="text-saibro-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-stone-800">Pontuação</h4>
              <InfoTooltip
                content={
                  <div className="space-y-1">
                    <p><strong>Desafio (Melhor de 3 sets):</strong></p>
                    <ul className="list-disc list-inside text-xs ml-2 mt-1">
                      <li>Vitória: 100 pontos</li>
                      <li>Derrota: 0 pontos</li>
                    </ul>
                    <p className="mt-2"><strong>SuperSet (1 set rápido):</strong></p>
                    <ul className="list-disc list-inside text-xs ml-2 mt-1">
                      <li>Vitória: 10 pontos</li>
                    </ul>
                  </div>
                }
              />
            </div>
            <div className="text-sm text-stone-600 space-y-1">
              <p>
                <span className="font-semibold text-green-700">Desafio:</span> 100 pontos para o vencedor
              </p>
              <p>
                <span className="font-semibold text-blue-700">SuperSet:</span> 10 pontos para o vencedor
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Call to Action */}
      <div className="mt-4 p-4 bg-white/60 rounded-xl border border-orange-100">
        <p className="text-xs text-stone-600 text-center">
          💡 <strong>Dica:</strong> Aceite desafios para subir no ranking mais rápido!
        </p>
      </div>
    </div>
  );
};

/**
 * Badge de status do jogador com tooltip explicativo
 */
interface PlayerChallengeStatusProps {
  canChallenge: boolean;
  canBeChallenged: boolean;
  challengesSent: number;
  challengesReceived: number;
}

export const PlayerChallengeStatus: React.FC<PlayerChallengeStatusProps> = ({
  canChallenge,
  canBeChallenged,
  challengesSent,
  challengesReceived,
}) => {
  return (
    <div className="flex items-center gap-2">
      {/* Status de Envio */}
      <div className="flex items-center gap-1">
        <span
          className={`w-2 h-2 rounded-full ${
            canChallenge ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <InfoTooltip
          content={
            canChallenge
              ? `Você pode desafiar ${1 - challengesSent} pessoa(s) este mês`
              : `Você já desafiou alguém este mês (${challengesSent}/1)`
          }
        >
          <span className="text-xs text-stone-600">
            {canChallenge ? 'Pode desafiar' : 'Limite atingido'}
          </span>
        </InfoTooltip>
      </div>

      <span className="text-stone-300">|</span>

      {/* Status de Recebimento */}
      <div className="flex items-center gap-1">
        <span
          className={`w-2 h-2 rounded-full ${
            canBeChallenged ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <InfoTooltip
          content={
            canBeChallenged
              ? 'Você pode ser desafiado este mês'
              : `Você já foi desafiado este mês (${challengesReceived}/1)`
          }
        >
          <span className="text-xs text-stone-600">
            {canBeChallenged ? 'Disponível' : 'Indisponível'}
          </span>
        </InfoTooltip>
      </div>
    </div>
  );
};
