import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { ShieldAlert, Loader2 } from 'lucide-react';

interface AdminProtectProps {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

export const AdminProtect: React.FC<AdminProtectProps> = ({ children, fallback }) => {
    const { currentUser } = useAuth();
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

    useEffect(() => {
        const verifyAdmin = async () => {
            if (!currentUser) {
                setIsAdmin(false);
                return;
            }

            // Double-check with database for security (don't trust local storage only)
            const { data, error } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', currentUser.id)
                .single();

            if (data && data.role === 'admin') {
                setIsAdmin(true);
            } else {
                setIsAdmin(false);
            }
        };

        verifyAdmin();
    }, [currentUser]);

    if (isAdmin === null) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <Loader2 className="animate-spin text-stone-400" size={32} />
            </div>
        );
    }

    if (!isAdmin) {
        return fallback ? (
            <>{fallback}</>
        ) : (
            <div className="min-h-[50vh] flex flex-col items-center justify-center text-center p-8 space-y-4 animate-fade-in">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                    <ShieldAlert size={32} />
                </div>
                <h3 className="text-xl font-bold text-stone-800">Acesso Restrito</h3>
                <p className="text-stone-500 max-w-md">
                    Você não tem permissão para acessar esta área. Se acredita que isso é um erro, contate o administrador do sistema.
                </p>
            </div>
        );
    }

    return <>{children}</>;
};
