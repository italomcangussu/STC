-- Migration: championship_rounds
-- Description: Add rounds, scheduling, public slug, and loose coupling for matches
-- 1. Create championship_rounds table
CREATE TABLE IF NOT EXISTS championship_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    championship_id UUID NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    phase VARCHAR(50) NOT NULL,
    -- 'classificatoria', 'mata-mata-semifinal', 'mata-mata-final'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    -- 'pending', 'active', 'finished'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(championship_id, round_number)
);
-- 2. Update championships table
ALTER TABLE championships
ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE;
-- 3. Update matches table to support championship context and scheduling
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS championship_group_id UUID REFERENCES championship_groups(id);
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS round_id UUID REFERENCES championship_rounds(id);
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS scheduled_time TIME;
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS court_id UUID REFERENCES courts(id);
-- 4. Support for Guest Players / Registrations in Matches
-- We add references to championship_registrations. 
-- If these are set, they take precedence over player_a_id/player_b_id for display purposes in championships.
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS registration_a_id UUID REFERENCES championship_registrations(id);
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS registration_b_id UUID REFERENCES championship_registrations(id);
-- Make player_a_id and player_b_id nullable to support matches between guests (who have no profile)
ALTER TABLE matches
ALTER COLUMN player_a_id DROP NOT NULL;
ALTER TABLE matches
ALTER COLUMN player_b_id DROP NOT NULL;
-- 5. Walkover support
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS is_walkover BOOLEAN DEFAULT FALSE;
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS walkover_winner_id UUID REFERENCES profiles(id);
-- Nullable, used if winner has profile
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS walkover_winner_registration_id UUID REFERENCES championship_registrations(id);
-- Used if winner is guest
-- 6. RLS for Public Access (Applies to all related tables)
-- Enable RLS on championship_rounds
ALTER TABLE championship_rounds ENABLE ROW LEVEL SECURITY;
-- Policy: Everyone can view rounds
CREATE POLICY "Public view rounds" ON championship_rounds FOR
SELECT USING (true);
-- Policy: Only admins can manage rounds
CREATE POLICY "Admins manage rounds" ON championship_rounds USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role::text = 'admin'
    )
);
-- Update Policies for Public Championship Page Access
-- We need to ensure anonymous users can SELECT from these tables:
-- championships, championship_groups, championship_group_members, championship_registrations, matches
-- Already have strict policies? Let's add public read policies if they don't exist (or duplicate generous ones)
-- Note: 'True' policies might already exist (e.g. "Anyone can view"), so we just ensure.
-- Matches: Allow public update (for score) if match is active? 
-- This is risky but requested: "através dessa url, eles poderão marcar seus jogos"
-- Limiting to specific columns via UI, but RLS usually row-level.
-- We'll allow UPDATE on matches for public if the match is linked to a championship/round.
CREATE POLICY "Public update championship matches" ON matches FOR
UPDATE USING (
        round_id IS NOT NULL
        AND status != 'finished'
    ) WITH CHECK (
        round_id IS NOT NULL
        AND status != 'finished'
    );
-- Ensure public select on matches
CREATE POLICY "Public select matches" ON matches FOR
SELECT USING (true);
-- Indexes
CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round_id);
CREATE INDEX IF NOT EXISTS idx_matches_championship_group ON matches(championship_group_id);
CREATE INDEX IF NOT EXISTS idx_championships_slug ON championships(slug);