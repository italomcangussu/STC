-- Migration: Add scheduling fields to challenges table
-- Run this in Supabase SQL Editor

-- 1. Add new columns to challenges table
ALTER TABLE challenges 
ADD COLUMN IF NOT EXISTS scheduled_date DATE,
ADD COLUMN IF NOT EXISTS scheduled_time TIME,
ADD COLUMN IF NOT EXISTS court_id UUID REFERENCES courts(id),
ADD COLUMN IF NOT EXISTS notification_seen BOOLEAN DEFAULT false;

-- 2. Create index for faster queries on notification status
CREATE INDEX IF NOT EXISTS idx_challenges_notification 
ON challenges(challenged_id, notification_seen) 
WHERE notification_seen = false;

-- 3. Create index for date-based queries
CREATE INDEX IF NOT EXISTS idx_challenges_scheduled_date 
ON challenges(scheduled_date) 
WHERE status IN ('accepted', 'scheduled');

-- Done! Challenge scheduling fields added.
