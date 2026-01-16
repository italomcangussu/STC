const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://smztsayzldjmkzmufqcz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtenRzYXl6bGRqbWt6bXVmcWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTEzMzksImV4cCI6MjA3MzcyNzMzOX0.mI_nVpDhFhEcERqbB0sucqJAcNkNJxldRg8JmKics9g';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    try {
        const challengeId = '383bbb61-5dee-4dd6-8f8e-870aed2add11';
        console.log(`Resetting challenge ${challengeId} to 'accepted'...`);

        const { error } = await supabase
            .from('challenges')
            .update({ status: 'accepted' })
            .eq('id', challengeId);

        if (error) {
            console.error('Error resetting challenge:', error);
        } else {
            console.log('Success! Challenge is now accepted and ready for scoring.');
        }

    } catch (e) {
        console.error('Script error:', e);
    }
}

run();
