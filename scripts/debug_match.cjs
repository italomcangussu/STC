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
        console.log('Searching for profiles...');
        const { data: profiles, error: pError } = await supabase
            .from('profiles')
            .select('id, name')
            .or('name.ilike.%Hermeson%,name.ilike.%Mailson%');

        if (pError) {
            console.error('Profiles Error:', pError);
            return;
        }
        console.log('Found Profiles:', profiles);

        if (!profiles || profiles.length === 0) {
            console.log('No profiles found.');
            return;
        }

        const ids = profiles.map(p => p.id);

        console.log('Searching for challenges...');
        // 2. Find challenges
        const { data: challenges, error: cError } = await supabase
            .from('challenges')
            .select(`
                *,
                match:matches(*)
            `)
            .or(`challenger_id.in.(${ids.join(',')}),challenged_id.in.(${ids.join(',')})`);

        if (cError) {
            console.error('Challenges Error:', cError);
            return;
        }

        // Filter strictly between the two
        const relevant = challenges.filter(c =>
            ids.includes(c.challenger_id) && ids.includes(c.challenged_id)
        );

        console.log('Relevant Challenges found:', relevant.length);
        console.log(JSON.stringify(relevant, null, 2));

    } catch (e) {
        console.error('Script error:', e);
    }
}

run();
