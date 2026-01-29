
import React, { useState, useRef } from 'react';
import { Camera, User as UserIcon, X, Save, Loader2, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { User } from '../types';

interface EditProfileModalProps {
    currentUser: User;
    onClose: () => void;
    onUpdate: () => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({ currentUser, onClose, onUpdate }) => {
    const [name, setName] = useState(currentUser.name);
    const [category, setCategory] = useState(currentUser.category || '6ª Classe');
    // Handle 'age' ensuring it's treated as string for input, handling undefined/null
    const [age, setAge] = useState(currentUser.age ? currentUser.age.toString() : '');
    const [avatarUrl, setAvatarUrl] = useState(currentUser.avatar);

    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const categories = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe', 'Iniciante', 'Feminino A', 'Feminino B', 'Feminino C'];

    const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        try {
            setUploading(true);
            const file = event.target.files?.[0];
            if (!file) return;

            const fileExt = file.name.split('.').pop();
            const fileName = `${currentUser.id}-${Math.random()}.${fileExt}`;
            const filePath = `avatars/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file, { upsert: true });

            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
            setAvatarUrl(data.publicUrl);

        } catch (error) {
            console.error('Error uploading avatar:', error);
            alert('Erro ao fazer upload da imagem.');
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const updates = {
                name,
                category,
                avatar_url: avatarUrl,
                age: age ? parseInt(age) : null
            };

            const { error } = await supabase
                .from('profiles')
                .update(updates)
                .eq('id', currentUser.id);

            if (error) throw error;

            onUpdate();
            onClose();

        } catch (error) {
            console.error('Error saving profile:', error);
            alert('Erro ao salvar perfil.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-200 bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                <div className="bg-saibro-50 px-6 py-4 border-b border-saibro-100 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-saibro-900">Editar Perfil</h2>
                    <button onClick={onClose} className="p-2 hover:bg-white rounded-full text-stone-400 hover:text-stone-600 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSave} className="p-6 space-y-6">
                    <div className="flex flex-col items-center">
                        <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                            <div className="w-24 h-24 rounded-full bg-stone-100 flex items-center justify-center overflow-hidden border-4 border-white shadow-lg ring-2 ring-saibro-100">
                                {uploading ? (
                                    <Loader2 className="animate-spin text-saibro-500" />
                                ) : avatarUrl ? (
                                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                                ) : (
                                    <UserIcon className="text-stone-300" size={40} />
                                )}

                                <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Camera className="text-white" size={24} />
                                </div>
                            </div>
                            <div className="absolute bottom-0 right-0 p-1.5 bg-saibro-500 text-white rounded-full shadow-md border-2 border-white">
                                <Upload size={12} />
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleAvatarUpload}
                            />
                        </div>
                        <p className="text-xs text-stone-400 mt-2">Toque para alterar a foto</p>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Nome Completo</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-400 outline-none font-semibold text-stone-800"
                                placeholder="Seu nome"
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Categoria (Classe)</label>
                                <select
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-400 outline-none font-semibold text-stone-800 appearance-none"
                                >
                                    {categories.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Idade</label>
                                <input
                                    type="number"
                                    value={age}
                                    onChange={(e) => setAge(e.target.value)}
                                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-400 outline-none font-semibold text-stone-800"
                                    placeholder="25"
                                    min="5"
                                    max="99"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 text-stone-500 font-bold hover:bg-stone-50 rounded-xl transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving || uploading}
                            className="flex-2 py-3 bg-saibro-600 hover:bg-saibro-700 text-white font-bold rounded-xl shadow-lg shadow-saibro-200 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {saving ? <Loader2 className="animate-spin" size={20} /> : <><Save size={20} /> Salvar Alterações</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
