-- Migration: support_group_championships
-- Description: Add columns for group stage format, scoring rules, and update format constraint

-- Add columns to championships table
ALTER TABLE championships ADD COLUMN IF NOT EXISTS "groups" JSONB;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS pts_defeat INTEGER DEFAULT 0;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS pts_wo_victory INTEGER DEFAULT 3;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS final_ranking_pts INTEGER DEFAULT 200;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS tiebreak_rules TEXT[];

-- Update format constraint
-- First drop existing constraint if it exists
ALTER TABLE championships DROP CONSTRAINT IF EXISTS championships_format_check;

-- Re-add constraint with new value
ALTER TABLE championships ADD CONSTRAINT championships_format_check 
CHECK (format IN ('mata-mata', 'pontos-corridos', 'grupo-mata-mata'));
;
