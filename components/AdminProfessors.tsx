import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notifications';
import { useConfirm } from '../hooks/useConfirm';
import { Professor, NonSocioStudent } from '../types';
import { Users, GraduationCap, Loader2, ChevronRight, ChevronDown, Plus, Edit, Trash2 } from 'lucide-react';
import { Sheet } from './ui/Sheet';
import { AdminEmpty, AdminField, AdminPageHeader, StatTile, StatusPill, adminBtnGhost, adminBtnPrimary, adminInputCls } from './admin/ui';

// --- Modal Component ---
interface ProfessorFormData {
    name: string;
    bio: string;
    is_active: boolean;
}

interface ProfessorModalProps {
    professor?: Professor | null;
    onClose: () => void;
    onSave: (data: ProfessorFormData) => Promise<void>;
}

const ProfessorModal: React.FC<ProfessorModalProps> = ({ professor, onClose, onSave }) => {
    const [name, setName] = useState(professor?.name || '');
    const [bio, setBio] = useState(professor?.bio || '');
    const [isActive, setIsActive] = useState(professor?.isActive ?? true);
    const [saving, setSaving] = useState(false);
    const [touched, setTouched] = useState(false);

    const trimmed = name.trim();
    const nameError = trimmed.length < 2 ? 'Informe o nome do professor (mínimo 2 letras).' : undefined;

    const handleSubmit = async () => {
        setTouched(true);
        if (nameError) return;
        setSaving(true);
        try {
            await onSave({ name: trimmed, bio: bio.trim(), is_active: isActive });
            onClose();
        } catch (error) {
            notify.failure(error, 'Não foi possível salvar o professor.', {
                event: 'professor_save_failed',
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet
            open
            onClose={onClose}
            closeOnBackdrop={false}
            title={professor ? 'Editar professor' : 'Novo professor'}
            subtitle="Aparece para os alunos e na agenda de aulas"
            footer={<>
                <button className={adminBtnGhost} onClick={onClose}>Cancelar</button>
                <button className={`${adminBtnPrimary} sm:min-w-32`} onClick={handleSubmit} disabled={saving}>
                    {saving ? <Loader2 className="animate-spin" size={18} /> : 'Salvar'}
                </button>
            </>}
        >
            <AdminField label="Nome" error={touched ? nameError : undefined}>
                <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onBlur={() => setTouched(true)}
                    className={adminInputCls}
                    placeholder="Nome do professor"
                    maxLength={80}
                    autoComplete="off"
                    autoFocus={!professor}
                />
            </AdminField>
            <AdminField label="Especialidade (opcional)" hint="Ex.: tênis avançado, iniciantes, infantil.">
                <textarea
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    className={`${adminInputCls} h-24 resize-none`}
                    maxLength={300}
                />
            </AdminField>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-stone-50 px-3.5 text-sm font-bold text-stone-700">
                <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                    className="h-5 w-5 accent-saibro-600"
                />
                <span className="min-w-0">
                    Professor ativo
                    <span className="block text-xs font-normal text-stone-400">Desmarque para tirar da lista sem perder o histórico.</span>
                </span>
            </label>
        </Sheet>
    );
};

export const AdminProfessors: React.FC = () => {
    const confirm = useConfirm();
    const [professors, setProfessors] = useState<Professor[]>([]);
    const [students, setStudents] = useState<NonSocioStudent[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [expandedProf, setExpandedProf] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [editingProf, setEditingProf] = useState<Professor | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        setLoadFailed(false);
        try {
            // Fetch Professors
            const { data: profs, error: profError } = await supabase
                .from('professors')
                .select('*')
                .order('name');

            if (profError) throw profError;

            // Fetch Students linked to professors
            const { data: studss, error: studError } = await supabase
                .from('non_socio_students')
                .select('*')
                .not('professor_id', 'is', null);

            if (studError) throw studError;

            // Map database fields to TS types
            const mappedProfs = (profs || []).map((p: any) => ({
                id: p.id,
                userId: p.user_id,
                name: p.name,
                isActive: p.is_active,
                bio: p.bio
            }));

            const mappedStudents = (studss || []).map((s: any) => ({
                id: s.id,
                name: s.name,
                phone: s.phone,
                planType: s.plan_type,
                planStatus: s.plan_status,
                masterExpirationDate: s.master_expiration_date,
                professorId: s.professor_id,
                // `is_active` é o que a tela de Alunos usa para pausar/remover; sem ler isto a
                // contagem de "alunos ativos" de cada professor ficava sempre em zero.
                isActive: s.is_active ?? true,
                studentType: s.student_type || 'regular',
                responsibleSocioId: s.responsible_socio_id,
                relationshipType: s.relationship_type
            }));

            setProfessors(mappedProfs);
            setStudents(mappedStudents);

        } catch (error) {
            setLoadFailed(true);
            notify.failure(error, 'Não foi possível carregar os professores.', {
                event: 'professors_load_failed',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveProfessor = async (data: ProfessorFormData) => {
        // O supabase-js não lança em erro de banco: devolve `{ error }`. Sem checar, o modal
        // fechava como se tivesse salvo e o professor simplesmente não aparecia.
        const { error } = editingProf
            ? await supabase.from('professors').update(data).eq('id', editingProf.id)
            : await supabase.from('professors').insert(data);
        if (error) throw error;
        notify.success(editingProf ? 'Professor atualizado.' : 'Professor cadastrado.');
        fetchData();
    };

    const handleDeleteProfessor = async (prof: Professor) => {
        const linked = students.filter(s => s.professorId === prof.id).length;
        if (linked > 0) {
            notify.error(`${prof.name} ainda tem ${linked} ${linked === 1 ? 'aluno vinculado' : 'alunos vinculados'}.`, {
                description: 'Passe os alunos para outro professor na seção Alunos ou, se só quer tirá-lo da lista, edite e desmarque "Professor ativo".',
                duration: 8000,
            });
            return;
        }
        if (!await confirm({
            title: `Remover ${prof.name}?`,
            description: 'O professor sai da lista. Esta ação não pode ser desfeita.',
            confirmLabel: 'Remover professor',
        })) return;

        const { error } = await supabase.from('professors').delete().eq('id', prof.id);
        if (error) {
            notify.failure(error, 'Não foi possível remover o professor.', {
                event: 'professor_delete_failed',
                professorId: prof.id,
            });
        } else {
            notify.success('Professor removido.');
            fetchData();
        }
    };

    const studentsOf = (profId: string) => students.filter(s => s.professorId === profId);
    const activeStudentsOf = (profId: string) => studentsOf(profId).filter(s => s.isActive !== false);

    // Ativos primeiro, depois por nome: quem está em uso fica no topo.
    const sorted = useMemo(
        () => [...professors].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, 'pt-BR')),
        [professors],
    );
    const activeProfessors = professors.filter(p => p.isActive);
    const totalActiveStudents = students.filter(s => s.isActive !== false && professors.some(p => p.id === s.professorId)).length;
    const withoutStudents = activeProfessors.filter(p => activeStudentsOf(p.id).length === 0).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16" role="status">
                <Loader2 className="animate-spin text-saibro-600" size={32} />
                <span className="sr-only">Carregando professores…</span>
            </div>
        );
    }

    if (loadFailed) {
        return (
            <div className="space-y-3 rounded-2xl border border-red-100 bg-red-50 p-6 text-center" role="alert">
                <p className="text-sm font-bold text-red-700">Não foi possível carregar os professores.</p>
                <button className={adminBtnGhost} onClick={fetchData}>Tentar de novo</button>
            </div>
        );
    }

    return (
        <div className="space-y-5 animate-in fade-in duration-300">
            <AdminPageHeader
                icon={<GraduationCap className="text-saibro-600" />}
                title="Professores"
                subtitle="Corpo docente e alunos de cada um"
                actions={
                    <button onClick={() => { setEditingProf(null); setShowModal(true); }} className={adminBtnPrimary}>
                        <Plus size={18} /> Novo professor
                    </button>
                }
            />

            <div className="grid grid-cols-3 gap-2">
                <StatTile label="Professores" value={activeProfessors.length} hint={professors.length > activeProfessors.length ? `${professors.length} no total` : 'ativos'} />
                <StatTile label="Alunos" value={totalActiveStudents} hint="ativos" />
                <StatTile label="Sem alunos" value={withoutStudents} hint="professores" />
            </div>

            {sorted.length === 0 ? (
                <AdminEmpty
                    icon={<GraduationCap size={28} />}
                    title="Nenhum professor cadastrado"
                    hint="Cadastre o primeiro para poder vincular alunos e abrir a agenda de aulas."
                />
            ) : (
                <ul className="space-y-3">
                    {sorted.map(prof => {
                        const profStudents = studentsOf(prof.id);
                        const activeCount = activeStudentsOf(prof.id).length;
                        const isExpanded = expandedProf === prof.id;
                        const panelId = `prof-students-${prof.id}`;

                        return (
                            <li key={prof.id} className={`overflow-hidden rounded-2xl border bg-white ${prof.isActive ? 'border-stone-100' : 'border-stone-100 opacity-80'}`}>
                                <div className="flex items-center gap-1 pr-1">
                                    <button
                                        onClick={() => setExpandedProf(isExpanded ? null : prof.id)}
                                        aria-expanded={isExpanded}
                                        aria-controls={panelId}
                                        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                                    >
                                        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-black ${prof.isActive ? 'bg-saibro-100 text-saibro-700' : 'bg-stone-200 text-stone-500'}`} aria-hidden>
                                            {prof.name.charAt(0).toUpperCase()}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate font-bold text-stone-800">{prof.name}</span>
                                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
                                                <StatusPill tone={prof.isActive ? 'good' : 'muted'}>{prof.isActive ? 'Ativo' : 'Inativo'}</StatusPill>
                                                <span>{activeCount === 1 ? '1 aluno ativo' : `${activeCount} alunos ativos`}</span>
                                            </span>
                                        </span>
                                        {isExpanded ? <ChevronDown className="shrink-0 text-stone-400" size={20} /> : <ChevronRight className="shrink-0 text-stone-400" size={20} />}
                                    </button>
                                    <button
                                        onClick={() => { setEditingProf(prof); setShowModal(true); }}
                                        aria-label={`Editar ${prof.name}`}
                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-400 hover:bg-saibro-50 hover:text-saibro-600"
                                    >
                                        <Edit size={19} />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteProfessor(prof)}
                                        aria-label={`Remover ${prof.name}`}
                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-400 hover:bg-red-50 hover:text-red-500"
                                    >
                                        <Trash2 size={19} />
                                    </button>
                                </div>

                                {isExpanded && (
                                    <div id={panelId} className="space-y-3 border-t border-stone-100 bg-stone-50 p-4 animate-in slide-in-from-top-2 duration-200">
                                        {prof.bio && <p className="text-sm text-stone-500">{prof.bio}</p>}
                                        <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-stone-400">
                                            <Users size={14} /> Alunos
                                        </h4>

                                        {profStudents.length === 0 ? (
                                            <p className="text-sm text-stone-400">Nenhum aluno vinculado. Vincule na seção Alunos.</p>
                                        ) : (
                                            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                                                {profStudents.map(student => (
                                                    <li key={student.id} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white p-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate font-bold text-stone-800">{student.name}</p>
                                                            <p className="truncate text-xs text-stone-500">{student.planType}</p>
                                                        </div>
                                                        {student.isActive === false ? (
                                                            <StatusPill tone="warn">Pausado</StatusPill>
                                                        ) : (
                                                            <StatusPill tone={student.planStatus === 'active' ? 'good' : 'bad'}>
                                                                {student.planStatus === 'active' ? 'Plano ativo' : 'Plano inativo'}
                                                            </StatusPill>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {showModal && (
                <ProfessorModal
                    professor={editingProf}
                    onClose={() => setShowModal(false)}
                    onSave={handleSaveProfessor}
                />
            )}
        </div>
    );
};
