import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { supabase } from '../lib/supabase';
import { X, Save, Camera, Shield, Trophy, Mail, Phone, User as UserIcon, AlertTriangle, Loader2, DollarSign } from 'lucide-react';
import { getNowInFortaleza } from '../utils';

interface AdminUserEditorProps {
    user: User;
    onClose: () => void;
    onSave: () => void;
}

export const AdminUserEditor: React.FC<AdminUserEditorProps> = ({ user, onClose, onSave }) => {
    const [loading, setLoading] = useState(false);

    // Form States
    const [name, setName] = useState(user.name || '');
    const [email, setEmail] = useState(user.email || '');
    const [phone, setPhone] = useState(user.phone || '');
    const [role, setRole] = useState(user.role || 'socio');
    const [avatarUrl, setAvatarUrl] = useState(user.avatar || '');
    const [category, setCategory] = useState(user.category || '');

    // Points Adjustment
    const [pointsAdjustment, setPointsAdjustment] = useState('');
    const [adjustmentReason, setAdjustmentReason] = useState('Ajuste Manual de Admin');

    const handleSave = async () => {
        setLoading(true);
        try {
            // 1. Update Profile (God Mode allows role update)
            const { error: profileError } = await supabase
                .from('profiles')
                .update({
                    name,
                    email, // Note: Syncing auth email is complex, this updates profile only usually
                    phone,
                    role,
                    avatar_url: avatarUrl,
                    category
                })
                .eq('id', user.id);

            if (profileError) throw profileError;

            // 2. Handle Point Adjustment (if any)
            const pointsDelta = parseInt(pointsAdjustment);
            if (!isNaN(pointsDelta) && pointsDelta !== 0) {
                const { error: pointsError } = await supabase
                    .from('point_history')
                    .insert({
                        user_id: user.id,
                        amount: pointsDelta,
                        event_type: 'Manual Adjustment',
                        description: adjustmentReason,
                        earned_date: getNowInFortaleza().toISOString()
                    });

                if (pointsError) throw pointsError;
            }

            // Success
            onSave();
            onClose();
        } catch (error: any) {
            console.error('Error updating user:', error);
            alert(`Erro ao salvar: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-60 flex items-start sm:items-center justify-center p-4 sm:p-4 pt-10 sm:pt-4 bg-stone-900/40 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-2xl rounded-[32px] sm:rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[90vh] animate-in slide-in-from-bottom duration-500">

                {/* Header with Glass Effect */}
                <div className="px-8 py-6 border-b border-stone-100/50 bg-white/80 backdrop-blur-xl sticky top-0 z-10 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-black text-stone-800 tracking-tight flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                                <Shield size={20} />
                            </div>
                            God Mode Editor
                        </h2>
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mt-1 ml-14">
                            ID: {user.id.slice(0, 8)}...
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-3 bg-stone-50 hover:bg-stone-100 text-stone-400 hover:text-stone-600 rounded-full transition-all active:scale-90"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-8 space-y-8">

                    {/* Identity Section */}
                    <div className="flex gap-8 items-start">
                        <div className="flex-none">
                            <div className="w-32 h-32 rounded-[32px] bg-stone-100 relative overflow-hidden group border-4 border-white shadow-xl">
                                <img
                                    src={avatarUrl || 'https://via.placeholder.com/150'}
                                    alt="Avatar"
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 cursor-pointer backdrop-blur-sm">
                                    <Camera size={32} className="text-white drop-shadow-md" />
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 space-y-5">
                            <div>
                                <label className="flex items-center gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2">
                                    <UserIcon size={12} /> Nome Completo
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    className="w-full px-5 py-4 bg-stone-50 border-none rounded-2xl text-lg font-bold text-stone-800 focus:ring-2 focus:ring-saibro-500 outline-none transition-all placeholder:text-stone-300"
                                    placeholder="Nome do usuário"
                                />
                            </div>
                            <div>
                                <label className="flex items-center gap-2 text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2">
                                    <Camera size={12} /> Avatar URL
                                </label>
                                <input
                                    type="text"
                                    value={avatarUrl}
                                    onChange={e => setAvatarUrl(e.target.value)}
                                    className="w-full px-5 py-3 bg-stone-50 border-none rounded-2xl text-xs font-mono text-stone-500 focus:ring-2 focus:ring-saibro-500 outline-none transition-all"
                                    placeholder="https://..."
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Contact Info */}
                        <div className="space-y-5 p-6 rounded-[32px] bg-stone-50/50 border border-stone-100">
                            <h3 className="text-sm font-black text-stone-700 uppercase tracking-widest flex items-center gap-2">
                                <Mail size={16} className="text-saibro-500" /> Contato
                            </h3>
                            <div>
                                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Email</label>
                                <input
                                    type="text"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    className="w-full px-4 py-3 bg-white border-none rounded-2xl text-sm font-medium text-stone-600 focus:ring-2 focus:ring-saibro-500 outline-none shadow-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Telefone</label>
                                <input
                                    type="text"
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                    className="w-full px-4 py-3 bg-white border-none rounded-2xl text-sm font-medium text-stone-600 focus:ring-2 focus:ring-saibro-500 outline-none shadow-sm"
                                />
                            </div>
                        </div>

                        {/* System Roles */}
                        <div className="space-y-5 p-6 rounded-[32px] bg-red-50/30 border border-red-100/50">
                            <h3 className="text-sm font-black text-red-800 uppercase tracking-widest flex items-center gap-2">
                                <Shield size={16} /> Permissões
                            </h3>
                            <div>
                                <label className="block text-[10px] font-bold text-red-400 uppercase tracking-wider mb-2">
                                    Função (Role)
                                </label>
                                <div className="relative">
                                    <select
                                        value={role}
                                        onChange={e => setRole(e.target.value as any)}
                                        className="w-full px-4 py-3 bg-white border-none rounded-2xl text-sm font-bold text-red-700 focus:ring-2 focus:ring-red-500 outline-none shadow-sm appearance-none"
                                    >
                                        <option value="socio">Sócio</option>
                                        <option value="admin">Administrador</option>
                                        <option value="lanchonete">Lanchonete</option>
                                    </select>
                                </div>
                                {role === 'admin' && (
                                    <p className="text-[10px] text-red-500 mt-2 font-bold bg-red-100 inline-block px-2 py-1 rounded-lg">
                                        ⚠️ Acesso Total (God Mode)
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-red-400 uppercase tracking-wider mb-2">
                                    Categoria
                                </label>
                                <select
                                    value={category}
                                    onChange={e => setCategory(e.target.value)}
                                    className="w-full px-4 py-3 bg-white border-none rounded-2xl text-sm font-medium text-stone-700 focus:ring-2 focus:ring-red-500 outline-none shadow-sm appearance-none"
                                >
                                    <option value="">Sem classe</option>
                                    <option value="1ª Classe">1ª Classe</option>
                                    <option value="2ª Classe">2ª Classe</option>
                                    <option value="3ª Classe">3ª Classe</option>
                                    <option value="4ª Classe">4ª Classe</option>
                                    <option value="5ª Classe">5ª Classe</option>
                                    <option value="6ª Classe">6ª Classe</option>
                                    <option value="Iniciante">Iniciante</option>
                                    <option value="Fem C">Fem C</option>
                                    <option value="Fem B">Fem B</option>
                                    <option value="Fem A">Fem A</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Points Adjustment */}
                    <div className="p-6 rounded-[32px] bg-amber-50/50 border border-amber-100">
                        <h3 className="text-sm font-black text-amber-700 uppercase tracking-widest flex items-center gap-2 mb-4">
                            <Trophy size={16} /> Ajuste de Ranking
                        </h3>
                        <div className="flex gap-4">
                            <div className="w-1/3">
                                <label className="block text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-2">
                                    Pontos (+/-)
                                </label>
                                <input
                                    type="number"
                                    value={pointsAdjustment}
                                    onChange={e => setPointsAdjustment(e.target.value)}
                                    placeholder="+100"
                                    className="w-full px-4 py-3 bg-white border-none rounded-2xl text-lg font-black text-amber-600 focus:ring-2 focus:ring-amber-500 outline-none shadow-sm placeholder:text-amber-200"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-2">
                                    Motivo
                                </label>
                                <input
                                    type="text"
                                    value={adjustmentReason}
                                    onChange={e => setAdjustmentReason(e.target.value)}
                                    className="w-full px-4 py-3 bg-white border-none rounded-2xl text-sm font-medium text-stone-600 focus:ring-2 focus:ring-amber-500 outline-none shadow-sm"
                                />
                            </div>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-stone-100 bg-white/50 backdrop-blur-md flex gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 py-4 text-stone-500 font-bold bg-stone-100 hover:bg-stone-200 rounded-2xl transition-all text-sm uppercase tracking-wider"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="flex-2 py-4 bg-saibro-600 hover:bg-saibro-700 text-white font-black rounded-2xl shadow-xl shadow-saibro-200 hover:shadow-2xl hover:shadow-saibro-300 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm uppercase tracking-wider"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                        Salvar Alterações
                    </button>
                </div>

            </div>
        </div>
    );
};
