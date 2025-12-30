import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://smztsayzldjmkzmufqcz.supabase.co';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtenRzYXl6bGRqbWt6bXVmcWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTEzMzksImV4cCI6MjA3MzcyNzMzOX0.mI_nVpDhFhEcERqbB0sucqJAcNkNJxldRg8JmKics9g';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true, // Mantém sessão em localStorage
        storageKey: 'reserva-sct-auth', // Chave única para o app
        autoRefreshToken: true, // Renova token automaticamente
        detectSessionInUrl: true // Detecta sessão em redirect URLs
    }
});
