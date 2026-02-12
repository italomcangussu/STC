/**
 * Filtros Avançados para Agenda
 *
 * Features:
 * - Filtro por tipo de reserva
 * - Filtro por quadra
 * - Filtro por data range
 * - Filtro por participante
 * - Search por nome
 */

import React, { useState } from 'react';
import { Filter, X, Search, Calendar, MapPin, Users, Grid } from 'lucide-react';
import { ReservationType, Court, User } from '../types';

export interface AgendaFilterOptions {
  types: ReservationType[];
  courtIds: string[];
  dateRange: { start: string; end: string } | null;
  participantId: string | null;
  searchQuery: string;
}

interface AgendaFiltersProps {
  courts: Court[];
  profiles: User[];
  filters: AgendaFilterOptions;
  onFilterChange: (filters: AgendaFilterOptions) => void;
}

export const AgendaFilters: React.FC<AgendaFiltersProps> = ({
  courts,
  profiles,
  filters,
  onFilterChange,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleType = (type: ReservationType) => {
    const newTypes = filters.types.includes(type)
      ? filters.types.filter((t) => t !== type)
      : [...filters.types, type];

    onFilterChange({ ...filters, types: newTypes });
  };

  const toggleCourt = (courtId: string) => {
    const newCourts = filters.courtIds.includes(courtId)
      ? filters.courtIds.filter((c) => c !== courtId)
      : [...filters.courtIds, courtId];

    onFilterChange({ ...filters, courtIds: newCourts });
  };

  const clearAllFilters = () => {
    onFilterChange({
      types: [],
      courtIds: [],
      dateRange: null,
      participantId: null,
      searchQuery: '',
    });
  };

  const activeFilterCount =
    filters.types.length +
    filters.courtIds.length +
    (filters.dateRange ? 1 : 0) +
    (filters.participantId ? 1 : 0) +
    (filters.searchQuery ? 1 : 0);

  return (
    <div className="space-y-3">
      {/* Filter Toggle Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors"
        >
          <Filter size={18} />
          <span className="font-medium">Filtros</span>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 bg-saibro-100 text-saibro-700 text-xs font-bold rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 px-3 py-2 text-sm text-stone-600 hover:text-stone-800 transition-colors"
          >
            <X size={16} />
            Limpar filtros
          </button>
        )}

        {/* Quick Search */}
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Buscar por nome..."
              value={filters.searchQuery}
              onChange={(e) =>
                onFilterChange({ ...filters, searchQuery: e.target.value })
              }
              className="w-full pl-10 pr-4 py-2 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-500 focus:border-transparent outline-none"
            />
          </div>
        </div>
      </div>

      {/* Expanded Filters */}
      {isExpanded && (
        <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-6 animate-in slide-in-from-top duration-300">
          {/* Type Filters */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Grid size={18} className="text-stone-600" />
              <h3 className="font-semibold text-stone-800">Tipo de Reserva</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['Play', 'Aula', 'Campeonato', 'Desafio'] as ReservationType[]).map(
                (type) => {
                  const isActive = filters.types.includes(type);
                  const styles = {
                    Play: 'bg-green-100 text-green-700 border-green-300',
                    Aula: 'bg-orange-100 text-orange-700 border-orange-300',
                    Campeonato: 'bg-yellow-100 text-yellow-700 border-yellow-300',
                    Desafio: 'bg-indigo-100 text-indigo-700 border-indigo-300',
                  };

                  return (
                    <button
                      key={type}
                      onClick={() => toggleType(type)}
                      className={`px-4 py-2 rounded-lg border-2 font-medium transition-all ${
                        isActive
                          ? styles[type]
                          : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      {type}
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* Court Filters */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={18} className="text-stone-600" />
              <h3 className="font-semibold text-stone-800">Quadras</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {courts.map((court) => {
                const isActive = filters.courtIds.includes(court.id);
                return (
                  <button
                    key={court.id}
                    onClick={() => toggleCourt(court.id)}
                    className={`px-4 py-2 rounded-lg border-2 font-medium transition-all ${
                      isActive
                        ? 'bg-saibro-100 text-saibro-700 border-saibro-300'
                        : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    {court.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date Range */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={18} className="text-stone-600" />
              <h3 className="font-semibold text-stone-800">Período</h3>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={filters.dateRange?.start || ''}
                onChange={(e) =>
                  onFilterChange({
                    ...filters,
                    dateRange: {
                      start: e.target.value,
                      end: filters.dateRange?.end || e.target.value,
                    },
                  })
                }
                className="px-3 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-saibro-500 outline-none"
              />
              <span className="text-stone-400">até</span>
              <input
                type="date"
                value={filters.dateRange?.end || ''}
                onChange={(e) =>
                  onFilterChange({
                    ...filters,
                    dateRange: {
                      start: filters.dateRange?.start || e.target.value,
                      end: e.target.value,
                    },
                  })
                }
                className="px-3 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-saibro-500 outline-none"
              />
              {filters.dateRange && (
                <button
                  onClick={() => onFilterChange({ ...filters, dateRange: null })}
                  className="p-2 text-stone-400 hover:text-stone-600 transition-colors"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Participant Filter */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users size={18} className="text-stone-600" />
              <h3 className="font-semibold text-stone-800">Participante</h3>
            </div>
            <select
              value={filters.participantId || ''}
              onChange={(e) =>
                onFilterChange({
                  ...filters,
                  participantId: e.target.value || null,
                })
              }
              className="w-full px-3 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-saibro-500 outline-none"
            >
              <option value="">Todos os participantes</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
