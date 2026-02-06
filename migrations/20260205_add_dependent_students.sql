-- Migration: Add dependent students support
-- Created: 2026-02-05
-- Purpose: Add support for dependent students (family members of socios)
-- 1. Add student_type column to non_socio_students table
ALTER TABLE public.non_socio_students
ADD COLUMN IF NOT EXISTS student_type VARCHAR(20) DEFAULT 'regular' CHECK (student_type IN ('regular', 'dependent'));
-- 2. Add responsible_socio_id column for dependents
ALTER TABLE public.non_socio_students
ADD COLUMN IF NOT EXISTS responsible_socio_id UUID REFERENCES public.profiles(id) ON DELETE
SET NULL;
-- 3. Add relationship_type for dependents
ALTER TABLE public.non_socio_students
ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(20) CHECK (
        relationship_type IN ('filho', 'filha', 'esposo', 'esposa', 'outro')
    );
-- 4. Update plan_type to include 'Dependente'
-- First, drop the existing check constraint if it exists
DO $$ BEGIN IF EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'non_socio_students'
        AND column_name = 'plan_type'
) THEN
ALTER TABLE public.non_socio_students DROP CONSTRAINT IF EXISTS non_socio_students_plan_type_check;
END IF;
END $$;
-- Add new check constraint with 'Dependente' option
ALTER TABLE public.non_socio_students
ADD CONSTRAINT non_socio_students_plan_type_check CHECK (
        plan_type IN ('Day Card', 'Card Mensal', 'Dependente')
    );
-- 5. Create index for faster queries on dependent students
CREATE INDEX IF NOT EXISTS idx_non_socio_students_student_type ON public.non_socio_students(student_type);
CREATE INDEX IF NOT EXISTS idx_non_socio_students_responsible_socio ON public.non_socio_students(responsible_socio_id);
-- 6. Add comment to table
COMMENT ON COLUMN public.non_socio_students.student_type IS 'Type of student: regular (pays) or dependent (family, no payment)';
COMMENT ON COLUMN public.non_socio_students.responsible_socio_id IS 'ID of the socio responsible for this dependent';
COMMENT ON COLUMN public.non_socio_students.relationship_type IS 'Relationship to responsible socio: filho, filha, esposo, esposa, outro';
-- 7. Migration data: Set all existing students as 'regular' type
UPDATE public.non_socio_students
SET student_type = 'regular'
WHERE student_type IS NULL;