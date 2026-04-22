-- Migration: Add updated_at columns to tables that need them
-- Date: 2026-01-29
-- Purpose: Add tracking for record updates across key tables

-- First, create a reusable function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- CORE TABLES (High Priority)
-- ============================================

-- 1. profiles - User profiles (CRITICAL)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE OR REPLACE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 2. challenges - Challenge matches
ALTER TABLE public.challenges 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE OR REPLACE TRIGGER update_challenges_updated_at
BEFORE UPDATE ON public.challenges
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 3. reservations - Court reservations
ALTER TABLE public.reservations 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- Set existing records to created_at for consistency
UPDATE public.reservations 
SET updated_at = created_at 
WHERE updated_at IS NULL;

-- Now make it NOT NULL with default
ALTER TABLE public.reservations 
ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE OR REPLACE TRIGGER update_reservations_updated_at
BEFORE UPDATE ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();;
