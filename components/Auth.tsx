import React, { useState } from 'react';
import { Trophy, Mail, Lock, User, Phone, AlertCircle, Loader2, CheckCircle2, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const Auth: React.FC = () => {
    const { signInWithEmail, signInWithPhone, signUpWithEmail } = useAuth();

    // UI State
    const [isAdminMode, setIsAdminMode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [infoMsg, setInfoMsg] = useState('');

    // Form Data
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handlePhoneLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!phone.trim()) return;
        setLoading(true);
        setErrorMsg('');
        setInfoMsg('');

        try {
            const res = await signInWithPhone(phone);
            if (!res.success) {
                if (res.needsApproval) {
                    setInfoMsg('Seu acesso está pendente de aprovação pelo administrador.');
                } else {
                    setErrorMsg(res.error || 'Erro ao entrar.');
                }
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Erro inesperado.');
        } finally {
            setLoading(false);
        }
    };

    const handleAdminLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setErrorMsg('');

        try {
            const res = await signInWithEmail(email, password);
            if (!res.success) {
                setErrorMsg(res.error || 'Erro ao entrar.');
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Erro inesperado.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-saibro-50 flex flex-col items-center justify-center p-6 bg-clay-pattern">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-saibro-100">
                <div className="bg-saibro-600 p-8 text-center relative overflow-hidden">
                    <div className="absolute -top-10 -left-10 w-32 h-32 bg-white/10 rounded-full" />
                    <div className="absolute top-10 right-10 w-16 h-16 bg-white/10 rounded-full" />

                    <div className="inline-block p-4 bg-white/20 backdrop-blur-md rounded-2xl shadow-lg mb-4">
                        <img
                            src="https://smztsayzldjmkzmufqcz.supabase.co/storage/v1/object/public/logoapp/SOBRAL.zip%20-%201.png"
                            alt="STC Logo"
                            className="w-20 h-auto object-contain drop-shadow-md"
                        />
                    </div>
                    <h1 className="text-3xl font-bold text-white">STC Play</h1>
                    <p className="text-saibro-100 mt-1">Sua arena de tênis em um só lugar</p>
                </div>

                <div className="p-8">
                    {!isAdminMode ? (
                        /* PHONE LOGIN (DEFAULT FOR SÓCIOS) */
                        <>
                            <div className="mb-6 text-center">
                                <h2 className="text-xl font-bold text-stone-800">Boas-vindas!</h2>
                                <p className="text-stone-500 text-sm mt-1">
                                    Digite seu telefone cadastrado para entrar.
                                </p>
                            </div>

                            <form onSubmit={handlePhoneLogin} className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-stone-500 uppercase ml-1">Celular</label>
                                    <div className="relative">
                                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                                        <input
                                            type="tel"
                                            required
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-saibro-500 transition-all text-sm"
                                            placeholder="(88) 99999-9999"
                                        />
                                    </div>
                                </div>

                                {errorMsg && (
                                    <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm flex items-center gap-2">
                                        <AlertCircle size={16} />
                                        {errorMsg}
                                    </div>
                                )}

                                {infoMsg && (
                                    <div className="bg-amber-50 border border-amber-200 text-amber-700 p-3 rounded-xl text-sm flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        {infoMsg}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-4 bg-saibro-600 hover:bg-saibro-700 disabled:bg-saibro-400 text-white font-bold rounded-xl shadow-lg shadow-orange-200 transition-all flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="animate-spin" size={20} /> : 'Entrar'}
                                </button>
                            </form>

                            <div className="mt-6 flex flex-col gap-2 text-center">
                                <button
                                    onClick={() => setIsAdminMode(true)}
                                    className="text-stone-400 hover:text-stone-600 text-xs font-medium flex items-center justify-center gap-1"
                                >
                                    <Shield size={14} /> Área do Administrador
                                </button>
                            </div>
                        </>
                    ) : (
                        /* ADMIN LOGIN (EMAIL + PASSWORD) */
                        <>
                            <div className="mb-6 text-center">
                                <h2 className="text-xl font-bold text-stone-800 flex items-center justify-center gap-2">
                                    <Shield size={20} /> Acesso Admin
                                </h2>
                                <p className="text-stone-500 text-sm mt-1">
                                    Entre com seu email e senha de administrador.
                                </p>
                            </div>

                            <form onSubmit={handleAdminLogin} className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-stone-500 uppercase ml-1">Email</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                                        <input
                                            type="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-saibro-500 transition-all text-sm"
                                            placeholder="admin@sct.com"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-stone-500 uppercase ml-1">Senha</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                                        <input
                                            type="password"
                                            required
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-saibro-500 transition-all text-sm"
                                            placeholder="******"
                                        />
                                    </div>
                                </div>

                                {errorMsg && (
                                    <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm flex items-center gap-2">
                                        <AlertCircle size={16} />
                                        {errorMsg}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-4 bg-stone-800 hover:bg-stone-900 disabled:bg-stone-400 text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="animate-spin" size={20} /> : 'Entrar como Admin'}
                                </button>
                            </form>

                            <div className="mt-6 text-center">
                                <button
                                    onClick={() => { setIsAdminMode(false); setErrorMsg(''); }}
                                    className="text-saibro-600 hover:text-saibro-700 text-sm font-medium hover:underline"
                                >
                                    ← Voltar para login de sócio
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
