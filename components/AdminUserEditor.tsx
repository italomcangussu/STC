import React, { useState } from 'react';
import { User } from '../types';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notifications';
import { useConfirm } from '../hooks/useConfirm';
import { Save, Loader2 } from 'lucide-react';
import { getNowInFortaleza } from '../utils';
import { Sheet } from './ui/Sheet';
import { AdminField, adminBtnGhost, adminBtnPrimary, adminInputCls } from './admin/ui';

interface AdminUserEditorProps {
    user: User;
    onClose: () => void;
    onSave: () => void;
}

type Role = 'socio' | 'admin' | 'lanchonete';

const ROLE_LABEL: Record<Role, string> = { socio: 'Sócio', admin: 'Administrador', lanchonete: 'Lanchonete' };
const ROLE_HINT: Record<Role, string> = {
    socio: 'Acesso comum de sócio.',
    admin: 'Acesso total: painel administrativo, financeiro e ajustes de ranking.',
    lanchonete: 'Acesso restrito à lanchonete.',
};

const CATEGORIES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe', 'Iniciante', 'Fem C', 'Fem B', 'Fem A'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const Section: React.FC<{ title: string; tone?: 'neutral' | 'danger' | 'warn'; children: React.ReactNode }> = ({ title, tone = 'neutral', children }) => {
    const cls = { neutral: 'border-stone-100 bg-stone-50/60', danger: 'border-red-100 bg-red-50/40', warn: 'border-amber-100 bg-amber-50/50' }[tone];
    const titleCls = { neutral: 'text-stone-700', danger: 'text-red-800', warn: 'text-amber-800' }[tone];
    return (
        <section className={`space-y-3 rounded-2xl border p-4 ${cls}`}>
            <h3 className={`text-sm font-black uppercase tracking-wider ${titleCls}`}>{title}</h3>
            {children}
        </section>
    );
};

/** Foto do sócio; sem link (ou com link quebrado) mostra a inicial em vez de uma imagem de outro site. */
const AvatarPreview: React.FC<{ url: string; name: string }> = ({ url, name }) => {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const showImage = url.trim() && failedUrl !== url;
    return showImage ? (
        <img src={url} alt="" onError={() => setFailedUrl(url)} className="h-16 w-16 shrink-0 rounded-2xl border-2 border-white object-cover shadow-md" />
    ) : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-saibro-100 text-2xl font-black text-saibro-700 shadow-md" aria-hidden>
            {(name.trim().charAt(0) || '?').toUpperCase()}
        </span>
    );
};

export const AdminUserEditor: React.FC<AdminUserEditorProps> = ({ user, onClose, onSave }) => {
    const confirm = useConfirm();
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    // Form States
    const [name, setName] = useState(user.name || '');
    const [email, setEmail] = useState(user.email || '');
    const [phone, setPhone] = useState(user.phone || '');
    const [role, setRole] = useState<Role>((user.role as Role) || 'socio');
    const [avatarUrl, setAvatarUrl] = useState(user.avatar || '');
    const [category, setCategory] = useState(user.category || '');

    // Points Adjustment
    const [pointsAdjustment, setPointsAdjustment] = useState('');
    const [adjustmentReason, setAdjustmentReason] = useState('Ajuste Manual de Admin');

    const pointsDelta = /^[+-]?\d+$/.test(pointsAdjustment.trim()) ? parseInt(pointsAdjustment.trim(), 10) : NaN;
    const hasPointsText = pointsAdjustment.trim() !== '';
    const willAdjustPoints = !isNaN(pointsDelta) && pointsDelta !== 0;

    const errors = {
        name: name.trim().length < 2 ? 'Informe o nome (mínimo 2 letras).' : undefined,
        email: email.trim() && !EMAIL_RE.test(email.trim()) ? 'E-mail inválido. Confira o formato (nome@dominio.com).' : undefined,
        points: hasPointsText && isNaN(pointsDelta) ? 'Digite um número inteiro (ex.: 100 ou -50).' : undefined,
        reason: willAdjustPoints && !adjustmentReason.trim() ? 'Explique o motivo: ele fica registrado no histórico do atleta.' : undefined,
    };
    const hasErrors = Object.values(errors).some(Boolean);

    const profileDirty =
        name !== (user.name || '') || email !== (user.email || '') || phone !== (user.phone || '') ||
        role !== (user.role || 'socio') || avatarUrl !== (user.avatar || '') || category !== (user.category || '');
    const dirty = profileDirty || hasPointsText;

    const show = (msg: string | undefined) => (submitted ? msg : undefined);

    // Fechar com dados digitados pede confirmação: o toque no ✕, o Escape e o gesto de voltar
    // passam todos por aqui, então nenhum deles joga fora o formulário sem avisar.
    const requestClose = async () => {
        if (loading) return;
        if (dirty && !await confirm({
            title: 'Descartar alterações?',
            description: 'O que você mudou neste cadastro ainda não foi salvo.',
            confirmLabel: 'Descartar',
            cancelLabel: 'Continuar editando',
        })) return;
        onClose();
    };

    const handleSave = async () => {
        setSubmitted(true);
        if (hasErrors) return;

        if (role !== (user.role || 'socio')) {
            const from = ROLE_LABEL[(user.role as Role) || 'socio'];
            const to = ROLE_LABEL[role];
            if (!await confirm({
                title: `Mudar ${name.trim()} de ${from} para ${to}?`,
                description: role === 'admin'
                    ? 'Esta pessoa passa a ter acesso total ao painel administrativo, incluindo financeiro e ajustes de ranking.'
                    : user.role === 'admin'
                        ? 'Esta pessoa perde o acesso ao painel administrativo.'
                        : 'As telas que esta pessoa vê mudam na próxima vez que ela abrir o app.',
                confirmLabel: 'Mudar função',
            })) return;
        }

        setLoading(true);
        let profileSaved = false;
        try {
            // 1. Update Profile (God Mode allows role update)
            const { error: profileError } = await supabase
                .from('profiles')
                .update({
                    name: name.trim(),
                    email: email.trim(), // Note: Syncing auth email is complex, this updates profile only usually
                    phone: phone.trim(),
                    role,
                    avatar_url: avatarUrl.trim(),
                    category
                })
                .eq('id', user.id);

            if (profileError) throw profileError;
            profileSaved = true;

            // 2. Handle Point Adjustment (if any)
            if (willAdjustPoints) {
                const { error: pointsError } = await supabase
                    .from('point_history')
                    .insert({
                        user_id: user.id,
                        amount: pointsDelta,
                        event_type: 'Manual Adjustment',
                        description: adjustmentReason.trim(),
                        earned_date: getNowInFortaleza().toISOString()
                    });

                if (pointsError) throw pointsError;
            }

            // Success
            onSave();
            onClose();
        } catch (error) {
            // Com o cadastro já gravado e só os pontos pendentes, dizer isso evita que a pessoa
            // ache que nada foi salvo (ou que refaça tudo por engano).
            notify.failure(
                error,
                profileSaved
                    ? 'Os dados foram salvos, mas o ajuste de pontos não foi registrado. Toque em Salvar para tentar de novo.'
                    : 'Não foi possível salvar as alterações do atleta.',
                { event: 'admin_user_save_failed', userId: user.id },
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Sheet
            open
            wide
            onClose={requestClose}
            closeOnBackdrop={false}
            title="Editar cadastro"
            subtitle={`${user.name} · ID ${user.id.slice(0, 8)}`}
            footer={<>
                <button type="button" className={adminBtnGhost} onClick={requestClose} disabled={loading}>Cancelar</button>
                <button type="button" className={`${adminBtnPrimary} sm:min-w-48`} onClick={handleSave} disabled={loading || !dirty}>
                    {loading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                    Salvar alterações
                </button>
            </>}
        >
            <div className="flex items-center gap-3">
                <AvatarPreview url={avatarUrl} name={name} />
                <div className="min-w-0 flex-1">
                    <AdminField label="Nome completo" error={show(errors.name)}>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className={adminInputCls}
                            placeholder="Nome do usuário"
                            autoComplete="off"
                        />
                    </AdminField>
                </div>
            </div>

            <AdminField label="Link da foto (opcional)" hint="Endereço de uma imagem na internet. Sem link, aparece a inicial do nome.">
                <input
                    type="url"
                    inputMode="url"
                    value={avatarUrl}
                    onChange={e => setAvatarUrl(e.target.value)}
                    className={`${adminInputCls} font-mono text-xs`}
                    placeholder="https://..."
                    autoComplete="off"
                    autoCapitalize="none"
                />
            </AdminField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Section title="Contato">
                    <AdminField label="E-mail" error={show(errors.email)}>
                        <input
                            type="email"
                            inputMode="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className={adminInputCls}
                            autoComplete="off"
                            autoCapitalize="none"
                        />
                    </AdminField>
                    <AdminField label="Telefone">
                        <input
                            type="tel"
                            inputMode="tel"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            className={adminInputCls}
                            autoComplete="off"
                        />
                    </AdminField>
                </Section>

                <Section title="Permissões" tone={role === 'admin' ? 'danger' : 'neutral'}>
                    <AdminField label="Função" hint={ROLE_HINT[role]}>
                        <select value={role} onChange={e => setRole(e.target.value as Role)} className={`${adminInputCls} font-bold`}>
                            {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                    </AdminField>
                    <AdminField label="Categoria">
                        <select value={category} onChange={e => setCategory(e.target.value)} className={adminInputCls}>
                            <option value="">Sem classe</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </AdminField>
                </Section>
            </div>

            <Section title="Ajuste de ranking" tone="warn">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
                    <AdminField label="Pontos (+/−)" error={show(errors.points)}>
                        <input
                            type="number"
                            step={1}
                            value={pointsAdjustment}
                            onChange={e => setPointsAdjustment(e.target.value)}
                            placeholder="+100"
                            className={`${adminInputCls} text-lg font-black`}
                        />
                    </AdminField>
                    <AdminField label="Motivo" error={show(errors.reason)}>
                        <input
                            type="text"
                            value={adjustmentReason}
                            onChange={e => setAdjustmentReason(e.target.value)}
                            className={adminInputCls}
                            autoComplete="off"
                        />
                    </AdminField>
                </div>
                {willAdjustPoints && (
                    <p className="text-sm font-medium text-amber-800" role="status">
                        Ao salvar, {pointsDelta > 0 ? `+${pointsDelta}` : pointsDelta} pontos entram no histórico de {name.trim() || 'este atleta'}.
                    </p>
                )}
            </Section>
        </Sheet>
    );
};
