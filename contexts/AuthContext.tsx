import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '../types';
import { buildPhoneCandidates, normalizePhoneBr, normalizePhoneDigits, toE164Phone } from '../lib/phoneAuth';

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

    const fetchProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) {
                console.error('Error fetching profile:', error);
                return null;
            }

            const user: User = {
                id: data.id,
                name: data.name,
                email: data.email,
                phone: data.phone || '',
                role: data.role,
                balance: data.balance,
                avatar: data.avatar_url,
                category: data.category,
                isProfessor: data.is_professor,
                isActive: data.is_active,
                age: data.age
            };
            return user;
        } catch (err) {
            console.error('Unexpected error fetching profile:', err);
            return null;
        }
    };

    useEffect(() => {
        let mounted = true;

        const handleUserSession = async (session: any) => {
            if (session?.user) {
                const profile = await fetchProfile(session.user.id);
                if (mounted && profile) {
                    setCurrentUser(profile);
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
            const profile = await fetchProfile(data.user.id);
            if (profile) {
                setCurrentUser(profile);
                return { success: true };
            }

            await supabase.auth.signOut();
            return { success: false, error: 'Erro ao carregar perfil. Verifique seu cadastro.' };
        }

        return { success: false, error: 'Erro desconhecido.' };
    };

    const startPhoneOtp = async (phone: string): Promise<AuthActionResult> => {
        const normalizedPhone = normalizePhoneBr(phone);
        if (!normalizedPhone) {
            return { success: false, error: 'Telefone inválido.' };
        }

        const phoneCandidates = buildPhoneCandidates(phone);

        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, name, email, phone, role, is_active')
            .in('phone', phoneCandidates)
            .limit(1);

        if (profileError) {
            return { success: false, error: 'Erro ao consultar cadastro. Tente novamente.' };
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

        if (!profile.is_active) {
            return {
                success: false,
                needsApproval: true,
                error: 'Acesso pendente de aprovação pelo administrador.'
            };
        }

        const otpPhone = toE164Phone(profile.phone || normalizedPhone);

        const { error: otpError } = await supabase.auth.signInWithOtp({
            phone: otpPhone,
            options: {
                shouldCreateUser: false,
                channel: 'sms'
            }
        });

        if (otpError) {
            const msg = otpError.message?.toLowerCase?.() || '';
            if (msg.includes('not found') || msg.includes('user_not_found')) {
                return {
                    success: false,
                    error: 'Conta ainda não provisionada para OTP. Use o login legado.'
                };
            }

            return {
                success: false,
                error: otpError.message || 'Não foi possível enviar o código OTP.'
            };
        }

        return {
            success: true,
            message: 'Código OTP enviado por SMS.',
            otpPhone
        };
    };

    const verifyPhoneOtp = async (phone: string, token: string): Promise<AuthActionResult> => {
        const otpPhone = toE164Phone(phone);
        if (!otpPhone || !token?.trim()) {
            return { success: false, error: 'Telefone e código OTP são obrigatórios.' };
        }

        const { data, error } = await supabase.auth.verifyOtp({
            phone: otpPhone,
            token: token.trim(),
            type: 'sms'
        });

        if (error) {
            return { success: false, error: error.message || 'Código inválido ou expirado.' };
        }

        if (!data.user) {
            return { success: false, error: 'Sessão não criada após validação do OTP.' };
        }

        const profile = await fetchProfile(data.user.id);
        if (!profile) {
            await supabase.auth.signOut();
            return { success: false, error: 'Usuário autenticado, mas sem perfil. Contate o administrador.' };
        }

        if (!profile.isActive) {
            await supabase.auth.signOut();
            return { success: false, needsApproval: true, error: 'Acesso pendente de aprovação.' };
        }

        setCurrentUser(profile);
        return { success: true };
    };

    const submitAccessRequest = async (formData: AccessRequestInput): Promise<AuthActionResult> => {
        const name = (formData.name || '').trim();
        const email = (formData.email || '').trim();
        const phoneDigits = normalizePhoneDigits(formData.phone || '');
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

        const payload = {
            name,
            phone: phoneDigits,
            phone_normalized: normalizedPhone,
            email: email || null,
            status: 'pending',
            rejection_reason: null,
            decided_by: null,
            decided_at: null
        };

        const { error } = await supabase
            .from('access_requests')
            .upsert(payload, { onConflict: 'phone_normalized' });

        if (error) {
            return { success: false, error: error.message || 'Erro ao enviar solicitação.' };
        }

        return {
            success: true,
            message: 'Solicitação enviada com sucesso. Aguarde aprovação do administrador.'
        };
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

        if (!profile.email) {
            await supabase.from('profiles').update({ email: loginEmail }).eq('id', profile.id);
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email: loginEmail,
            password: generatedPassword,
        });

        if (error) {
            const { error: signUpError } = await supabase.auth.signUp({
                email: loginEmail,
                password: generatedPassword,
                options: {
                    data: {
                        name: profile.name,
                        phone: normalizedPhone
                    }
                }
            });

            if (signUpError) {
                return {
                    success: false,
                    error: `Login legado falhou: ${error.message}. Cadastro legado falhou: ${signUpError.message}`
                };
            }

            const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({
                email: loginEmail,
                password: generatedPassword,
            });

            if (retryError) {
                return { success: false, error: 'Erro ao autenticar após cadastro legado.' };
            }

            if (retryData.user) {
                if (profile.id !== retryData.user.id) {
                    await supabase.from('profiles').update({ id: retryData.user.id }).eq('id', profile.id);
                }
                const freshProfile = await fetchProfile(retryData.user.id);
                if (freshProfile) {
                    setCurrentUser(freshProfile);
                    return { success: true };
                }
                return { success: false, error: 'Login legado realizado, mas erro ao carregar perfil.' };
            }
        }

        if (data?.user) {
            const fetchedProfile = await fetchProfile(data.user.id);
            if (fetchedProfile) {
                setCurrentUser(fetchedProfile);
                return { success: true };
            }
            return { success: false, error: 'Login legado realizado, mas erro ao carregar perfil.' };
        }

        return { success: false, error: 'Erro desconhecido no login legado.' };
    };

    const signInWithPhoneLegacy = async (phone: string): Promise<AuthActionResult> => {
        const phoneCandidates = buildPhoneCandidates(phone);

        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .in('phone', phoneCandidates)
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

            const profile = await fetchProfile(data.user.id);
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
