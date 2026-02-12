
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_ equivalents).');
    process.exit(1);
}

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
