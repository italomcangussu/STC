import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Lock, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface AdminLoginProps {
    onSuccess: () => void;
    onClose: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onSuccess, onClose }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // 1. Authenticate with Supabase
            const { data, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (authError) throw authError;

            // 2. Verify 'admin' role explicitly
            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', data.user.id)
                .single();

            if (profile?.role !== 'admin') {
                throw new Error('Acesso negado. Credenciais válidas, mas sem permissão de administrador.');
            }

            // Success
            onSuccess();
        } catch (err: any) {
            setError(err.message || 'Erro ao realizar login');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="bg-stone-900 border border-stone-800 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl animate-zoom-smooth relative">

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-stone-500 hover:text-white transition-colors"
                >
                    <ShieldAlert size={20} />
                </button>

                <div className="p-8">
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-16 h-16 bg-red-900/20 rounded-2xl flex items-center justify-center mb-4 border border-red-900/30 shadow-[0_0_15px_rgba(153,27,27,0.3)]">
                            <Lock size={32} className="text-red-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">Acesso Restrito</h2>
                        <p className="text-stone-400 text-sm mt-1">Área Administrativa</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="ID Administrativo"
                                className="w-full bg-stone-800 border border-stone-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all placeholder:text-stone-600"
                                required
                            />
                        </div>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Chave de Acesso"
                                className="w-full bg-stone-800 border border-stone-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all placeholder:text-stone-600"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300"
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>

                        {error && (
                            <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-xl text-red-200 text-xs flex items-center gap-2">
                                <ShieldAlert size={14} />
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-linear-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold py-3 rounded-xl shadow-lg shadow-red-900/20 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
                        >
                            {loading ? 'Verificando...' : 'Autenticar'}
                        </button>
                    </form>
                </div>

                {/* Security Footer */}
                <div className="bg-black/50 p-4 text-center border-t border-stone-800">
                    <p className="text-[10px] text-stone-600 uppercase tracking-widest font-mono">
                        Secure Connection • Encrypted
                    </p>
                </div>
            </div>
        </div>
    );
};
