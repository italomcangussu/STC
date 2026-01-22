-- Migration: championship_groups_draw
-- Description: Add columns to support group draw functionality for championships
-- Each category will have two groups (A and B) with a seed player (head) per group
-- Add registration_closed field to championships
ALTER TABLE championships
ADD COLUMN IF NOT EXISTS registration_closed BOOLEAN DEFAULT FALSE;
-- Add registration_closed_at timestamp
ALTER TABLE championships
ADD COLUMN IF NOT EXISTS registration_closed_at TIMESTAMPTZ;
-- Create championship_groups table to store the drawn groups
CREATE TABLE IF NOT EXISTS championship_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    championship_id UUID NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    -- e.g., '1ª Classe', '2ª Classe', etc.
    group_name VARCHAR(10) NOT NULL,
    -- 'A' or 'B'
    seed_registration_id UUID REFERENCES championship_registrations(id) ON DELETE
    SET NULL,
        -- The head/seed of the group
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(championship_id, category, group_name)
);
-- Create championship_group_members table to store members of each group
CREATE TABLE IF NOT EXISTS championship_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES championship_groups(id) ON DELETE CASCADE,
    registration_id UUID NOT NULL REFERENCES championship_registrations(id) ON DELETE CASCADE,
    is_seed BOOLEAN DEFAULT FALSE,
    -- True if this member is the seed/head of the group
    draw_order INTEGER,
    -- Order in which the member was drawn (null for seeds)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, registration_id)
);
-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_championship_groups_championship ON championship_groups(championship_id);
CREATE INDEX IF NOT EXISTS idx_championship_groups_category ON championship_groups(category);
CREATE INDEX IF NOT EXISTS idx_championship_group_members_group ON championship_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_championship_group_members_registration ON championship_group_members(registration_id);
-- Enable RLS
ALTER TABLE championship_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE championship_group_members ENABLE ROW LEVEL SECURITY;
-- RLS Policies for championship_groups
CREATE POLICY "Anyone can view championship groups" ON championship_groups FOR
SELECT USING (true);
CREATE POLICY "Admins can insert championship groups" ON championship_groups FOR
INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role = 'admin'
        )
    );
CREATE POLICY "Admins can update championship groups" ON championship_groups FOR
UPDATE USING (
        EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role = 'admin'
        )
    );
CREATE POLICY "Admins can delete championship groups" ON championship_groups FOR DELETE USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role = 'admin'
    )
);
-- RLS Policies for championship_group_members
CREATE POLICY "Anyone can view group members" ON championship_group_members FOR
SELECT USING (true);
CREATE POLICY "Admins can insert group members" ON championship_group_members FOR
INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role = 'admin'
        )
    );
CREATE POLICY "Admins can update group members" ON championship_group_members FOR
UPDATE USING (
        EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role = 'admin'
        )
    );
CREATE POLICY "Admins can delete group members" ON championship_group_members FOR DELETE USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role = 'admin'
    )
);