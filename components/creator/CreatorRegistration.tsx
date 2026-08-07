import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Search, Star, Trash2, UserPlus, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MEMBER_ROLES } from '../../utils';
import { Toggle } from './Toggle';
import {
    fetchActiveStudents,
    fetchClassRegistrations,
    registerAluno,
    type ClassRegistration,
    type StudentOption,
} from '../../lib/championship/registration';
import { applySeeds, suggestSeedsFromRanking } from '../../lib/championship/seeding';
import { createRounds } from '../../lib/championship/rounds';
import { validateAgainstParticipants, type FormatConfig } from '../../lib/championship/formatConfig';

type Origem = 'socio' | 'guest' | 'aluno';

interface Profile {
    id: string;
    name: string;
}

interface Props {
    championshipId: string;
    classes: string[];
    config: FormatConfig;
    startDate: string;
    endDate: string;
    onRoundsCreated: (classe: string, phaseToRoundId: Map<string, string>) => void;
}

export const CreatorRegistration: React.FC<Props> = ({
    championshipId, classes, config, startDate, endDate, onRoundsCreated,
}) => {
    const [classe, setClasse] = useState(classes[0] ?? '');
    const [registrations, setRegistrations] = useState<ClassRegistration[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string[]>([]);

    const [allowGuests, setAllowGuests] = useState(false);
    const [allowStudents, setAllowStudents] = useState(false);
    const [origem, setOrigem] = useState<Origem>('socio');

    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [students, setStudents] = useState<StudentOption[]>([]);
    const [busca, setBusca] = useState('');
    const [guestName, setGuestName] = useState('');
    const [guestCidade, setGuestCidade] = useState('');

    const [seedIds, setSeedIds] = useState<string[]>([]);
    const [seedCount, setSeedCount] = useState(2);
    const [seeding, setSeeding] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const regs = await fetchClassRegistrations(championshipId, classe);
            setRegistrations(regs);
            setSeedIds(regs.filter(r => r.isSeed).map(r => r.registrationId));
        } catch (e: any) {
            setError([e.message]);
        } finally {
            setLoading(false);
        }
    }, [championshipId, classe]);

    useEffect(() => { if (classe) reload(); }, [classe, reload]);

    useEffect(() => {
        supabase
            .from('profiles')
            .select('id, name')
            .in('role', [...MEMBER_ROLES])
            .eq('is_active', true)
            .order('name')
            .then(({ data }) => setProfiles((data ?? []) as Profile[]));
    }, []);

    useEffect(() => {
        if (!allowStudents) return;
        fetchActiveStudents().then(setStudents).catch((e: any) => setError([e.message]));
    }, [allowStudents]);

    const jaInscrito = (userId: string) => registrations.some(r => r.userId === userId);

    const addSocio = async (profile: Profile) => {
        setSaving(true);
        setError([]);
        try {
            const { error: insertError } = await supabase
                .from('championship_registrations')
                .insert({
                    championship_id: championshipId,
                    participant_type: 'socio',
                    user_id: profile.id,
                    class: classe,
                });
            if (insertError) throw new Error(insertError.message);
            await reload();
        } catch (e: any) {
            setError([e.message]);
        } finally {
            setSaving(false);
        }
    };

    const addGuest = async () => {
        if (!guestName.trim()) return;
        setSaving(true);
        setError([]);
        try {
            const { error: insertError } = await supabase
                .from('championship_registrations')
                .insert({
                    championship_id: championshipId,
                    participant_type: 'guest',
                    guest_name: guestName.trim(),
                    guest_cidade: guestCidade.trim() || null,
                    class: classe,
                });
            if (insertError) throw new Error(insertError.message);
            setGuestName('');
            setGuestCidade('');
            await reload();
        } catch (e: any) {
            setError([e.message]);
        } finally {
            setSaving(false);
        }
    };

    const addAluno = async (student: StudentOption) => {
        setSaving(true);
        setError([]);
        try {
            await registerAluno({ championshipId, studentId: student.id, classe });
            await reload();
        } catch (e: any) {
            setError([e.message]);
        } finally {
            setSaving(false);
        }
    };

    const remover = async (registrationId: string) => {
        setSaving(true);
        try {
            await supabase.from('championship_registrations').delete().eq('id', registrationId);
            await reload();
        } finally {
            setSaving(false);
        }
    };

    const toggleSeed = (registrationId: string) =>
        setSeedIds(prev => prev.includes(registrationId)
            ? prev.filter(id => id !== registrationId)
            : [...prev, registrationId]);

    const puxarDoRanking = async () => {
        setSeeding(true);
        setError([]);
        try {
            const candidates = registrations.map(r => ({
                registrationId: r.registrationId,
                userId: r.userId,
                name: r.name,
            }));
            setSeedIds(await suggestSeedsFromRanking(candidates, classe, seedCount));
        } catch (e: any) {
            setError([e.message]);
        } finally {
            setSeeding(false);
        }
    };

    const fecharInscricoes = async () => {
        const check = validateAgainstParticipants(config, registrations.length);
        if (!check.ok) {
            setError(check.errors);
            return;
        }

        setSaving(true);
        setError([]);
        try {
            await applySeeds(championshipId, classe, seedIds);
            const phaseToRoundId = await createRounds({
                championshipId,
                classe,
                config,
                participantCount: registrations.length,
                startDate,
                endDate,
            });
            onRoundsCreated(classe, phaseToRoundId);
        } catch (e: any) {
            setError([e.message]);
        } finally {
            setSaving(false);
        }
    };

    const filtrados = profiles.filter(p =>
        !jaInscrito(p.id) && p.name.toLowerCase().includes(busca.toLowerCase()));
    const alunosFiltrados = students.filter(s => s.name.toLowerCase().includes(busca.toLowerCase()));

    return (
        <div className="space-y-4">
            {classes.length > 1 && (
                <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                    <h2 className="font-black text-stone-800">Classe</h2>
                    <div className="flex flex-wrap gap-2">
                        {classes.map(c => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => setClasse(c)}
                                aria-pressed={classe === c}
                                className={`px-4 py-2 rounded-xl font-bold text-sm transition-colors ${
                                    classe === c ? 'bg-saibro-600 text-white' : 'border border-stone-200 text-stone-600'
                                }`}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                <h2 className="font-black text-stone-800 flex items-center gap-2">
                    <Users size={18} className="text-saibro-600" /> Quem pode se inscrever
                </h2>
                <Toggle id="allow-guests" label="Aceitar convidados" checked={allowGuests} onChange={v => {
                    setAllowGuests(v);
                    if (!v && origem === 'guest') setOrigem('socio');
                }} />
                <Toggle id="allow-students" label="Aceitar alunos" checked={allowStudents} onChange={v => {
                    setAllowStudents(v);
                    if (!v && origem === 'aluno') setOrigem('socio');
                }} />
            </div>

            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="font-black text-stone-800">Inscritos</h2>
                    <span className="text-sm font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">
                        {registrations.length}
                    </span>
                </div>

                {loading ? (
                    <div className="py-6 text-center"><Loader2 className="animate-spin mx-auto text-saibro-600" /></div>
                ) : registrations.length === 0 ? (
                    <p className="text-sm text-stone-400 py-4 text-center">Nenhum inscrito nesta classe ainda.</p>
                ) : (
                    <ul className="space-y-2">
                        {registrations.map(r => (
                            <li key={r.registrationId} className="flex items-center justify-between p-3 rounded-xl border border-stone-100">
                                <div className="flex items-center gap-2 min-w-0">
                                    <button
                                        type="button"
                                        onClick={() => toggleSeed(r.registrationId)}
                                        aria-pressed={seedIds.includes(r.registrationId)}
                                        aria-label={`Marcar ${r.name} como cabeça de chave`}
                                        className={seedIds.includes(r.registrationId) ? 'text-saibro-600' : 'text-stone-300'}
                                    >
                                        <Star size={16} fill={seedIds.includes(r.registrationId) ? 'currentColor' : 'none'} />
                                    </button>
                                    <span className="font-bold text-sm text-stone-700 truncate">{r.name}</span>
                                    <span className="text-[10px] uppercase text-stone-400">{r.participantType}</span>
                                </div>
                                <button type="button" onClick={() => remover(r.registrationId)} aria-label={`Remover ${r.name}`}
                                    className="text-red-400 hover:text-red-600">
                                    <Trash2 size={16} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                <h2 className="font-black text-stone-800 flex items-center gap-2">
                    <UserPlus size={18} className="text-saibro-600" /> Adicionar
                </h2>

                <div className="flex gap-2">
                    {(['socio', ...(allowGuests ? ['guest'] as const : []), ...(allowStudents ? ['aluno'] as const : [])] as Origem[]).map(o => (
                        <button
                            key={o}
                            type="button"
                            onClick={() => setOrigem(o)}
                            aria-pressed={origem === o}
                            className={`flex-1 py-2 rounded-xl font-bold text-sm transition-colors ${
                                origem === o ? 'bg-saibro-600 text-white' : 'border border-stone-200 text-stone-600'
                            }`}
                        >
                            {o === 'socio' ? 'Sócio' : o === 'guest' ? 'Convidado' : 'Aluno'}
                        </button>
                    ))}
                </div>

                {origem === 'guest' ? (
                    <div className="space-y-2">
                        <input value={guestName} onChange={e => setGuestName(e.target.value)}
                            placeholder="Nome do convidado" className="w-full p-3 border border-stone-200 rounded-xl" />
                        <input value={guestCidade} onChange={e => setGuestCidade(e.target.value)}
                            placeholder="Cidade (opcional)" className="w-full p-3 border border-stone-200 rounded-xl" />
                        <button type="button" onClick={addGuest} disabled={!guestName.trim() || saving}
                            className="w-full py-3 bg-stone-900 text-white rounded-xl font-bold disabled:opacity-50">
                            Inscrever convidado
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                            <input value={busca} onChange={e => setBusca(e.target.value)}
                                placeholder={origem === 'socio' ? 'Buscar sócio...' : 'Buscar aluno...'}
                                className="w-full pl-9 p-3 border border-stone-200 rounded-xl" />
                        </div>
                        <ul className="max-h-56 overflow-y-auto space-y-1">
                            {(origem === 'socio' ? filtrados : alunosFiltrados).map(item => (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => origem === 'socio' ? addSocio(item as Profile) : addAluno(item)}
                                        className="w-full text-left p-3 rounded-xl hover:bg-stone-50 text-sm font-bold text-stone-700 disabled:opacity-50"
                                    >
                                        {item.name}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>

            <div className="bg-white rounded-2xl border border-stone-100 p-5 space-y-3">
                <h2 className="font-black text-stone-800 flex items-center gap-2">
                    <Star size={18} className="text-saibro-600" /> Cabeças de chave
                    <span className="text-sm font-bold text-stone-400">({seedIds.length})</span>
                </h2>
                <p className="text-xs text-stone-500">
                    Marque na lista acima, ou puxe os primeiros do ranking da classe. Convidados e alunos
                    não têm posição no ranking e só podem ser marcados à mão.
                </p>
                <div className="flex gap-2">
                    <input
                        type="number"
                        min={0}
                        value={seedCount}
                        onChange={e => setSeedCount(Number(e.target.value))}
                        aria-label="Quantos cabeças de chave puxar do ranking"
                        className="w-24 p-3 border border-stone-200 rounded-xl font-bold"
                    />
                    <button type="button" onClick={puxarDoRanking} disabled={seeding}
                        className="flex-1 py-3 border border-stone-200 rounded-xl font-bold text-stone-700 disabled:opacity-50 flex justify-center items-center gap-2">
                        {seeding ? <Loader2 size={16} className="animate-spin" /> : <Star size={16} />} Puxar do ranking
                    </button>
                </div>
            </div>

            {error.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1">
                    {error.map(e => <p key={e} className="text-sm text-amber-800">{e}</p>)}
                </div>
            )}

            <button
                type="button"
                onClick={fecharInscricoes}
                disabled={saving || registrations.length === 0}
                className="w-full py-3 bg-saibro-600 text-white rounded-xl font-bold disabled:opacity-50 flex justify-center items-center gap-2"
            >
                {saving ? <Loader2 size={18} className="animate-spin" /> : null}
                Fechar inscrições e gerar rodadas
            </button>
        </div>
    );
};
