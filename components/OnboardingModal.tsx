import React, { useState, useRef } from 'react';
import { User } from '../types';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notifications';
import { errorMessage, logger } from '../lib/logger';
import { AVATAR_BUCKET, buildAvatarPath, pruneOldAvatars } from '../lib/avatarStorage';
import { Upload, Loader2, Save, User as UserIcon } from 'lucide-react';

interface OnboardingModalProps {
    currentUser: User;
    onComplete: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ currentUser, onComplete: _onComplete }) => {
    const [name, setName] = useState(currentUser.name || '');
    const [category, setCategory] = useState(currentUser.category || '5ª Classe'); // Default
    const [avatarUrl, setAvatarUrl] = useState(currentUser.avatar || '');
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        setUploading(true);

        try {
            const filePath = buildAvatarPath(currentUser.id, file.name);
            const bucket = supabase.storage.from(AVATAR_BUCKET);

            const { error: uploadError } = await bucket.upload(filePath, file, { upsert: true });

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = bucket.getPublicUrl(filePath);

            setAvatarUrl(publicUrl);

            // Faxina é melhor-esforço: a foto nova já está no ar.
            try {
                await pruneOldAvatars(bucket, currentUser.id, filePath);
            } catch (pruneError) {
                logger.warn('avatar_prune_failed', {
                    userId: currentUser.id,
                    error: errorMessage(pruneError),
                });
            }
        } catch (error) {
            notify.failure(error, 'Não foi possível enviar a foto.', {
                event: 'onboarding_avatar_upload_failed',
            });
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ name: name, category: category, avatar_url: avatarUrl })
                .eq('id', currentUser.id);

            if (error) throw error;

            // Reload page to refresh context? Or just callback
            window.location.reload(); // Simplest way to ensure context refreshes

        } catch (error) {
            console.error('Error saving profile:', error);
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-saibro-900/90 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 animate-in zoom-in-95">
                <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold text-stone-800">Complete seu Perfil</h2>
                    <p className="text-stone-500 mt-2">Para participar do ranking, precisamos de alguns dados.</p>
                </div>

                <form onSubmit={handleSave} className="space-y-6">
                    {/* Avatar Upload */}
                    <div className="flex flex-col items-center">
                        <div className="relative group">
                            <div className="w-24 h-24 rounded-full bg-stone-100 flex items-center justify-center overflow-hidden border-4 border-white shadow-lg">
                                {uploading ? (
                                    <Loader2 className="animate-spin text-saibro-500" />
                                ) : avatarUrl ? (
                                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                                ) : (
                                    <UserIcon size={40} className="text-stone-300" />
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="absolute bottom-0 right-0 p-2 bg-saibro-500 text-white rounded-full hover:bg-saibro-600 transition-colors shadow-md"
                            >
                                <Upload size={16} />
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleAvatarUpload}
                            />
                        </div>
                        <span className="text-xs font-bold text-stone-400 mt-2 uppercase tracking-wide">Foto de Perfil</span>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Nome Completo</label>
                            <input
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-saibro-500 font-bold text-stone-800"
                                placeholder="Seu Nome"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Classe</label>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-saibro-500 font-bold text-stone-800"
                            >
                                {['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe', 'Iniciante', 'Feminino'].map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={saving}
                        className="w-full py-4 bg-saibro-600 text-white font-bold rounded-xl shadow-lg shadow-saibro-200 hover:bg-saibro-700 flex items-center justify-center gap-2"
                    >
                        {saving ? <Loader2 className="animate-spin" /> : <Save size={20} />}
                        Salvar e Continuar
                    </button>
                </form>
            </div>
        </div>
    );
};
