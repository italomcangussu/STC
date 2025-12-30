import { supabase } from './lib/supabase';
import { generateEmailFromPhone, generatePasswordFromPhone } from './lib/authHelpers';

const seedAdmin = async () => {
    const phone = '88999990507';
    const email = generateEmailFromPhone(phone);
    const password = generatePasswordFromPhone(phone);
    const name = 'Ítalo Cangussú';
    const role = 'admin';

    console.log(`Seeding admin: ${name} (${phone})...`);

    // 1. SignUp (this might fail if already exists, which is fine)
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { name, phone }
        }
    });

    if (authError) {
        if (authError.message.includes('already registered')) {
            console.log('User already registered in Auth.');
        } else {
            console.error('Auth Error:', authError);
            return;
        }
    }

    const userId = authData.user?.id;
    if (!userId) {
        // Find user if not returned (because already exists)
        // Actually we can't easily find ID without admin client, but let's assume we can try login
        const { data: loginData } = await supabase.auth.signInWithPassword({ email, password });
        if (loginData.user) {
            const uid = loginData.user.id;
            // Update profile
            const { error: profError } = await supabase.from('profiles').upsert({
                id: uid,
                name: name,
                email: email,
                phone: phone,
                role: 'admin',
                category: '6ª Classe',
                is_active: true
            });
            if (profError) console.error('Profile Upsert Error:', profError);
            else console.log('Admin profile updated/created.');
        }
        return;
    }

    // 2. Insert Profile
    if (userId) {
        const { error: profError } = await supabase.from('profiles').upsert({
            id: userId,
            name: name,
            email: email,
            phone: phone,
            role: 'admin',
            category: '6ª Classe',
            is_active: true
        });
        if (profError) console.error('Profile Upsert Error:', profError);
        else console.log('Admin created successfully.');
    }
};

seedAdmin();
