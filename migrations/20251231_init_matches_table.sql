-- Migration: init_matches_table
-- Description: Create matches table if it doesn't exist.
-- Reason: Missing in database, causing errors in subsequent migrations.
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Basic match info
    date DATE,
    status VARCHAR(20) DEFAULT 'pending',
    -- 'pending', 'finished', 'walking_opponents'
    type VARCHAR(50) DEFAULT 'friendly',
    -- 'friendly', 'championship', 'challenge'
    -- Players (initially required, but later made nullable for championship placeholders)
    player_a_id UUID REFERENCES profiles(id),
    player_b_id UUID REFERENCES profiles(id),
    -- Scores (Arrays of integers for sets)
    score_a INTEGER [] DEFAULT '{}',
    score_b INTEGER [] DEFAULT '{}',
    winner_id UUID REFERENCES profiles(id),
    -- Championship Context
    championship_id UUID REFERENCES championships(id) ON DELETE CASCADE,
    phase VARCHAR(50),
    -- 'groups', 'quarter', 'semi', 'final'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'matches'
        AND policyname = 'Public view matches'
) THEN CREATE POLICY "Public view matches" ON matches FOR
SELECT USING (true);
END IF;
-- Autenticated users can update matches they are part of? Or Admins only?
-- Usually admins or system. Let's start conservative.
IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'matches'
        AND policyname = 'Admin manage matches'
) THEN CREATE POLICY "Admin manage matches" ON matches USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role::text = 'admin'
    )
);
END IF;
END $$;