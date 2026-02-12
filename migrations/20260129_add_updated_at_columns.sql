-- Migration: Add updated_at columns to tables that need them
-- Date: 2026-01-29
-- Purpose: Add tracking for record updates across key tables
-- First, create a reusable function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- ============================================
-- CORE TABLES (High Priority)
-- ============================================
-- 1. profiles - User profiles (CRITICAL)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_profiles_updated_at BEFORE
UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 2. challenges - Challenge matches
ALTER TABLE public.challenges
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_challenges_updated_at BEFORE
UPDATE ON public.challenges FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 3. reservations - Court reservations
ALTER TABLE public.reservations
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;
-- Set existing records to created_at for consistency
UPDATE public.reservations
SET updated_at = created_at
WHERE updated_at IS NULL;
-- Now make it NOT NULL with default
ALTER TABLE public.reservations
ALTER COLUMN updated_at
SET DEFAULT NOW(),
    ALTER COLUMN updated_at
SET NOT NULL;
CREATE TRIGGER update_reservations_updated_at BEFORE
UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 4. championships - Tournament tracking
ALTER TABLE public.championships
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_championships_updated_at BEFORE
UPDATE ON public.championships FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 5. championship_rounds - Round management
ALTER TABLE public.championship_rounds
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_championship_rounds_updated_at BEFORE
UPDATE ON public.championship_rounds FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 6. matches - Match results
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_matches_updated_at BEFORE
UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ============================================
-- ADMIN & CONTENT TABLES (Medium Priority)
-- ============================================
-- 7. announcements - System announcements
ALTER TABLE public.announcements
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_announcements_updated_at BEFORE
UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 8. professors - Professor management
ALTER TABLE public.professors
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_professors_updated_at BEFORE
UPDATE ON public.professors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 9. students - Student records
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_students_updated_at BEFORE
UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 10. non_socio_students - Non-member students
ALTER TABLE public.non_socio_students
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_non_socio_students_updated_at BEFORE
UPDATE ON public.non_socio_students FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 11. student_payments - Payment tracking
ALTER TABLE public.student_payments
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_student_payments_updated_at BEFORE
UPDATE ON public.student_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ============================================
-- CHAMPIONSHIP TABLES (Medium Priority)
-- ============================================
-- 12. championship_registrations - Registration tracking
ALTER TABLE public.championship_registrations
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_championship_registrations_updated_at BEFORE
UPDATE ON public.championship_registrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 13. championship_group_members - Group member tracking
ALTER TABLE public.championship_group_members
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_championship_group_members_updated_at BEFORE
UPDATE ON public.championship_group_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 14. championship_winners - Winner records
ALTER TABLE public.championship_winners
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_championship_winners_updated_at BEFORE
UPDATE ON public.championship_winners FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ============================================
-- INFRASTRUCTURE TABLES (Lower Priority)
-- ============================================
-- 15. courts - Court management
ALTER TABLE public.courts
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_courts_updated_at BEFORE
UPDATE ON public.courts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 16. point_history - Point tracking (read-only, low priority)
ALTER TABLE public.point_history
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
CREATE TRIGGER update_point_history_updated_at BEFORE
UPDATE ON public.point_history FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ============================================
-- VERIFICATION
-- ============================================
-- Show summary of all updated_at columns added
DO $$
DECLARE table_count INTEGER;
BEGIN
SELECT COUNT(DISTINCT table_name) INTO table_count
FROM information_schema.columns
WHERE table_schema = 'public'
    AND column_name = 'updated_at'
    AND table_name IN (
        'profiles',
        'challenges',
        'reservations',
        'championships',
        'championship_rounds',
        'matches',
        'announcements',
        'professors',
        'students',
        'non_socio_students',
        'student_payments',
        'championship_registrations',
        'championship_group_members',
        'championship_winners',
        'courts',
        'point_history'
    );
RAISE NOTICE '✅ Migration completed successfully!';
RAISE NOTICE '📊 Total tables with updated_at: %',
table_count;
RAISE NOTICE '';
RAISE NOTICE '📋 Tables updated:';
RAISE NOTICE '   - profiles (User profiles)';
RAISE NOTICE '   - challenges (Challenges)';
RAISE NOTICE '   - reservations (Court reservations)';
RAISE NOTICE '   - championships (Tournaments)';
RAISE NOTICE '   - championship_rounds (Tournament rounds)';
RAISE NOTICE '   - matches (Match results)';
RAISE NOTICE '   - announcements (System announcements)';
RAISE NOTICE '   - professors (Professors)';
RAISE NOTICE '   - students (Regular students)';
RAISE NOTICE '   - non_socio_students (Non-member students)';
RAISE NOTICE '   - student_payments (Payments)';
RAISE NOTICE '   - championship_registrations (Registrations)';
RAISE NOTICE '   - championship_group_members (Group members)';
RAISE NOTICE '   - championship_winners (Winners)';
RAISE NOTICE '   - courts (Courts)';
RAISE NOTICE '   - point_history (Point history)';
RAISE NOTICE '';
RAISE NOTICE '🔧 All triggers created successfully!';
END $$;
-- Show all tables with timestamp tracking
SELECT table_name,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_name = t.table_name
                AND c.column_name = 'created_at'
        ) THEN '✅'
        ELSE '❌'
    END as has_created_at,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_name = t.table_name
                AND c.column_name = 'updated_at'
        ) THEN '✅'
        ELSE '❌'
    END as has_updated_at
FROM information_schema.tables t
WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name IN (
        'profiles',
        'challenges',
        'reservations',
        'championships',
        'championship_rounds',
        'matches',
        'announcements',
        'professors',
        'students',
        'non_socio_students',
        'student_payments',
        'championship_registrations',
        'championship_group_members',
        'championship_winners',
        'courts',
        'point_history'
    )
ORDER BY table_name;