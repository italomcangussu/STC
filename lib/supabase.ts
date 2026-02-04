import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true, // Mantém sessão em localStorage
        storageKey: 'reserva-sct-auth', // Chave única para o app
        autoRefreshToken: true, // Renova token automaticamente
        detectSessionInUrl: true // Detecta sessão em redirect URLs
    }
});
