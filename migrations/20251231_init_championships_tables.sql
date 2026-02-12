-- Migration: init_championships_tables
-- Description: Create base tables for championships if they don't exist.
-- This handles missing tables reported during 2026 migrations.
-- 1. Championships Table
CREATE TABLE IF NOT EXISTS championships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    -- 'draft', 'ongoing', 'finished'
    format VARCHAR(50) DEFAULT 'pontos-corridos',
    start_date DATE,
    end_date DATE,
    description TEXT,
    season VARCHAR(50),
    registration_open BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Config columns that might have been added by later migrations 
    -- (safe to add here with IF NOT EXISTS logic implicitly by table creation, 
    --  but we define base. Later migrations will ADD COLUMN IF NOT EXISTS)
    groups JSONB,
    pts_victory INTEGER DEFAULT 3,
    pts_defeat INTEGER DEFAULT 0,
    pts_wo_victory INTEGER DEFAULT 3,
    pts_set INTEGER DEFAULT 0,
    pts_game INTEGER DEFAULT 0,
    final_ranking_pts INTEGER DEFAULT 200,
    tiebreak_rules TEXT [],
    slug VARCHAR(100) UNIQUE
);
-- 2. Championship Registrations
CREATE TABLE IF NOT EXISTS championship_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    championship_id UUID REFERENCES championships(id) ON DELETE CASCADE,
    participant_type VARCHAR(20) NOT NULL DEFAULT 'socio',
    -- 'socio', 'guest'
    user_id UUID REFERENCES profiles(id),
    guest_name VARCHAR(100),
    class VARCHAR(50),
    shirt_size VARCHAR(10),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    registered_by UUID REFERENCES profiles(id)
);
-- 3. Championship Groups
CREATE TABLE IF NOT EXISTS championship_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    championship_id UUID REFERENCES championships(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    -- "A", "Grupo 1"
    category VARCHAR(50) NOT NULL,
    -- "1ª Classe"
    group_name VARCHAR(50),
    -- "A", "B" (alias for display)
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 4. Championship Group Members
CREATE TABLE IF NOT EXISTS championship_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    championship_group_id UUID REFERENCES championship_groups(id) ON DELETE CASCADE,
    registration_id UUID REFERENCES championship_registrations(id) ON DELETE CASCADE,
    draw_order INTEGER,
    points INTEGER DEFAULT 0,
    matches_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 5. Helper Tables (Participants - older logic, might be deprecated but kept for compatibility)
CREATE TABLE IF NOT EXISTS championship_participants (
    championship_id UUID REFERENCES championships(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (championship_id, user_id)
);
-- RLS Policies (Basic)
ALTER TABLE championships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public view championships" ON championships FOR
SELECT USING (true);
CREATE POLICY "Admin manage championships" ON championships USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role::text = 'admin'
    )
);
ALTER TABLE championship_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public view registrations" ON championship_registrations FOR
SELECT USING (true);
CREATE POLICY "Users can register" ON championship_registrations FOR
INSERT WITH CHECK (auth.uid() = registered_by);
CREATE POLICY "Admin manage registrations" ON championship_registrations USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role::text = 'admin'
    )
);