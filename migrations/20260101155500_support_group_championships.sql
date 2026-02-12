-- Migration: support_group_championships
-- Description: Add columns for group stage format, scoring rules, and update format constraint

-- Add columns to championships table
ALTER TABLE championships ADD COLUMN IF NOT EXISTS "groups" JSONB;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS pts_defeat INTEGER DEFAULT 0;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS pts_wo_victory INTEGER DEFAULT 3;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS final_ranking_pts INTEGER DEFAULT 200;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS tiebreak_rules TEXT[];

-- Update format constraint
-- First drop existing constraint if it exists (name might vary, checking common names)
ALTER TABLE championships DROP CONSTRAINT IF EXISTS championships_format_check;

-- Re-add constraint with new value
ALTER TABLE championships ADD CONSTRAINT championships_format_check 
CHECK (format IN ('mata-mata', 'pontos-corridos', 'grupo-mata-mata'));

-- Create championship_standings table (Optional, if we want to persist calculated standings, 
-- but current implementation calculates on the fly. Leaving commented out as per implementation decision to calculate dynamically for now)
-- CREATE TABLE IF NOT EXISTS championship_standings (...);
