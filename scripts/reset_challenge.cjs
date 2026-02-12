const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_ equivalents).');
    process.exit(1);
}

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
