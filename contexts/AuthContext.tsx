import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '../types';

interface AuthContextType {
    currentUser: User | null;
    loading: boolean;
    signInWithEmail: (email: string, password: string) => Promise<{ success: boolean; message?: string; error?: any }>;
    signInWithPhone: (phone: string) => Promise<{ success: boolean; message?: string; error?: any; needsApproval?: boolean }>;
    signUpWithEmail: (data: { name: string; phone: string; email: string; password: string }) => Promise<{ success: boolean; message?: string; error?: any }>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    currentUser: null,
    loading: true,
    signInWithEmail: async () => ({ success: false, error: 'Not implemented' }),
    signInWithPhone: async () => ({ success: false, error: 'Not implemented' }),
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

        // Function to handle profile fetching and state update
        const handleUserSession = async (session: any) => {
            if (session?.user) {
                // If we already have the user loaded and ID matches, skip fetch (optional optimization)
                // However, since we can't access latest 'currentUser' state comfortably in this closure without deps,
                // we'll fetch to ensure freshness, but handle errors gracefully.
                const profile = await fetchProfile(session.user.id);
                if (mounted) {
                    if (profile) {
                        setCurrentUser(profile);
                    } else {
                        // If profile fetch fails but session exists, we should decide.
                        // For now, keep null to prevent partial state, OR keep previous user if exists?
                        // Let's stick to safe behavior: if fetch succeeds, update.
                    }
                }
            } else if (mounted) {
                setCurrentUser(null);
            }
            if (mounted) setLoading(false);
        };

        // 1. Initial Session Load
        supabase.auth.getSession().then(({ data: { session } }) => {
            handleUserSession(session);
        });

        // 2. Realtime Auth Changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            // Only react to meaningful changes
            if (_event === 'SIGNED_OUT') {
                if (mounted) {
                    setCurrentUser(null);
                    setLoading(false);
                }
            } else if (_event === 'SIGNED_IN' || _event === 'TOKEN_REFRESHED' || _event === 'INITIAL_SESSION') {
                handleUserSession(session);
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    const signInWithEmail = async (email: string, password: string) => {
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
            } else {
                await supabase.auth.signOut();
                return { success: false, error: 'Erro ao carregar perfil. Verifique seu cadastro.' };
            }
        }

        return { success: false, error: 'Erro desconhecido.' };
    };

    const signInWithPhone = async (phone: string) => {
        // Clean phone number
        const cleanPhone = phone.replace(/\D/g, '');

        // 1. Look up profile by phone
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('phone', cleanPhone)
            .single();

        if (profileError || !profile) {
            // Try with formatted versions
            const { data: profile2 } = await supabase
                .from('profiles')
                .select('*')
                .or(`phone.eq.${cleanPhone},phone.eq.${phone}`)
                .limit(1)
                .single();

            if (!profile2) {
                return { success: false, error: 'Telefone não encontrado. Solicite acesso ao administrador.' };
            }
            // Use profile2
            return await processPhoneLogin(profile2);
        }

        return await processPhoneLogin(profile);
    };

    const processPhoneLogin = async (profile: any) => {
        // 2. Check is_active
        if (!profile.is_active) {
            return { success: false, error: 'Acesso pendente de aprovação pelo administrador.', needsApproval: true };
        }

        // 3. Generate password from phone
        const cleanPhone = profile.phone?.replace(/\D/g, '') || '';
        const generatedPassword = `sct${cleanPhone}2024`;

        // 4. Try to sign in with email + generated password
        const { data, error } = await supabase.auth.signInWithPassword({
            email: profile.email,
            password: generatedPassword,
        });

        if (error) {
            console.error('Phone Login: SignIn error:', error.message);

            // User might not exist in auth yet - try to create
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                email: profile.email,
                password: generatedPassword,
            });

            if (signUpError) {
                console.error('Phone Login: SignUp error:', signUpError.message);
                // RETURNING RAW ERROR FOR DEBUGGING
                return { success: false, error: `Login falhou: ${error?.message}. Cadastro falhou: ${signUpError.message}` };
            }

            // Try login again after signup
            const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({
                email: profile.email,
                password: generatedPassword,
            });

            if (retryError) {
                console.error('Phone Login: Retry SignIn error:', retryError.message);
                return { success: false, error: 'Erro ao autenticar após cadastro.' };
            }

            if (retryData.user) {
                // Update profile ID to match auth user ID if needed
                if (profile.id !== retryData.user.id) {
                    await supabase.from('profiles').update({ id: retryData.user.id }).eq('id', profile.id);
                }
                const freshProfile = await fetchProfile(retryData.user.id);
                setCurrentUser(freshProfile);
                return { success: true };
            }
        }

        if (data?.user) {
            const fetchedProfile = await fetchProfile(data.user.id);
            if (fetchedProfile) {
                setCurrentUser(fetchedProfile);
                return { success: true };
            } else {
                console.error('Phone Login: Profile fetch failed for User ID:', data.user.id);
                return { success: false, error: 'Login realizado, mas erro ao carregar perfil. Contate o admin.' };
            }
        }

        return { success: false, error: 'Erro desconhecido.' };
    };

    const signUpWithEmail = async (formData: { name: string; phone: string; email: string; password: string }) => {
        // 1. Sign Up
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
            // 2. Create Profile immediately
            const { error: profError } = await supabase.from('profiles').insert({
                id: data.user.id,
                name: formData.name,
                email: formData.email,
                phone: formData.phone,
                role: 'socio',
                is_active: true // Auto-activate
            });

            if (profError) {
                console.error('Profile creation error:', profError);
                // If profile fails, maybe user exists or RLS issue?
                // Try to fetch anyway
            }

            const profile = await fetchProfile(data.user.id);
            setCurrentUser(profile);
            return { success: true };
        }

        return { success: false, error: "Erro ao criar conta." };
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        setCurrentUser(null);
    };

    return (
        <AuthContext.Provider value={{ currentUser, loading, signInWithEmail, signInWithPhone, signUpWithEmail, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
