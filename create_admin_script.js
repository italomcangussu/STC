
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://smztsayzldjmkzmufqcz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtenRzYXl6bGRqbWt6bXVmcWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTEzMzksImV4cCI6MjA3MzcyNzMzOX0.mI_nVpDhFhEcERqbB0sucqJAcNkNJxldRg8JmKics9g';

const supabase = createClient(supabaseUrl, supabaseKey);

async function createAdmin() {
    try {
        console.log('Criando usuário admin@stc.com.br...');
        const { data, error } = await supabase.auth.signUp({
            email: 'admin@stc.com.br',
            password: 'dhi123',
            options: {
                data: {
                    name: 'Admin STC',
                    full_name: 'Admin STC',
                }
            }
        });

        if (error) {
            console.error('Erro ao criar usuário:', error.message);
            return;
        }

        console.log('Usuário criado com sucesso! ID:', data.user?.id);
    } catch (e) {
        console.error('Erro inesperado:', e);
    }
}

createAdmin();
