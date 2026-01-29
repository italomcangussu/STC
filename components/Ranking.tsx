import React, { useState, useEffect } from 'react';
import { Trophy, Filter, Info, Crown, Loader2, ChevronRight, Award, Target, Zap } from 'lucide-react';
import { fetchRanking, fetchRankingByCategory, PlayerStats, CLASS_ORDER } from '../lib/rankingService';

interface RankingProps {
  onSelectProfile: (userId: string) => void;
}



// Player Card Component
const PlayerCard: React.FC<{
  player: PlayerStats;
  rank: number;
  showCategory?: boolean;
  showPoints?: boolean;
  onClick: () => void;
}> = ({ player, rank, showCategory = false, showPoints = true, onClick }) => {
  const isTop3 = rank <= 3;

  // Dynamic Styles based on Rank
  let cardStyle = "bg-gradient-to-r from-white to-stone-50/50 border-stone-300 hover:border-saibro-300";
  let rankColor = "text-stone-400";
  let pointColor = "text-saibro-600";
  let avatarBorder = "border-transparent";

  if (rank === 1) {
    cardStyle = "bg-gradient-to-r from-yellow-50/80 to-amber-50/50 border-yellow-400 hover:border-yellow-500 shadow-yellow-100 animate-shimmer";
    rankColor = "text-yellow-600";
    pointColor = "text-yellow-700";
    avatarBorder = "border-yellow-200";
  } else if (rank === 2) {
    cardStyle = "bg-gradient-to-r from-stone-100/80 to-stone-50/50 border-stone-400 hover:border-stone-500 shadow-stone-200";
    rankColor = "text-stone-500";
    pointColor = "text-stone-600";
    avatarBorder = "border-stone-300";
  } else if (rank === 3) {
    cardStyle = "bg-gradient-to-r from-orange-50/80 to-orange-50/30 border-orange-400 hover:border-orange-500 shadow-orange-100";
    rankColor = "text-orange-600";
    pointColor = "text-orange-700";
    avatarBorder = "border-orange-200";
  }

  return (
    <div
      onClick={onClick}
      className={`relative rounded-2xl border-l-[6px] shadow-sm p-3 sm:p-4 flex items-center gap-3 sm:gap-4 transition-all duration-300 active:scale-[0.99] cursor-pointer group hover:shadow-xl ${cardStyle}`}
    >
      {/* Rank & Avatar */}
      <div className="flex items-center gap-3 shrink-0 relative">
        <div className={`flex flex-col items-center justify-center w-8 sm:w-10 ${rankColor}`}>
          {rank <= 3 ? <Crown size={rank === 1 ? 24 : 20} className="fill-current mb-[-4px]" /> : <span className="font-bold text-stone-300 font-mono text-xs">#</span>}
          <span className={`font-black ${rank === 1 ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'} leading-none tracking-tighter`}>{rank}</span>
        </div>

        <div className="relative">
          {player.avatarUrl ? (
            <img src={player.avatarUrl} className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-stone-100 object-cover border-2 shadow-sm ${avatarBorder}`} alt="" />
          ) : (
            <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 font-bold border-2 ${avatarBorder}`}>
              {player.name.charAt(0)}
            </div>
          )}
          {showCategory && player.category && (
            <div className="absolute -bottom-1 -right-1 bg-stone-800 text-white text-[9px] font-bold px-1.5 py-0.5 rounded border border-white shadow-sm">
              {player.category}
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <h3 className={`font-black text-stone-800 leading-tight truncate text-sm sm:text-base mb-1 group-hover:text-saibro-700 transition-colors`}>{player.name}</h3>

        {/* Compact Stats Grid inline */}
        <div className="flex items-center gap-2 sm:gap-3 opacity-90">
          <div className="flex flex-col leading-none">
            <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider scale-90 origin-left">Vit</span>
            <span className="font-bold text-stone-600 text-xs sm:text-sm">{player.totalWins}</span>
          </div>
          <div className="w-px h-5 bg-black/5" />
          <div className="flex flex-col leading-none">
            <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider scale-90 origin-left">Jgs</span>
            <span className="font-bold text-stone-600 text-xs sm:text-sm">{player.legacyMatchesPlayed + player.challengeMatchesPlayed}</span>
          </div>
          <div className="w-px h-5 bg-black/5" />
          <div className="flex flex-col leading-none">
            <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider scale-90 origin-left">Aprv</span>
            <span className={`font-bold text-xs sm:text-sm ${(player.totalWins / (player.legacyMatchesPlayed + player.challengeMatchesPlayed || 1)) >= 0.5 ? 'text-green-600' : 'text-stone-500'}`}>
              {Math.round((player.totalWins / (player.legacyMatchesPlayed + player.challengeMatchesPlayed || 1)) * 100)}%
            </span>
          </div>
        </div>
      </div>

      {/* Points - conditionally shown */}
      {showPoints && (
        <div className="flex flex-col items-end justify-center pl-2 border-l border-black/5">
          <span className={`text-2xl sm:text-4xl font-black ${pointColor} leading-none tracking-tighter`}>{player.totalPoints}</span>
          <span className={`text-[8px] sm:text-[10px] font-bold uppercase tracking-widest ${rankColor}`}>Pontos</span>
        </div>
      )}

      <ChevronRight size={16} className="text-black/10 group-hover:text-saibro-400 transition-colors active:translate-x-1" />
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
    <div className="p-4 pb-40 space-y-4">
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
          // Geral view: show players with unified sequential ranking
          <>
            {(() => {
              let globalPosition = 0;
              return CLASS_ORDER.map(category => {
                const categoryPlayers = allPlayers.filter(p => p.category === category);
                if (categoryPlayers.length === 0) return null;

                return (
                  <div key={category} className="animate-fade-in">
                    <div className="flex items-center gap-2 mb-2 mt-4">
                      <div className="flex items-center gap-1 bg-saibro-100 text-saibro-700 px-3 py-1 rounded-full">
                        <Target size={14} />
                        <span className="text-xs font-bold">{category}</span>
                      </div>
                      <div className="flex-1 h-px bg-stone-200" />
                    </div>
                    <div className="space-y-2">
                      {categoryPlayers.map((player, idx) => {
                        globalPosition++;
                        return (
                          <div key={player.id} className="animate-slide-in opacity-0" style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'forwards' }}>
                            <PlayerCard
                              player={player}
                              rank={globalPosition}
                              showPoints={false}
                              showCategory={false}
                              onClick={() => onSelectProfile(player.id)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </>
        ) : (
          // Category view: simple list
          displayPlayers.map((player, idx) => (
            <div key={player.id} className="animate-slide-in opacity-0" style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'forwards' }}>
              <PlayerCard
                player={player}
                rank={player.categoryPosition}
                onClick={() => onSelectProfile(player.id)}
              />
            </div>
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