-- Migration: Add is_active column to non_socio_students
-- Created: 2026-02-12
-- Purpose: Implement soft delete to preserve payment history
-- Add is_active column
ALTER TABLE public.non_socio_students
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
-- Set all existing students as active
UPDATE public.non_socio_students
SET is_active = true
WHERE is_active IS NULL;
-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_non_socio_students_is_active ON public.non_socio_students(is_active);
-- Comment
COMMENT ON COLUMN public.non_socio_students.is_active IS 'Soft delete flag. When false, student is archived but payment history is preserved.';