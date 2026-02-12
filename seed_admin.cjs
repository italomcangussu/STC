
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_/REACT_APP_).');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const generateEmailFromPhone = (phone) => {
    const cleanPhone = phone.replace(/\D/g, '');
    return `${cleanPhone}@reserva.com`;
};

const generatePasswordFromPhone = (phone) => {
    const cleanPhone = phone.replace(/\D/g, '');
    return `sct${cleanPhone}2024`;
};

const seedAdmin = async () => {
    const phone = '88999990507';
    // const email = generateEmailFromPhone(phone); // OLD
    const email = 'italomcangussu@icloud.com'; // NEW STANDARD
    // const password = generatePasswordFromPhone(phone); // OLD
    const password = 'Naty1698'; // NEW STANDARD
    const name = 'Ítalo Cangussú';

    console.log(`Seeding admin: ${name} (${phone})...`);

    let userId = null;

    // 1. Try Login First
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });

    if (loginData.user) {
        console.log('User already exists in Auth. Logging in...');
        userId = loginData.user.id;
        if (loginData.session) {
            await supabase.auth.setSession(loginData.session);
        }
    } else {
        // 2. SignUp if not exists
        console.log('User not found in Auth. Signing up...');
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { name, phone }
            }
        });

        if (authError) {
            console.error('Auth Error:', authError);
            return;
        }
        userId = authData.user?.id;
        if (authData.session) {
            await supabase.auth.setSession(authData.session);
        }
    }

    // 3. Insert/Update Profile
    if (userId) {
        console.log(`Upserting profile for ${userId}...`);
        const { error: profError } = await supabase.from('profiles').upsert({
            id: userId,
            name: name,
            email: email,
            phone: phone,
            role: 'admin',
            category: '6ª Classe',
            is_active: true
        });

        if (profError) {
            console.error('Profile Upsert Error:', profError);
        } else {
            console.log('Admin profile updated/created successfully.');
        }
    } else {
        console.error('Failed to get userId.');
    }
};

seedAdmin();
