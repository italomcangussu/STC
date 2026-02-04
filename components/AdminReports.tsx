/**
 * Módulo de Relatórios para Admin
 *
 * Features:
 * - Dashboard com métricas principais
 * - Gráficos de ocupação de quadras
 * - Exportação para CSV/Excel
 * - Análise de receita e consumo
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Download,
  TrendingUp,
  Users,
  Calendar,
  DollarSign,
  BarChart3,
  PieChart,
  FileSpreadsheet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingOverlay, SkeletonCard } from './ui/LoadingStates';
import { logger } from '../lib/logger';
import { notify } from '../lib/notifications';

interface ReportMetrics {
  totalReservations: number;
  totalMembers: number;
  totalRevenue: number;
  courtOccupancy: number;
  activeChallenges: number;
  completedMatches: number;
}

interface CourtOccupancy {
  courtName: string;
  reservations: number;
  utilizationRate: number;
}

interface TimeSlotOccupancy {
  timeSlot: string;
  reservations: number;
}

export const AdminReports: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });

  const [metrics, setMetrics] = useState<ReportMetrics>({
    totalReservations: 0,
    totalMembers: 0,
    totalRevenue: 0,
    courtOccupancy: 0,
    activeChallenges: 0,
    completedMatches: 0,
  });

  const [courtData, setCourtData] = useState<CourtOccupancy[]>([]);
  const [timeSlotData, setTimeSlotData] = useState<TimeSlotOccupancy[]>([]);

  useEffect(() => {
    fetchMetrics();
  }, [dateRange]);

  const fetchMetrics = async () => {
    try {
      setLoading(true);

      // Fetch reservations
      const { data: reservations, error: resError } = await supabase
        .from('reservations')
        .select('*')
        .gte('date', dateRange.start)
        .lte('date', dateRange.end)
        .eq('status', 'active');

      if (resError) throw resError;

      // Fetch members
      const { count: memberCount, error: memberError } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .in('role', ['socio', 'admin']);

      if (memberError) throw memberError;

      // Fetch consumptions for revenue
      const { data: consumptions, error: consError } = await supabase
        .from('consumptions')
        .select('total_price')
        .gte('date', dateRange.start)
        .lte('date', dateRange.end)
        .eq('status', 'paid');

      if (consError) throw consError;

      const totalRevenue = consumptions?.reduce((sum, c) => sum + (c.total_price || 0), 0) || 0;

      // Fetch challenges
      const { count: challengeCount, error: challengeError } = await supabase
        .from('challenges')
        .select('id', { count: 'exact', head: true })
        .in('status', ['proposed', 'accepted', 'scheduled']);

      if (challengeError) throw challengeError;

      // Fetch completed matches
      const { count: matchCount, error: matchError } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'finished');

      if (matchError) throw matchError;

      // Calculate court occupancy
      const { data: courts } = await supabase.from('courts').select('*').eq('is_active', true);

      const courtOccupancyData: CourtOccupancy[] = [];
      const timeSlots: Record<string, number> = {};

      courts?.forEach((court) => {
        const courtReservations = reservations?.filter((r) => r.court_id === court.id) || [];
        const utilizationRate = (courtReservations.length / 30) * 100; // Simplified calculation

        courtOccupancyData.push({
          courtName: court.name,
          reservations: courtReservations.length,
          utilizationRate: Math.min(utilizationRate, 100),
        });
      });

      // Time slot analysis
      reservations?.forEach((r) => {
        const hour = r.start_time?.split(':')[0] || '00';
        const slot = `${hour}:00`;
        timeSlots[slot] = (timeSlots[slot] || 0) + 1;
      });

      const timeSlotArray = Object.entries(timeSlots)
        .map(([timeSlot, reservations]) => ({ timeSlot, reservations }))
        .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));

      setMetrics({
        totalReservations: reservations?.length || 0,
        totalMembers: memberCount || 0,
        totalRevenue,
        courtOccupancy: courtOccupancyData.reduce((sum, c) => sum + c.utilizationRate, 0) / (courtOccupancyData.length || 1),
        activeChallenges: challengeCount || 0,
        completedMatches: matchCount || 0,
      });

      setCourtData(courtOccupancyData);
      setTimeSlotData(timeSlotArray);

      logger.info('admin_reports_fetched', { dateRange, metricsCount: Object.keys(metrics).length });
    } catch (error: any) {
      logger.error('admin_reports_fetch_failed', { error: error.message });
      notify.error('Erro ao carregar relatórios', { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    try {
      const headers = ['Métrica', 'Valor'];
      const rows = [
        ['Total de Reservas', metrics.totalReservations],
        ['Total de Membros', metrics.totalMembers],
        ['Receita Total', `R$ ${metrics.totalRevenue.toFixed(2)}`],
        ['Taxa de Ocupação', `${metrics.courtOccupancy.toFixed(1)}%`],
        ['Desafios Ativos', metrics.activeChallenges],
        ['Partidas Finalizadas', metrics.completedMatches],
      ];

      const csv = [
        headers.join(','),
        ...rows.map((row) => row.join(',')),
        '',
        'Ocupação por Quadra',
        'Quadra,Reservas,Taxa de Utilização',
        ...courtData.map((c) => `${c.courtName},${c.reservations},${c.utilizationRate.toFixed(1)}%`),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `relatorio-stc-${dateRange.start}-${dateRange.end}.csv`;
      link.click();

      logger.info('admin_report_exported', { format: 'csv', dateRange });
      notify.success('Relatório exportado com sucesso!');
    } catch (error: any) {
      logger.error('admin_report_export_failed', { error: error.message });
      notify.error('Erro ao exportar relatório');
    }
  };

  if (loading) {
    return <LoadingOverlay message="Carregando relatórios..." />;
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-stone-800">Relatórios Administrativos</h1>
          <p className="text-stone-600 mt-1">Análise e métricas do clube</p>
        </div>
        <button
          onClick={exportToCSV}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl shadow-lg transition-colors"
        >
          <Download size={18} />
          Exportar CSV
        </button>
      </div>

      {/* Date Range Filter */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4">
        <Calendar size={20} className="text-stone-400" />
        <input
          type="date"
          value={dateRange.start}
          onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
          className="px-3 py-2 border border-stone-200 rounded-lg"
        />
        <span className="text-stone-400">até</span>
        <input
          type="date"
          value={dateRange.end}
          onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
          className="px-3 py-2 border border-stone-200 rounded-lg"
        />
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          icon={<Calendar className="text-blue-600" />}
          title="Reservas"
          value={metrics.totalReservations}
          bgColor="bg-blue-50"
        />
        <MetricCard
          icon={<Users className="text-green-600" />}
          title="Membros Ativos"
          value={metrics.totalMembers}
          bgColor="bg-green-50"
        />
        <MetricCard
          icon={<DollarSign className="text-emerald-600" />}
          title="Receita"
          value={`R$ ${metrics.totalRevenue.toFixed(2)}`}
          bgColor="bg-emerald-50"
        />
        <MetricCard
          icon={<PieChart className="text-purple-600" />}
          title="Ocupação Média"
          value={`${metrics.courtOccupancy.toFixed(1)}%`}
          bgColor="bg-purple-50"
        />
        <MetricCard
          icon={<TrendingUp className="text-orange-600" />}
          title="Desafios Ativos"
          value={metrics.activeChallenges}
          bgColor="bg-orange-50"
        />
        <MetricCard
          icon={<BarChart3 className="text-indigo-600" />}
          title="Partidas Finalizadas"
          value={metrics.completedMatches}
          bgColor="bg-indigo-50"
        />
      </div>

      {/* Court Occupancy Chart */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-xl font-bold text-stone-800 mb-4">Ocupação por Quadra</h2>
        <div className="space-y-3">
          {courtData.map((court) => (
            <div key={court.courtName} className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-stone-700">{court.courtName}</span>
                <span className="text-stone-600">
                  {court.reservations} reservas ({court.utilizationRate.toFixed(1)}%)
                </span>
              </div>
              <div className="w-full bg-stone-100 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-saibro-500 to-saibro-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${court.utilizationRate}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Time Slot Analysis */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-xl font-bold text-stone-800 mb-4">Horários Mais Reservados</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {timeSlotData.slice(0, 8).map((slot) => (
            <div key={slot.timeSlot} className="bg-stone-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-saibro-600">{slot.reservations}</div>
              <div className="text-sm text-stone-600">{slot.timeSlot}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  bgColor: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon, title, value, bgColor }) => {
  return (
    <div className={`${bgColor} rounded-2xl p-6 shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        <div className="p-2 bg-white rounded-lg">{icon}</div>
      </div>
      <div className="text-2xl font-bold text-stone-800">{value}</div>
      <div className="text-sm text-stone-600 mt-1">{title}</div>
    </div>
  );
};
