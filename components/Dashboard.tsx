import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from 'recharts';
import { supabase } from '../lib/supabase';
import { Loader2, Filter, TrendingUp, TrendingDown, Clock, Calendar, Users, Trophy } from 'lucide-react';
import { Reservation, Court } from '../types';
import { formatDateBr } from '../utils';

// --- Types ---
type TimeFilter = 'all' | 'year' | 'month';

interface DashboardProps {
  // No props needed as it fetches its own data for now
}

// --- Colors ---
const COLORS = ['#ea580c', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']; // Saibro-like + others

export const Dashboard: React.FC<DashboardProps> = () => {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { name: string; avatar?: string; role: string }>>({});
  const [totalSocios, setTotalSocios] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>('all');
  const [selectedCourt, setSelectedCourt] = useState<string>('all');

  // --- Data Fetching & Realtime ---
  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);

      // 1. Fetch Courts
      const { data: courtsData } = await supabase.from('courts').select('id, name');
      if (courtsData) setCourts(courtsData);

      // 2. Fetch Profiles (for Top Athletes & Member Stats)
      const { data: profilesData } = await supabase.from('profiles').select('id, name, avatar_url, role').eq('is_active', true);
      if (profilesData) {
        const profMap: Record<string, { name: string; avatar?: string; role: string }> = {};
        let socioCount = 0;
        profilesData.forEach(p => {
          profMap[p.id] = { name: p.name, avatar: p.avatar_url, role: p.role };
          if (p.role === 'socio') socioCount++;
        });
        setProfiles(profMap);
        setTotalSocios(socioCount);
      }

      // 3. Fetch Reservations (All, then filter locally for smooth UX or filter query for perf)
      const { data: resData } = await supabase
        .from('reservations')
        .select('*')
        .neq('status', 'cancelled'); // Don't count cancelled stats

      if (resData) {
        const mapped: Reservation[] = resData.map(r => ({
          id: r.id,
          type: r.type,
          date: r.date,
          startTime: r.start_time,
          endTime: r.end_time,
          courtId: r.court_id,
          creatorId: r.creator_id,
          participantIds: r.participant_ids || [],
          status: r.status
        }));
        setReservations(mapped);
      }
      setLoading(false);
    };

    fetchInitialData();

    // Realtime Subscription
    const subscription = supabase
      .channel('dashboard-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations' },
        (payload) => {
          // Simple Strategy: Refetch to keep state clean (or handle partial updates)
          fetchInitialData();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // --- Data Processing (Memoized) ---
  const filteredReservations = useMemo(() => {
    return reservations.filter(r => {
      const date = new Date(r.date + 'T12:00:00'); // Fix timezone offset

      // Filter by Court
      if (selectedCourt !== 'all' && r.courtId !== selectedCourt) return false;

      if (selectedYear === 'all') return true;

      const yearMatch = date.getFullYear() === selectedYear;
      if (!yearMatch) return false;

      if (selectedMonth === 'all') return true;

      const monthMatch = (date.getMonth() + 1) === selectedMonth;
      return monthMatch;
    });
  }, [reservations, selectedYear, selectedMonth, selectedCourt]);

  // 1. Court Usage stats
  const courtUsageData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredReservations.forEach(r => {
      const cName = courts.find(c => c.id === r.courtId)?.name || 'Desconhecida';
      counts[cName] = (counts[cName] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredReservations, courts]);

  // 2. Weekday Stats
  const weekdayData = useMemo(() => {
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const counts = Array(7).fill(0);

    filteredReservations.forEach(r => {
      const date = new Date(r.date + 'T12:00:00');
      const dayIdx = date.getDay();
      counts[dayIdx]++;
    });

    return days.map((day, idx) => ({ day, count: counts[idx] }));
  }, [filteredReservations]);

  // 3. Hourly Stats
  const hourlyData = useMemo(() => {
    const counts: Record<string, number> = {};
    // Initialize common hours 06-22
    for (let i = 6; i <= 22; i++) {
      const h = i.toString().padStart(2, '0') + ':00';
      counts[h] = 0;
    }

    filteredReservations.forEach(r => {
      // Check if startTime exists in our map (or truncate minutes)
      const hour = r.startTime.split(':')[0] + ':00';
      if (counts[hour] !== undefined) counts[hour]++;
      else counts[hour] = (counts[hour] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => parseInt(a.hour) - parseInt(b.hour));
  }, [filteredReservations]);

  // --- Derived Insights ---
  const mostUsedCourt = courtUsageData[0]?.name || '-';
  const busyDay = [...weekdayData].sort((a, b) => b.count - a.count)[0];
  const quietDay = [...weekdayData].sort((a, b) => a.count - b.count).find(d => d.count > 0) || weekdayData[0];

  // 4. Member Stats
  const memberStats = useMemo(() => {
    // Logic: Count unique creatorIds who are 'socio'
    const uniqueActive = new Set<string>();
    const creatorCounts: Record<string, number> = {};

    filteredReservations.forEach(r => {
      const creator = profiles[r.creatorId];
      // Only count if profile exists (and optionally if they are truly a socio, 
      // though 'role' check might be redundant if we assume creators are valid users)
      if (creator) {
        uniqueActive.add(r.creatorId);
        creatorCounts[r.creatorId] = (creatorCounts[r.creatorId] || 0) + 1;
      }
    });

    // Top 5 Athletes
    const topAthletes = Object.entries(creatorCounts)
      .sort((a, b) => b[1] - a[1]) // Sort by count desc
      .slice(0, 5)
      .map(([id, count]) => ({
        id,
        name: profiles[id]?.name || 'Desconhecido',
        avatar: profiles[id]?.avatar,
        count
      }));

    return {
      activeCount: uniqueActive.size,
      utilizationRate: totalSocios > 0 ? (uniqueActive.size / totalSocios * 100).toFixed(1) : '0',
      topAthletes
    };
  }, [filteredReservations, profiles, totalSocios]);

  // Find busiest hour
  const busyHour = [...hourlyData].sort((a, b) => b.count - a.count)[0];


  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin text-saibro-500" size={32} /></div>;
  }

  // Generate years for filter (e.g. 2024, 2025)
  // Could drive from data, but fixed range is easier for now
  const years = [2024, 2025, 2026];
  const months = [
    { val: 1, label: 'Janeiro' }, { val: 2, label: 'Fevereiro' }, { val: 3, label: 'Março' },
    { val: 4, label: 'Abril' }, { val: 5, label: 'Maio' }, { val: 6, label: 'Junho' },
    { val: 7, label: 'Julho' }, { val: 8, label: 'Agosto' }, { val: 9, label: 'Setembro' },
    { val: 10, label: 'Outubro' }, { val: 11, label: 'Novembro' }, { val: 12, label: 'Dezembro' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header / Filters */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-2xl card-court">
        <div>
          <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2">
            <TrendingUp className="text-saibro-500" /> Dashboard Analytics
          </h2>
          <p className="text-stone-500 text-sm">Visão geral em tempo real</p>
        </div>

        {/* Court Filter */}
        <select
          value={selectedCourt}
          onChange={(e) => setSelectedCourt(e.target.value)}
          className="px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 text-stone-700 outline-none focus:ring-2 focus:ring-saibro-500"
        >
          <option value="all">Todas as Quadras</option>
          {courts.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          disabled={selectedYear === 'all'}
          className={`px-3 py-2 rounded-lg border border-stone-200 text-stone-700 outline-none focus:ring-2 focus:ring-saibro-500 ${selectedYear === 'all' ? 'bg-stone-100 text-stone-400 cursor-not-allowed' : 'bg-stone-50'}`}
        >
          <option value="all">Todos os Meses</option>
          {months.map(m => (
            <option key={m.val} value={m.val}>{m.label}</option>
          ))}
        </select>

        <select
          value={selectedYear}
          onChange={(e) => {
            const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
            setSelectedYear(val);
            if (val === 'all') setSelectedMonth('all');
          }}
          className="px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 text-stone-700 outline-none focus:ring-2 focus:ring-saibro-500"
        >
          <option value="all">Todo o Período</option>
          {years.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>


      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-linear-to-br from-white to-stone-50/50 border-l-[6px] border-saibro-500 p-4 rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 animate-scale-in">
          <p className="text-xs text-stone-500 uppercase font-bold tracking-wider">Total Reservas</p>
          <p className="text-3xl font-black text-stone-800 mt-1">{filteredReservations.length}</p>
          <p className="text-[10px] text-stone-400 font-bold uppercase mt-1">
            {selectedYear === 'all' ? 'Todo o período' : selectedMonth === 'all' ? `Em ${selectedYear}` : `Em ${months.find(m => m.val === selectedMonth)?.label}/${selectedYear}`}
          </p>
        </div>
        <div className="bg-linear-to-br from-white to-stone-50/50 border-l-[6px] border-blue-500 p-4 rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 animate-scale-in delay-75">
          <p className="text-xs text-stone-500 uppercase font-bold tracking-wider">Quadra Favorita</p>
          <p className="text-lg font-black text-stone-800 truncate mt-2 leading-tight" title={mostUsedCourt}>{mostUsedCourt}</p>
          <p className="text-[10px] text-stone-400 font-bold uppercase mt-1">Mais utilizada</p>
        </div>
        <div className="bg-linear-to-br from-white to-stone-50/50 border-l-[6px] border-green-500 p-4 rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 animate-scale-in delay-150">
          <p className="text-xs text-stone-500 uppercase font-bold tracking-wider">Dia de Pico</p>
          <div className="flex items-center gap-2 mt-2">
            <Calendar className="text-green-600 animate-float" size={24} />
            <div>
              <p className="text-lg font-black text-stone-800 leading-none">{busyDay?.day || '-'}</p>
              <span className="text-[10px] text-stone-400 font-bold uppercase">{busyDay?.count || 0} reservas</span>
            </div>
          </div>
        </div>
        <div className="bg-linear-to-br from-white to-stone-50/50 border-l-[6px] border-orange-500 p-4 rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 animate-scale-in delay-200">
          <p className="text-xs text-stone-500 uppercase font-bold tracking-wider">Hora de Pico</p>
          <div className="flex items-center gap-2 mt-2">
            <Clock className="text-orange-600 animate-float" size={24} />
            <div>
              <p className="text-lg font-black text-stone-800 leading-none">{busyHour?.hour || '-'}</p>
              <span className="text-[10px] text-stone-400 font-bold uppercase">{busyHour?.count || 0} reservas</span>
            </div>
          </div>
        </div>
      </div>

      {/* Member Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Active Members Metric */}
        <div className="bg-white p-6 rounded-2xl card-court flex items-center justify-between">
          <div>
            <p className="text-stone-500 text-sm font-semibold mb-1">Sócios Ativos</p>
            <h3 className="text-3xl font-bold text-stone-800">{memberStats.activeCount} <span className="text-sm text-stone-400 font-normal">/ {totalSocios}</span></h3>
            <p className="text-xs text-green-600 mt-2 font-medium bg-green-50 inline-block px-2 py-1 rounded-lg">
              {memberStats.utilizationRate}% da base
            </p>
          </div>
          <div className="bg-blue-50 p-3 rounded-full text-blue-500">
            <Users size={24} />
          </div>
        </div>

        {/* Top Athletes List */}
        <div className="md:col-span-2 bg-white p-6 rounded-2xl card-court">
          <h3 className="font-bold text-stone-700 mb-4 flex items-center gap-2">
            <Trophy className="text-yellow-500" size={18} /> Top 5 Atletas com mais reservas!
          </h3>
          <div className="space-y-4">
            {memberStats.topAthletes.map((athlete, index) => (
              <div key={athlete.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${index === 0 ? 'bg-yellow-100 text-yellow-700' : index === 1 ? 'bg-stone-200 text-stone-600' : index === 2 ? 'bg-orange-100 text-orange-700' : 'text-stone-400'}`}>
                    {index + 1}
                  </span>
                  <img src={athlete.avatar || 'https://via.placeholder.com/40'} alt={athlete.name} className="w-8 h-8 rounded-full bg-stone-100 object-cover" />
                  <p className="text-sm font-medium text-stone-800">{athlete.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-saibro-500 rounded-full"
                      style={{ width: `${(athlete.count / (memberStats.topAthletes[0]?.count || 1)) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-bold text-stone-600 w-8 text-right">{athlete.count}</span>
                </div>
              </div>
            ))}
            {memberStats.topAthletes.length === 0 && (
              <p className="text-center text-stone-400 text-sm py-2">Nenhum dado disponível.</p>
            )}
          </div>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Court Usage Chart */}
        <div className="bg-white p-4 rounded-xl border border-stone-100 shadow-sm min-w-0">
          <h3 className="font-bold text-stone-700 mb-4">Utilização por Quadra</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={courtUsageData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#ea580c" radius={[0, 4, 4, 0]} name="Reservas" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weekday Activity */}
        <div className="bg-white p-4 rounded-xl border border-stone-100 shadow-sm min-w-0">
          <h3 className="font-bold text-stone-700 mb-4">Movimento Semanal</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={weekdayData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Reservas" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2: Hourly Heatmap/Area */}
      <div className="bg-white p-4 rounded-xl border border-stone-100 shadow-sm min-w-0">
        <h3 className="font-bold text-stone-700 mb-4">Horários Mais Movimentados</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="hour" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} name="Reservas" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div >
  );
};