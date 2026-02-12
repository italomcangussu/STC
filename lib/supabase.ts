import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Debugging helper (only visible in dev or if error occurs)
if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase Config Error:', {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseAnonKey,
        mode: import.meta.env.MODE
    });
}

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(`Missing Supabase variables. URL: ${!!supabaseUrl}, KEY: ${!!supabaseAnonKey}. Check your Easypanel Environment/Build settings.`);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        storageKey: 'reserva-sct-auth',
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});
