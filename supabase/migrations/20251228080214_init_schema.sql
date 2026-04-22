
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create Enums
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'socio', 'lanchonete');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE reservation_status AS ENUM ('active', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE court_type AS ENUM ('Saibro', 'Rápida');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE match_status AS ENUM ('pending', 'finished', 'waiting_opponents');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    role user_role DEFAULT 'socio',
    balance NUMERIC DEFAULT 0,
    avatar_url TEXT,
    category TEXT,
    is_professor BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. COURTS
CREATE TABLE IF NOT EXISTS public.courts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type court_type NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PROFESSORS
CREATE TABLE IF NOT EXISTS public.professors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id),
    name TEXT NOT NULL,
    bio TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. NON SOCIO STUDENTS
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    phone TEXT,
    plan_type TEXT,
    professor_id UUID REFERENCES public.professors(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. PRODUCTS
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. CONSUMPTIONS
CREATE TABLE IF NOT EXISTS public.consumptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id),
    product_id UUID REFERENCES public.products(id),
    quantity INTEGER DEFAULT 1,
    total_price NUMERIC NOT NULL,
    status TEXT DEFAULT 'open',
    date TIMESTAMPTZ DEFAULT NOW()
);

-- 7. CHAMPIONSHIPS
CREATE TABLE IF NOT EXISTS public.championships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    format TEXT NOT NULL, -- mata-mata, pontos-corridos
    start_date DATE,
    end_date DATE,
    rules TEXT,
    pts_victory NUMERIC,
    pts_set NUMERIC,
    pts_game NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. CHAMPIONSHIP PARTICIPANTS (Junction)
CREATE TABLE IF NOT EXISTS public.championship_participants (
    championship_id UUID REFERENCES public.championships(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (championship_id, user_id)
);

-- 9. MATCHES
CREATE TABLE IF NOT EXISTS public.matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    championship_id UUID REFERENCES public.championships(id) ON DELETE CASCADE,
    phase TEXT,
    player_a_id UUID REFERENCES public.profiles(id), -- Nullable for placeholders
    player_b_id UUID REFERENCES public.profiles(id),
    score_a INTEGER[],
    score_b INTEGER[],
    winner_id UUID REFERENCES public.profiles(id),
    date DATE,
    status match_status DEFAULT 'pending',
    type TEXT -- 'Campeonato', 'Desafio Ranking'
);

-- 10. RESERVATIONS
CREATE TABLE IF NOT EXISTS public.reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    court_id UUID REFERENCES public.courts(id),
    creator_id UUID REFERENCES public.profiles(id),
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    type TEXT NOT NULL, -- Play, Aula, etc.
    status reservation_status DEFAULT 'active',
    observation TEXT,
    professor_id UUID REFERENCES public.professors(id),
    student_id UUID REFERENCES public.students(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. RESERVATION PARTICIPANTS
CREATE TABLE IF NOT EXISTS public.reservation_participants (
    reservation_id UUID REFERENCES public.reservations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (reservation_id, user_id)
);

-- 12. CHALLENGES
CREATE TABLE IF NOT EXISTS public.challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    challenger_id UUID REFERENCES public.profiles(id),
    challenged_id UUID REFERENCES public.profiles(id),
    status TEXT DEFAULT 'proposed',
    month_ref TEXT,
    match_id UUID REFERENCES public.matches(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Setup
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumptions ENABLE ROW LEVEL SECURITY;

-- Helper function for Admin check
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Policies
-- Profiles: Visible to all authenticated users
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Reservations: Visible to everyone, create authenticated, update own/admin
CREATE POLICY "Reservations viewable by everyone" ON public.reservations FOR SELECT USING (true);
CREATE POLICY "Authenticated can create reservation" ON public.reservations FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Creator or Admin can update reservation" ON public.reservations FOR UPDATE USING (auth.uid() = creator_id OR is_admin());
CREATE POLICY "Creator or Admin can delete reservation" ON public.reservations FOR DELETE USING (auth.uid() = creator_id OR is_admin());

-- Championships: Viewable by all, managed by Admin
CREATE POLICY "Championships viewable by everyone" ON public.championships FOR SELECT USING (true);
CREATE POLICY "Admins manage championships" ON public.championships FOR ALL USING (is_admin());

;
