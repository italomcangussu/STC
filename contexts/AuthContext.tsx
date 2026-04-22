import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '../types';
import { buildPhoneCandidates, normalizePhoneBr, normalizePhoneDigits } from '../lib/phoneAuth';

interface AuthActionResult {
    success: boolean;
    message?: string;
    error?: any;
    needsApproval?: boolean;
    phoneNotFound?: boolean;
    needsRequest?: boolean;
    otpPhone?: string;
    requestId?: string;
}

interface AccessRequestInput {
    name: string;
    phone: string;
    email?: string;
}

interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    signInWithEmail: (email: string, password: string) => Promise<AuthActionResult>;
    startPhoneOtp: (phone: string) => Promise<AuthActionResult>;
    verifyPhoneOtp: (phone: string, token: string) => Promise<AuthActionResult>;
    submitAccessRequest: (data: AccessRequestInput) => Promise<AuthActionResult>;
    signInWithPhoneLegacy: (phone: string) => Promise<AuthActionResult>;
    signUpWithEmail: (data: { name: string; phone: string; email: string; password: string }) => Promise<AuthActionResult>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    currentUser: null,
    loading: true,
    signInWithEmail: async () => ({ success: false, error: 'Not implemented' }),
    startPhoneOtp: async () => ({ success: false, error: 'Not implemented' }),
    verifyPhoneOtp: async () => ({ success: false, error: 'Not implemented' }),
    submitAccessRequest: async () => ({ success: false, error: 'Not implemented' }),
    signInWithPhoneLegacy: async () => ({ success: false, error: 'Not implemented' }),
    signUpWithEmail: async () => ({ success: false, error: 'Not implemented' }),
    signOut: async () => { },
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    const mapProfileToUser = (data: any): User => ({
        id: data.id,
        name: data.name,
        email: data.email || '',
        phone: data.phone || '',
        role: data.role,
        balance: data.balance,
        avatar: data.avatar_url,
        category: data.category,
        isProfessor: data.is_professor,
        isActive: data.is_active,
        age: data.age
    });

    const fetchProfileById = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) {
                return null;
            }

            return mapProfileToUser(data);
        } catch (err) {
            console.error('Unexpected error fetching profile:', err);
            return null;
        }
    };

    const fetchProfileByPhone = async (phoneCandidates: string[]) => {
        if (phoneCandidates.length === 0) return null;

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .in('phone', phoneCandidates)
            .order('is_active', { ascending: false })
            .limit(5);

        if (error) {
            return null;
        }

        const selected = data?.[0];
        return selected ? mapProfileToUser(selected) : null;
    };

    const resolveProfileFromAuthUser = async (authUser: any, explicitPhone?: string) => {
        if (!authUser) return null;

        const byId = await fetchProfileById(authUser.id);
        if (byId) return byId;

        const phoneSet = new Set<string>();
        const addPhone = (value?: string | null) => {
            if (!value) return;
            buildPhoneCandidates(value).forEach(candidate => phoneSet.add(candidate));
        };

        addPhone(explicitPhone);
        addPhone(authUser.phone);
        addPhone(authUser.user_metadata?.phone);

        const legacyEmail = String(authUser.email || '').trim();
        const match = legacyEmail.match(/^(\d{10,13})@reserva\.com$/i);
        if (match?.[1]) {
            addPhone(match[1]);
        }

        return fetchProfileByPhone(Array.from(phoneSet));
    };

    const upsertPendingAccessRequest = async (formData: AccessRequestInput): Promise<AuthActionResult> => {
        const name = (formData.name || '').trim();
        const email = (formData.email || '').trim();
        const normalizedPhone = normalizePhoneBr(formData.phone || '');

        if (!name) {
            return { success: false, error: 'Nome é obrigatório.' };
        }

        if (!normalizedPhone) {
            return { success: false, error: 'Telefone inválido.' };
        }

        const payload = {
            name,
            phone: normalizedPhone,
            phone_normalized: normalizedPhone,
            email: email || null,
            status: 'pending'
        };

        const { error: insertError } = await supabase
            .from('access_requests')
            .insert(payload);

        if (!insertError) {
            return {
                success: true,
                message: 'Solicitação enviada com sucesso. Aguarde aprovação do administrador.'
            };
        }

        if (insertError.code === '23505') {
            const { error: updateError } = await supabase
                .from('access_requests')
                .update({
                    name,
                    phone: normalizedPhone,
                    email: email || null,
                    status: 'pending',
                    rejection_reason: null,
                    decided_by: null,
                    decided_at: null
                })
                .eq('phone_normalized', normalizedPhone)
                .in('status', ['pending', 'rejected']);

            if (!updateError) {
                return {
                    success: true,
                    message: 'Solicitação já existente foi atualizada e está pendente de análise.'
                };
            }

            return {
                success: true,
                message: 'Já existe uma solicitação para este telefone. Aguarde análise do administrador.'
            };
        }

        return { success: false, error: insertError.message || 'Erro ao enviar solicitação.' };
    };

    useEffect(() => {
        let mounted = true;

        const handleUserSession = async (session: any) => {
            if (session?.user) {
                const profile = await resolveProfileFromAuthUser(session.user);
                if (mounted && profile) {
                    setCurrentUser(profile);
                } else if (mounted) {
                    setCurrentUser(null);
                }
            } else if (mounted) {
                setCurrentUser(null);
            }
            if (mounted) setLoading(false);
        };

        supabase.auth.getSession().then(({ data: { session } }) => {
            handleUserSession(session);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                if (mounted) {
                    setCurrentUser(null);
                    setLoading(false);
                }
            } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
                handleUserSession(session);
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
// eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const signInWithEmail = async (email: string, password: string): Promise<AuthActionResult> => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            return { success: false, error: error.message };
        }

        if (data.user) {
            const profile = await resolveProfileFromAuthUser(data.user);
            if (profile) {
                setCurrentUser(profile);
                return { success: true };
            }

            await supabase.auth.signOut();
            return { success: false, error: 'Erro ao carregar perfil. Verifique seu cadastro.' };
        }

        return { success: false, error: 'Erro desconhecido.' };
    };

    const startPhoneOtp = async (_phone: string): Promise<AuthActionResult> => {
        return {
            success: false,
            error: 'OTP desativado. Use login legado por telefone.'
        };
    };

    const verifyPhoneOtp = async (_phone: string, _token: string): Promise<AuthActionResult> => {
        return {
            success: false,
            error: 'OTP desativado. Use login legado por telefone.'
        };
    };

    const submitAccessRequest = async (formData: AccessRequestInput): Promise<AuthActionResult> => {
        const name = (formData.name || '').trim();
        const normalizedPhone = normalizePhoneBr(formData.phone || '');

        if (!name) {
            return { success: false, error: 'Nome é obrigatório.' };
        }

        if (!normalizedPhone) {
            return { success: false, error: 'Telefone inválido.' };
        }

        const phoneCandidates = buildPhoneCandidates(formData.phone || '');

        const { data: existingProfiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, is_active')
            .in('phone', phoneCandidates)
            .limit(1);

        if (profileError) {
            return { success: false, error: 'Erro ao validar cadastro existente.' };
        }

        if (existingProfiles && existingProfiles.length > 0 && existingProfiles[0].is_active) {
            return { success: false, error: 'Este telefone já está cadastrado no clube.' };
        }

        return upsertPendingAccessRequest(formData);
    };

    const processLegacyPhoneLogin = async (profile: any): Promise<AuthActionResult> => {
        if (!profile.is_active) {
            return { success: false, error: 'Acesso pendente de aprovação pelo administrador.', needsApproval: true };
        }

        const cleanPhone = normalizePhoneDigits(profile.phone || '');
        const generatedPassword = `sct${cleanPhone}2024`;
        const normalizedPhone = normalizePhoneBr(profile.phone || cleanPhone);
        const fallbackEmail = `${normalizedPhone}@reserva.com`;
        const loginEmail = profile.email || fallbackEmail;

        if (!profile.email || !String(profile.email).trim()) {
            await supabase.from('profiles').update({ email: loginEmail }).eq('id', profile.id);
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email: loginEmail,
            password: generatedPassword,
        });

        if (error) {
            if (error.status === 429) {
                return {
                    success: false,
                    error: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.'
                };
            }

            const requestResult = await upsertPendingAccessRequest({
                name: profile.name || 'Atleta',
                phone: normalizedPhone,
                email: profile.email || undefined
            });

            if (requestResult.success) {
                return {
                    success: false,
                    needsApproval: true,
                    error: 'Telefone ainda não habilitado no acesso legado. Pedido enviado para aprovação do administrador.'
                };
            }

            return {
                success: false,
                needsApproval: true,
                error: requestResult.error || 'Acesso não habilitado. Solicite aprovação do administrador.'
            };
        }

        if (data?.user) {
            const fetchedProfile = await resolveProfileFromAuthUser(data.user, normalizedPhone);
            if (fetchedProfile) {
                setCurrentUser(fetchedProfile);
                return { success: true };
            }

            await supabase.auth.signOut();
            return { success: false, error: 'Login realizado, mas perfil não encontrado para este telefone.' };
        }

        return { success: false, error: 'Erro desconhecido no login legado.' };
    };

    const signInWithPhoneLegacy = async (phone: string): Promise<AuthActionResult> => {
        const phoneCandidates = buildPhoneCandidates(phone);

        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .in('phone', phoneCandidates)
            .order('is_active', { ascending: false })
            .limit(1);

        if (profileError) {
            return { success: false, error: 'Erro ao consultar perfil para login legado.' };
        }

        const profile = profiles?.[0];
        if (!profile) {
            return {
                success: false,
                phoneNotFound: true,
                needsRequest: true,
                error: 'Telefone não encontrado. Solicite acesso ao administrador.'
            };
        }

        return processLegacyPhoneLogin(profile);
    };

    const signUpWithEmail = async (formData: { name: string; phone: string; email: string; password: string }): Promise<AuthActionResult> => {
        const { data, error } = await supabase.auth.signUp({
            email: formData.email,
            password: formData.password,
            options: {
                data: {
                    name: formData.name,
                    phone: formData.phone
                }
            }
        });

        if (error) {
            if (error.message.includes('registered')) {
                return { success: false, error: 'Email já cadastrado.' };
            }
            return { success: false, error: error.message };
        }

        if (data.user) {
            const { error: profError } = await supabase.from('profiles').insert({
                id: data.user.id,
                name: formData.name,
                email: formData.email,
                phone: normalizePhoneBr(formData.phone),
                role: 'socio',
                is_active: true
            });

            if (profError) {
                console.error('Profile creation error:', profError);
            }

            const profile = await resolveProfileFromAuthUser(data.user, formData.phone);
            setCurrentUser(profile);
            return { success: true };
        }

        return { success: false, error: 'Erro ao criar conta.' };
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        setCurrentUser(null);
    };

    return (
        <AuthContext.Provider
            value={{
                currentUser,
                loading,
                signInWithEmail,
                startPhoneOtp,
                verifyPhoneOtp,
                submitAccessRequest,
                signInWithPhoneLegacy,
                signUpWithEmail,
                signOut
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
