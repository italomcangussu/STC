import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Lock, Shuffle, Trophy, UserPlus, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { User } from '../types';
import { GroupDrawPage } from './GroupDrawPage';
import { ChampionshipInProgress } from './ChampionshipInProgress';
import { useAuth } from '../contexts/AuthContext';

interface ChampionshipRow {
    id: string;
    name: string;
    status: 'draft' | 'ongoing' | 'finished';
    format: 'mata-mata' | 'pontos-corridos' | 'grupo-mata-mata';
    start_date: string | null;
    end_date: string | null;
    registration_open: boolean;
    registration_closed: boolean;
    pts_victory?: number;
    pts_defeat?: number;
    pts_wo_victory?: number;
    pts_set?: number;
    pts_game?: number;
    pts_technical_draw?: number;
}

const CHAMPIONSHIP_SELECT_COLUMNS = [
    'id',
    'name',
    'status',
    'format',
    'start_date',
    'end_date',
    'registration_open',
    'registration_closed',
    'pts_victory',
    'pts_defeat',
    'pts_wo_victory',
    'pts_set',
    'pts_game',
    'pts_technical_draw'
];

const parseMissingChampionshipColumn = (error: any): string | null => {
    const message = error?.message || '';
    const match = message.match(/column championships\.([a-zA-Z0-9_]+) does not exist/i);
    return match?.[1] || null;
};

const pickNumeric = (value: any, fallback?: number) => (
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const normalizeChampionshipRow = (row: any): ChampionshipRow => ({
    id: row.id,
    name: row.name,
    status: row.status,
    format: row.format,
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    registration_open: Boolean(row.registration_open),
    // Some environments don't have registration_closed column yet.
    registration_closed: typeof row.registration_closed === 'boolean'
        ? row.registration_closed
        : !Boolean(row.registration_open),
    pts_victory: pickNumeric(row.pts_victory, 3),
    pts_defeat: pickNumeric(row.pts_defeat, 0),
    pts_wo_victory: pickNumeric(row.pts_wo_victory, 3),
    pts_set: pickNumeric(row.pts_set, 0),
    pts_game: pickNumeric(row.pts_game, 0),
    pts_technical_draw: pickNumeric(row.pts_technical_draw, 0)
});

interface Registration {
    id: string;
    championship_id: string;
    participant_type: 'socio' | 'guest';
    user_id: string | null;
    guest_name: string | null;
    class: string;
    shirt_size: string;
    created_at: string;
    user?: { name: string; avatar_url: string };
}

interface RoundRow {
    id: string;
    round_number: number;
    name: string;
    phase: string;
    start_date: string;
    end_date: string;
    status: 'pending' | 'active' | 'finished';
}

interface RoundConflict {
    id: string;
    scheduled_date: string | null;
    scheduled_time: string | null;
    registration_a_id: string | null;
    registration_b_id: string | null;
}

interface AuditLog {
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    before_data: any;
    after_data: any;
    created_at: string;
    actor?: { name: string };
}

const CLASSES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe'];
const SHIRT_SIZES = ['P', 'M', 'G', 'GG', 'XGG'];

interface Props {
    currentUser?: User;
}

export const ChampionshipAdmin: React.FC<Props> = ({ currentUser }) => {
    const { currentUser: authUser } = useAuth();
    const resolvedUser = currentUser || authUser;

    const [championships, setChampionships] = useState<ChampionshipRow[]>([]);
    const [selectedChampionshipId, setSelectedChampionshipId] = useState<string>('');
    const [selectedChampionship, setSelectedChampionship] = useState<ChampionshipRow | null>(null);

    const [profiles, setProfiles] = useState<User[]>([]);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [rounds, setRounds] = useState<RoundRow[]>([]);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

    const [loading, setLoading] = useState(true);
    const [savingRegistration, setSavingRegistration] = useState(false);
    const [savingRoundById, setSavingRoundById] = useState<Record<string, boolean>>({});
    const [loadingDetails, setLoadingDetails] = useState(false);

    const [showDrawPage, setShowDrawPage] = useState(false);
    const [hasGroups, setHasGroups] = useState(false);

    const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'ongoing' | 'finished'>('all');
    const [activeTab, setActiveTab] = useState<'overview' | 'rounds' | 'matches' | 'standings' | 'audit'>('overview');

    const [participantType, setParticipantType] = useState<'socio' | 'guest'>('socio');
    const [selectedUserId, setSelectedUserId] = useState('');
    const [guestName, setGuestName] = useState('');
    const [selectedClass, setSelectedClass] = useState(CLASSES[0]);
    const [shirtSize, setShirtSize] = useState(SHIRT_SIZES[1]);

    const [roundDrafts, setRoundDrafts] = useState<Record<string, Pick<RoundRow, 'start_date' | 'end_date' | 'status'>>>({});
    const [roundConflicts, setRoundConflicts] = useState<Record<string, RoundConflict[]>>({});

    const visibleChampionships = useMemo(() => {
        if (statusFilter === 'all') return championships;
        return championships.filter(ch => ch.status === statusFilter);
    }, [championships, statusFilter]);

    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        if (!selectedChampionshipId) return;
        fetchSelectedChampionshipData(selectedChampionshipId);
    }, [selectedChampionshipId]);

    const fetchChampionshipRows = async (params?: { championshipId?: string; single?: boolean }) => {
        let columns = [...CHAMPIONSHIP_SELECT_COLUMNS];
        let lastError: any = null;

        for (let attempt = 0; attempt < CHAMPIONSHIP_SELECT_COLUMNS.length; attempt += 1) {
            const selectColumns = columns.join(', ');

            let query = supabase
                .from('championships')
                .select(selectColumns);

            if (params?.championshipId) {
                query = query.eq('id', params.championshipId);
            }

            const response = params?.single
                ? await query.maybeSingle()
                : await query.order('start_date', { ascending: false, nullsFirst: false });

            if (!response.error) {
                if (params?.single) {
                    return { data: response.data ? [response.data] : [], error: null };
                }
                return { data: response.data || [], error: null };
            }

            lastError = response.error;
            const missingColumn = parseMissingChampionshipColumn(response.error);

            if (!missingColumn || !columns.includes(missingColumn)) {
                break;
            }

            columns = columns.filter(column => column !== missingColumn);
        }

        return { data: [], error: lastError };
    };

    const fetchInitialData = async () => {
        setLoading(true);

        const [championshipRes, profilesRes] = await Promise.all([
            fetchChampionshipRows(),
            supabase
                .from('profiles')
                .select('id, name, avatar_url, category, role')
                .eq('is_active', true)
                .in('role', ['socio', 'admin'])
                .order('name')
        ]);

        if (championshipRes.error) {
            console.error('Erro ao carregar campeonatos no admin:', championshipRes.error);
        }

        if (championshipRes.data) {
            const normalizedChamps = (championshipRes.data || []).map(normalizeChampionshipRow);
            setChampionships(normalizedChamps);

            if (normalizedChamps.length > 0) {
                setSelectedChampionshipId(prev => prev || normalizedChamps[0].id);
            }
        }

        if (profilesRes.data) {
            setProfiles((profilesRes.data || []).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar_url,
                category: p.category,
                role: p.role,
                email: '',
                phone: '',
                balance: 0,
                isActive: true
            })));
        }

        setLoading(false);
    };

    const fetchSelectedChampionshipData = async (championshipId: string) => {
        setLoadingDetails(true);

        const championshipPromise = fetchChampionshipRows({ championshipId, single: true });

        const [champRes, regsRes, roundsRes, groupsCountRes, auditRes] = await Promise.all([
            championshipPromise,
            supabase
                .from('championship_registrations')
                .select('*, user:profiles!user_id(name, avatar_url)')
                .eq('championship_id', championshipId)
                .order('class', { ascending: true }),
            supabase
                .from('championship_rounds')
                .select('id, round_number, name, phase, start_date, end_date, status')
                .eq('championship_id', championshipId)
                .order('round_number', { ascending: true }),
            supabase
                .from('championship_groups')
                .select('*', { count: 'exact', head: true })
                .eq('championship_id', championshipId),
            supabase
                .from('championship_admin_audit_logs')
                .select('id, action, entity_type, entity_id, before_data, after_data, created_at, actor:profiles!actor_user_id(name)')
                .eq('championship_id', championshipId)
                .order('created_at', { ascending: false })
                .limit(100)
        ]);

        if (champRes.error) {
            console.error('Erro ao carregar campeonato selecionado no admin:', champRes.error);
        }

        if (champRes.data?.[0]) {
            setSelectedChampionship(normalizeChampionshipRow(champRes.data[0]));
        } else {
            setSelectedChampionship(null);
        }

        setRegistrations((regsRes.data || []) as Registration[]);

        const roundRows = (roundsRes.data || []) as RoundRow[];
        setRounds(roundRows);

        const drafts: Record<string, Pick<RoundRow, 'start_date' | 'end_date' | 'status'>> = {};
        roundRows.forEach(round => {
            drafts[round.id] = {
                start_date: round.start_date,
                end_date: round.end_date,
                status: round.status
            };
        });
        setRoundDrafts(drafts);
        setRoundConflicts({});

        setHasGroups((groupsCountRes.count || 0) > 0);
        setAuditLogs((auditRes.data || []) as AuditLog[]);

        setLoadingDetails(false);
    };

    const createAuditLog = async (
        action: string,
        entityType: string,
        entityId: string | null,
        beforeData: Record<string, any> | null,
        afterData: Record<string, any> | null
    ) => {
        if (!selectedChampionship || !resolvedUser?.id) return;

        await supabase.from('championship_admin_audit_logs').insert({
            championship_id: selectedChampionship.id,
            entity_type: entityType,
            entity_id: entityId,
            action,
            before_data: beforeData,
            after_data: afterData,
            actor_user_id: resolvedUser.id
        });

        await fetchSelectedChampionshipData(selectedChampionship.id);
    };

    const handleAddRegistration = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedChampionship || !resolvedUser?.id) return;

        if (participantType === 'socio' && !selectedUserId) {
            alert('Selecione um sócio.');
            return;
        }

        if (participantType === 'guest' && !guestName.trim()) {
            alert('Informe o nome do convidado.');
            return;
        }

        setSavingRegistration(true);

        const payload = {
            championship_id: selectedChampionship.id,
            participant_type: participantType,
            user_id: participantType === 'socio' ? selectedUserId : null,
            guest_name: participantType === 'guest' ? guestName.trim() : null,
            class: selectedClass,
            shirt_size: shirtSize,
            registered_by: resolvedUser.id
        };

        const { error } = await supabase.from('championship_registrations').insert(payload);

        if (error) {
            alert('Erro ao adicionar inscrição: ' + error.message);
        } else {
            await createAuditLog('registration_created', 'registration', null, null, payload);
            setSelectedUserId('');
            setGuestName('');
            await fetchSelectedChampionshipData(selectedChampionship.id);
        }

        setSavingRegistration(false);
    };

    const handleDeleteRegistration = async (registrationId: string) => {
        if (!selectedChampionship) return;
        if (!confirm('Remover esta inscrição?')) return;

        const beforeData = registrations.find(r => r.id === registrationId) || null;

        const { error } = await supabase
            .from('championship_registrations')
            .delete()
            .eq('id', registrationId);

        if (error) {
            alert('Erro ao remover inscrição: ' + error.message);
            return;
        }

        await createAuditLog('registration_deleted', 'registration', registrationId, beforeData, null);
        await fetchSelectedChampionshipData(selectedChampionship.id);
    };

    const handleUpdateRegistrationStatus = async (open: boolean) => {
        if (!selectedChampionship) return;

        const beforeData = {
            registration_open: selectedChampionship.registration_open,
            registration_closed: selectedChampionship.registration_closed
        };

        const patch = {
            registration_open: open
        };

        const { error } = await supabase
            .from('championships')
            .update(patch)
            .eq('id', selectedChampionship.id);

        if (error) {
            alert('Erro ao atualizar status de inscrição: ' + error.message);
            return;
        }

        await createAuditLog(
            open ? 'registration_reopened' : 'registration_closed',
            'championship',
            selectedChampionship.id,
            beforeData,
            { registration_open: open, registration_closed: !open }
        );

        await fetchInitialData();
        await fetchSelectedChampionshipData(selectedChampionship.id);
    };

    const checkRoundConflicts = async (roundId: string, startDate: string, endDate: string) => {
        const { data } = await supabase
            .from('matches')
            .select('id, scheduled_date, scheduled_time, registration_a_id, registration_b_id')
            .eq('round_id', roundId)
            .not('scheduled_date', 'is', null)
            .or(`scheduled_date.lt.${startDate},scheduled_date.gt.${endDate}`);

        setRoundConflicts(prev => ({ ...prev, [roundId]: (data || []) as RoundConflict[] }));
    };

    const saveRoundChanges = async (roundId: string) => {
        if (!selectedChampionship) return;

        const originalRound = rounds.find(r => r.id === roundId);
        const roundDraft = roundDrafts[roundId];

        if (!originalRound || !roundDraft) return;

        setSavingRoundById(prev => ({ ...prev, [roundId]: true }));

        const patch = {
            start_date: roundDraft.start_date,
            end_date: roundDraft.end_date,
            status: roundDraft.status
        };

        const { error } = await supabase
            .from('championship_rounds')
            .update(patch)
            .eq('id', roundId);

        if (error) {
            alert('Erro ao salvar rodada: ' + error.message);
            setSavingRoundById(prev => ({ ...prev, [roundId]: false }));
            return;
        }

        await createAuditLog('round_updated', 'round', roundId, originalRound, patch);
        await checkRoundConflicts(roundId, roundDraft.start_date, roundDraft.end_date);

        setRounds(prev => prev.map(round => (round.id === roundId ? { ...round, ...patch } : round)));
        setSavingRoundById(prev => ({ ...prev, [roundId]: false }));
    };

    const getRegistrationNameById = (registrationId: string | null) => {
        if (!registrationId) return 'N/A';
        const registration = registrations.find(r => r.id === registrationId);
        if (!registration) return 'N/A';
        return registration.participant_type === 'guest'
            ? (registration.guest_name || 'Convidado')
            : (registration.user?.name || 'Sócio');
    };

    if (loading) {
        return (
            <div className="p-8 flex flex-col items-center justify-center min-h-[50vh]">
                <Loader2 size={40} className="animate-spin text-saibro-600" />
            </div>
        );
    }

    if (!resolvedUser) {
        return (
            <div className="p-8 text-center text-stone-500">Usuário admin não encontrado.</div>
        );
    }

    if (showDrawPage && selectedChampionship) {
        return (
            <GroupDrawPage
                currentUser={resolvedUser}
                championshipId={selectedChampionship.id}
                onBack={async () => {
                    setShowDrawPage(false);
                    await fetchSelectedChampionshipData(selectedChampionship.id);
                }}
            />
        );
    }

    return (
        <div className="p-4 pb-24 space-y-6">
            <div className="bg-white rounded-3xl border border-stone-100 p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 text-stone-800 font-black">
                    <Trophy size={18} className="text-saibro-600" />
                    Campeonato Admin (Fonte única)
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as any)}
                        className="w-full p-3 rounded-xl border border-stone-200 bg-white font-bold text-sm"
                    >
                        <option value="all">Todos status</option>
                        <option value="draft">Rascunho</option>
                        <option value="ongoing">Em andamento</option>
                        <option value="finished">Finalizado</option>
                    </select>

                    <select
                        value={selectedChampionshipId}
                        onChange={e => setSelectedChampionshipId(e.target.value)}
                        className="w-full p-3 rounded-xl border border-stone-200 bg-white font-bold text-sm"
                    >
                        {visibleChampionships.map(ch => (
                            <option key={ch.id} value={ch.id}>
                                {ch.name} ({ch.status})
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {!selectedChampionship ? (
                <div className="text-center py-12 bg-white rounded-3xl border border-stone-100 text-stone-500">
                    Nenhum campeonato encontrado para o filtro atual.
                </div>
            ) : (
                <>
                    <div className="bg-linear-to-br from-saibro-600 to-saibro-500 p-6 rounded-3xl text-white shadow-lg">
                        <h1 className="text-2xl font-black">{selectedChampionship.name}</h1>
                        <p className="text-saibro-100 text-sm mt-1">
                            Status: {selectedChampionship.status} • Formato: {selectedChampionship.format}
                        </p>
                    </div>

                    <div className="flex bg-white p-2 rounded-3xl shadow-sm border border-stone-100 gap-2 overflow-x-auto">
                        <TabButton active={activeTab === 'overview'} label="Visão Geral" onClick={() => setActiveTab('overview')} />
                        <TabButton active={activeTab === 'rounds'} label="Rodadas" onClick={() => setActiveTab('rounds')} />
                        <TabButton active={activeTab === 'matches'} label="Partidas" onClick={() => setActiveTab('matches')} />
                        <TabButton active={activeTab === 'standings'} label="Classificação" onClick={() => setActiveTab('standings')} />
                        <TabButton active={activeTab === 'audit'} label="Auditoria" onClick={() => setActiveTab('audit')} />
                    </div>

                    {loadingDetails ? (
                        <div className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-saibro-600" /></div>
                    ) : activeTab === 'overview' ? (
                        <div className="space-y-5">
                            <div className="bg-white rounded-2xl border border-stone-100 p-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <button
                                        onClick={() => handleUpdateRegistrationStatus(!selectedChampionship.registration_open)}
                                        className="py-3 rounded-xl bg-stone-900 text-white font-bold"
                                    >
                                        {selectedChampionship.registration_open ? 'Encerrar inscrições' : 'Reabrir inscrições'}
                                    </button>

                                    {!hasGroups && selectedChampionship.registration_closed && (
                                        <button
                                            onClick={() => setShowDrawPage(true)}
                                            className="py-3 rounded-xl bg-amber-500 text-white font-bold flex items-center justify-center gap-2"
                                        >
                                            <Shuffle size={16} /> Sorteador de Grupos
                                        </button>
                                    )}

                                    {hasGroups && (
                                        <button
                                            onClick={() => setActiveTab('matches')}
                                            className="py-3 rounded-xl bg-green-600 text-white font-bold"
                                        >
                                            Abrir painel em andamento
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl border border-stone-100 p-5">
                                <h2 className="text-lg font-black text-stone-800 mb-4">Nova inscrição</h2>
                                <form onSubmit={handleAddRegistration} className="space-y-4">
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setParticipantType('socio')}
                                            className={`flex-1 py-3 rounded-xl font-bold ${participantType === 'socio' ? 'bg-saibro-600 text-white' : 'bg-stone-100 text-stone-600'}`}
                                        >
                                            <Users size={14} className="inline mr-2" /> Sócio
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setParticipantType('guest')}
                                            className={`flex-1 py-3 rounded-xl font-bold ${participantType === 'guest' ? 'bg-saibro-600 text-white' : 'bg-stone-100 text-stone-600'}`}
                                        >
                                            <UserPlus size={14} className="inline mr-2" /> Convidado
                                        </button>
                                    </div>

                                    {participantType === 'socio' ? (
                                        <select
                                            value={selectedUserId}
                                            onChange={e => setSelectedUserId(e.target.value)}
                                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl"
                                        >
                                            <option value="">Escolha um sócio...</option>
                                            {profiles.map(profile => (
                                                <option key={profile.id} value={profile.id}>{profile.name}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            value={guestName}
                                            onChange={e => setGuestName(e.target.value)}
                                            placeholder="Nome do convidado"
                                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl"
                                        />
                                    )}

                                    <div className="grid grid-cols-2 gap-3">
                                        <select
                                            value={selectedClass}
                                            onChange={e => setSelectedClass(e.target.value)}
                                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl"
                                        >
                                            {CLASSES.map(cls => <option key={cls} value={cls}>{cls}</option>)}
                                        </select>

                                        <select
                                            value={shirtSize}
                                            onChange={e => setShirtSize(e.target.value)}
                                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl"
                                        >
                                            {SHIRT_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                                        </select>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={savingRegistration || !selectedChampionship.registration_open}
                                        className="w-full py-3 rounded-xl bg-saibro-600 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {savingRegistration ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                        {selectedChampionship.registration_open ? 'Inscrever' : 'Inscrições fechadas'}
                                    </button>
                                </form>
                            </div>

                            <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
                                <div className="px-4 py-3 border-b border-stone-100 font-black text-stone-700">
                                    Inscritos ({registrations.length})
                                </div>
                                <div className="divide-y divide-stone-100">
                                    {registrations.map(reg => (
                                        <div key={reg.id} className="px-4 py-3 flex items-center justify-between">
                                            <div>
                                                <p className="font-bold text-sm text-stone-800">
                                                    {reg.participant_type === 'guest' ? (reg.guest_name || 'Convidado') : (reg.user?.name || 'Sócio')}
                                                </p>
                                                <p className="text-xs text-stone-500">{reg.class} • Camisa {reg.shirt_size}</p>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteRegistration(reg.id)}
                                                className="text-xs font-bold px-3 py-2 rounded-lg bg-red-50 text-red-700"
                                            >
                                                Remover
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : activeTab === 'rounds' ? (
                        <div className="space-y-4">
                            {rounds.length === 0 ? (
                                <div className="bg-white rounded-2xl border border-stone-100 p-8 text-center text-stone-500">
                                    Nenhuma rodada criada ainda.
                                </div>
                            ) : rounds.map(round => {
                                const draft = roundDrafts[round.id] || {
                                    start_date: round.start_date,
                                    end_date: round.end_date,
                                    status: round.status
                                };
                                const conflicts = roundConflicts[round.id] || [];

                                return (
                                    <div key={round.id} className="bg-white rounded-2xl border border-stone-100 p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-black text-stone-800">{round.name}</h3>
                                            <span className="text-xs font-bold text-stone-500 uppercase">{round.phase}</span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <input
                                                type="date"
                                                value={draft.start_date}
                                                onChange={e => setRoundDrafts(prev => ({
                                                    ...prev,
                                                    [round.id]: { ...draft, start_date: e.target.value }
                                                }))}
                                                className="p-3 rounded-xl border border-stone-200"
                                            />
                                            <input
                                                type="date"
                                                value={draft.end_date}
                                                onChange={e => setRoundDrafts(prev => ({
                                                    ...prev,
                                                    [round.id]: { ...draft, end_date: e.target.value }
                                                }))}
                                                className="p-3 rounded-xl border border-stone-200"
                                            />
                                            <select
                                                value={draft.status}
                                                onChange={e => setRoundDrafts(prev => ({
                                                    ...prev,
                                                    [round.id]: { ...draft, status: e.target.value as RoundRow['status'] }
                                                }))}
                                                className="p-3 rounded-xl border border-stone-200"
                                            >
                                                <option value="pending">Pendente</option>
                                                <option value="active">Ativa</option>
                                                <option value="finished">Finalizada</option>
                                            </select>
                                        </div>

                                        <button
                                            onClick={() => saveRoundChanges(round.id)}
                                            disabled={savingRoundById[round.id]}
                                            className="px-4 py-2 rounded-xl bg-saibro-600 text-white font-bold disabled:opacity-50"
                                        >
                                            {savingRoundById[round.id] ? 'Salvando...' : 'Salvar rodada'}
                                        </button>

                                        {conflicts.length > 0 && (
                                            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                                                <p className="text-xs font-black text-amber-800 uppercase mb-2">
                                                    Conflitos de agendamento ({conflicts.length})
                                                </p>
                                                <div className="space-y-1 text-xs text-amber-900">
                                                    {conflicts.map(conflict => (
                                                        <div key={conflict.id}>
                                                            {getRegistrationNameById(conflict.registration_a_id)} x {getRegistrationNameById(conflict.registration_b_id)}
                                                            {' • '} {conflict.scheduled_date || 'sem data'} {conflict.scheduled_time || ''}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : activeTab === 'audit' ? (
                        <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
                            <div className="px-4 py-3 border-b border-stone-100 font-black text-stone-700">Auditoria</div>
                            <div className="divide-y divide-stone-100">
                                {auditLogs.length === 0 ? (
                                    <div className="px-4 py-8 text-sm text-stone-500 text-center">Sem eventos de auditoria.</div>
                                ) : auditLogs.map(log => (
                                    <div key={log.id} className="px-4 py-3 space-y-1">
                                        <div className="text-sm font-black text-stone-800">{log.action}</div>
                                        <div className="text-xs text-stone-500">
                                            {new Date(log.created_at).toLocaleString('pt-BR')} • {log.actor?.name || 'admin'} • {log.entity_type}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <ChampionshipInProgress
                            championship={{
                                id: selectedChampionship.id,
                                name: selectedChampionship.name,
                                status: selectedChampionship.status,
                                format: selectedChampionship.format,
                                participantIds: [],
                                startDate: selectedChampionship.start_date || undefined,
                                endDate: selectedChampionship.end_date || undefined,
                                ptsVictory: selectedChampionship.pts_victory,
                                ptsDefeat: selectedChampionship.pts_defeat,
                                ptsWoVictory: selectedChampionship.pts_wo_victory,
                                ptsSet: selectedChampionship.pts_set,
                                ptsGame: selectedChampionship.pts_game,
                                ptsTechnicalDraw: selectedChampionship.pts_technical_draw
                            }}
                            currentUser={resolvedUser}
                            onUpdate={() => fetchSelectedChampionshipData(selectedChampionship.id)}
                            initialTab={activeTab === 'matches' ? 'matches' : 'standings'}
                        />
                    )}
                </>
            )}
        </div>
    );
};

const TabButton: React.FC<{ active: boolean; label: string; onClick: () => void }> = ({ active, label, onClick }) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-wide whitespace-nowrap transition-all ${
            active ? 'bg-saibro-600 text-white shadow-sm' : 'text-stone-500 hover:bg-stone-50'
        }`}
    >
        {label}
    </button>
);
