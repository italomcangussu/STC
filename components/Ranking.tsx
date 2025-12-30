import React, { useState, useEffect } from 'react';
import { Trophy, Filter, Info, Crown, Loader2, ChevronRight, Award, Target, Zap } from 'lucide-react';
import { fetchRanking, fetchRankingByCategory, PlayerStats, CLASS_ORDER } from '../lib/rankingService';

interface RankingProps {
  onSelectProfile: (userId: string) => void;
}

// Reusable Stats Display Component
const StatsGrid: React.FC<{ player: PlayerStats; compact?: boolean }> = ({ player, compact = false }) => {
  const totalMatches = player.legacyMatchesPlayed + player.challengeMatchesPlayed;
  const winRate = totalMatches > 0 ? Math.round((player.totalWins / totalMatches) * 100) : 0;

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-xs text-stone-500">
        <div className="flex flex-col items-center">
          <span className="font-bold text-stone-700">{player.totalWins}</span>
          <span className="text-[9px] uppercase">Vit</span>
        </div>
        <div className="w-px h-6 bg-stone-100" />
        <div className="flex flex-col items-center">
          <span className="font-bold text-stone-700">{player.totalSetsWon}</span>
          <span className="text-[9px] uppercase">Sets</span>
        </div>
        <div className="w-px h-6 bg-stone-100" />
        <div className="flex flex-col items-center">
          <span className="font-bold text-stone-700">{player.totalGamesWon}</span>
          <span className="text-[9px] uppercase">Games</span>
        </div>
        <div className="w-px h-6 bg-stone-100" />
        <div className="flex flex-col items-center">
          <span className={`font-bold ${winRate >= 50 ? 'text-green-600' : 'text-stone-500'}`}>{winRate}%</span>
          <span className="text-[9px] uppercase">Aprv</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2 text-xs">
      <div className="bg-stone-50 rounded-lg p-2 text-center">
        <div className="font-bold text-stone-800">{player.totalWins}/{player.totalLosses}</div>
        <div className="text-[9px] text-stone-400 uppercase">V/D</div>
      </div>
      <div className="bg-stone-50 rounded-lg p-2 text-center">
        <div className="font-bold text-stone-800">{player.totalSetsWon}/{player.totalSetsLost}</div>
        <div className="text-[9px] text-stone-400 uppercase">Sets</div>
      </div>
      <div className="bg-stone-50 rounded-lg p-2 text-center">
        <div className="font-bold text-stone-800">{player.totalGamesWon}</div>
        <div className="text-[9px] text-stone-400 uppercase">Games</div>
      </div>
      <div className="bg-stone-50 rounded-lg p-2 text-center">
        <div className={`font-bold ${winRate >= 50 ? 'text-green-600' : 'text-stone-600'}`}>{winRate}%</div>
        <div className="text-[9px] text-stone-400 uppercase">Taxa</div>
      </div>
    </div>
  );
};

// Player Card Component
const PlayerCard: React.FC<{
  player: PlayerStats;
  rank: number;
  showCategory?: boolean;
  onClick: () => void;
}> = ({ player, rank, showCategory = false, onClick }) => {
  const isTop3 = rank <= 3;

  return (
    <div
      onClick={onClick}
      className={`relative bg-white rounded-xl shadow-sm border p-4 flex items-center gap-4 transition-transform active:scale-[0.99] cursor-pointer group hover:border-saibro-400 ${isTop3 ? 'border-saibro-300 shadow-md' : 'border-stone-100'}`}
    >
      {/* Rank Badge */}
      <div className={`flex flex-col items-center justify-center w-10 shrink-0 ${isTop3 ? 'text-saibro-600' : 'text-stone-400'}`}>
        {rank === 1 && <Crown size={20} className="fill-yellow-400 text-yellow-600 mb-0.5" />}
        {rank === 2 && <Award size={18} className="text-stone-400 mb-0.5" />}
        {rank === 3 && <Award size={16} className="text-amber-600 mb-0.5" />}
        <span className={`text-lg font-bold ${rank === 1 ? 'text-2xl' : ''}`}>#{rank}</span>
      </div>

      {/* User Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {player.avatarUrl ? (
            <img src={player.avatarUrl} className="w-8 h-8 rounded-full bg-stone-200 object-cover border-2 border-transparent group-hover:border-saibro-200 transition-colors" alt="" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-saibro-200 to-saibro-400 flex items-center justify-center text-white font-bold text-sm">
              {player.name.charAt(0)}
            </div>
          )}
          <div>
            <h3 className="font-bold text-stone-800 leading-tight truncate group-hover:text-saibro-700 transition-colors">{player.name}</h3>
            {showCategory && player.category && (
              <span className="text-[10px] uppercase font-bold text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">{player.category}</span>
            )}
          </div>
        </div>
        <StatsGrid player={player} compact />
      </div>

      {/* Total Points */}
      <div className="flex flex-col items-end shrink-0">
        <span className="text-2xl font-black text-saibro-600 tracking-tight">{player.totalPoints}</span>
        <span className="text-[10px] uppercase font-bold text-saibro-400">Pontos</span>
      </div>

      <ChevronRight size={16} className="text-stone-300 group-hover:text-saibro-500 transition-colors" />
    </div>
  );
};

export const Ranking: React.FC<RankingProps> = ({ onSelectProfile }) => {
  const [activeTab, setActiveTab] = useState<string>('4ª Classe');
  const [loading, setLoading] = useState(true);
  const [rankingByCategory, setRankingByCategory] = useState<Record<string, PlayerStats[]>>({});
  const [allPlayers, setAllPlayers] = useState<PlayerStats[]>([]);

  // Available tabs: categories + Geral
  const tabs = [...CLASS_ORDER, 'Geral'];

  // Fetch ranking on mount
  useEffect(() => {
    const loadRanking = async () => {
      setLoading(true);
      try {
        const [byCategory, all] = await Promise.all([
          fetchRankingByCategory(),
          fetchRanking()
        ]);
        setRankingByCategory(byCategory);
        setAllPlayers(all);
      } catch (err) {
        console.error('Error loading ranking:', err);
      } finally {
        setLoading(false);
      }
    };
    loadRanking();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-saibro-600" size={48} />
      </div>
    );
  }

  // Get players for current tab
  const displayPlayers = activeTab === 'Geral'
    ? allPlayers
    : (rankingByCategory[activeTab] || []);

  return (
    <div className="p-4 pb-24 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-saibro-900">Ranking</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-stone-100 p-1 rounded-xl overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 min-w-[80px] py-2 px-3 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${activeTab === tab
                ? 'bg-white text-saibro-700 shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
              }`}
          >
            {tab === 'Geral' ? '🏆 Geral' : tab.replace(' Classe', 'ª')}
          </button>
        ))}
      </div>

      {/* Info Box */}
      <div className="bg-saibro-50 border border-saibro-100 rounded-lg p-3 flex items-start gap-3 text-xs text-stone-600">
        <Info size={16} className="text-saibro-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-saibro-700 block mb-1">
            {activeTab === 'Geral' ? 'Ranking Geral' : `Ranking ${activeTab}`}
          </span>
          {activeTab === 'Geral' ? (
            <>Ordenado por classe (4ª → 5ª → 6ª), depois por pontos. O 1º da classe pode desafiar os últimos 2 da classe acima.</>
          ) : (
            <>Vitória: <span className="font-bold">+100</span> • Set: <span className="font-bold">+10</span> • Game: <span className="font-bold">+1</span></>
          )}
        </div>
      </div>

      {/* Ranking List */}
      <div className="space-y-3">
        {activeTab === 'Geral' ? (
          // Geral view: show players grouped by class with visual separators
          <>
            {CLASS_ORDER.map(category => {
              const categoryPlayers = allPlayers.filter(p => p.category === category);
              if (categoryPlayers.length === 0) return null;

              return (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-2 mt-4">
                    <div className="flex items-center gap-1 bg-saibro-100 text-saibro-700 px-3 py-1 rounded-full">
                      <Target size={14} />
                      <span className="text-xs font-bold">{category}</span>
                    </div>
                    <div className="flex-1 h-px bg-stone-200" />
                  </div>
                  <div className="space-y-2">
                    {categoryPlayers.map(player => (
                      <PlayerCard
                        key={player.id}
                        player={player}
                        rank={player.categoryPosition}
                        onClick={() => onSelectProfile(player.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          // Category view: simple list
          displayPlayers.map(player => (
            <PlayerCard
              key={player.id}
              player={player}
              rank={player.categoryPosition}
              onClick={() => onSelectProfile(player.id)}
            />
          ))
        )}

        {displayPlayers.length === 0 && (
          <div className="text-center py-12 text-stone-400">
            <Trophy size={48} className="mx-auto mb-3 opacity-50" />
            <p>Nenhum atleta nesta categoria.</p>
          </div>
        )}
      </div>
    </div>
  );
};