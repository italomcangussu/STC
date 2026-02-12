-- Migration: Day Card Experimental + Payment status tracking
-- Created: 2026-02-12
-- Purpose: Add 'Day Card Experimental' plan type and payment cancellation tracking
-- Note: Creates base tables if they don't exist (for fresh environments)

-- ============================================
-- STEP 0: Ensure base tables exist
-- ============================================

-- 0a. Create professors table if not exists
CREATE TABLE IF NOT EXISTS public.professors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    bio TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 0b. Create non_socio_students table if not exists
CREATE TABLE IF NOT EXISTS public.non_socio_students (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    professor_id UUID REFERENCES public.professors(id) ON DELETE SET NULL,
    plan_type VARCHAR(30) DEFAULT 'Day Card',
    plan_status VARCHAR(20) DEFAULT 'inactive',
    master_expiration_date DATE,
    student_type VARCHAR(20) DEFAULT 'regular' CHECK (student_type IN ('regular', 'dependent')),
    responsible_socio_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    relationship_type VARCHAR(20) CHECK (relationship_type IN ('filho', 'filha', 'esposo', 'esposa', 'outro')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 0c. Create student_payments table if not exists
CREATE TABLE IF NOT EXISTS public.student_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id UUID REFERENCES public.non_socio_students(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) DEFAULT 200.00,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    approved_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 0d. Enable RLS on new tables (idempotent)
ALTER TABLE public.professors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.non_socio_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_payments ENABLE ROW LEVEL SECURITY;

-- 0e. RLS Policies (idempotent with DROP IF EXISTS)
DO $$ BEGIN
    -- Professors: admins full access
    DROP POLICY IF EXISTS "Admins can manage professors" ON public.professors;
    CREATE POLICY "Admins can manage professors" ON public.professors
        FOR ALL USING (
            EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        );

    -- Professors: professors can view themselves
    DROP POLICY IF EXISTS "Professors can view own profile" ON public.professors;
    CREATE POLICY "Professors can view own profile" ON public.professors
        FOR SELECT USING (user_id = auth.uid());

    -- Non-socio students: admins full access
    DROP POLICY IF EXISTS "Admins can manage students" ON public.non_socio_students;
    CREATE POLICY "Admins can manage students" ON public.non_socio_students
        FOR ALL USING (
            EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        );

    -- Non-socio students: professors can manage their own students
    DROP POLICY IF EXISTS "Professors can manage own students" ON public.non_socio_students;
    CREATE POLICY "Professors can manage own students" ON public.non_socio_students
        FOR ALL USING (
            EXISTS (
                SELECT 1 FROM professors p
                WHERE p.id = non_socio_students.professor_id
                AND p.user_id = auth.uid()
            )
        );

    -- Non-socio students: socios can view (for dependent lookups)
    DROP POLICY IF EXISTS "Socios can view students" ON public.non_socio_students;
    CREATE POLICY "Socios can view students" ON public.non_socio_students
        FOR SELECT USING (
            EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'socio')
        );

    -- Student payments: admins full access
    DROP POLICY IF EXISTS "Admins can manage payments" ON public.student_payments;
    CREATE POLICY "Admins can manage payments" ON public.student_payments
        FOR ALL USING (
            EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        );

    -- Student payments: professors can view own student payments
    DROP POLICY IF EXISTS "Professors can view own student payments" ON public.student_payments;
    CREATE POLICY "Professors can view own student payments" ON public.student_payments
        FOR SELECT USING (
            EXISTS (
                SELECT 1 FROM non_socio_students s
                JOIN professors p ON s.professor_id = p.id
                WHERE s.id = student_payments.student_id
                AND p.user_id = auth.uid()
            )
        );
END $$;

-- ============================================
-- STEP 1: Add Day Card Experimental to plan_type
-- ============================================
ALTER TABLE public.non_socio_students DROP CONSTRAINT IF EXISTS non_socio_students_plan_type_check;

ALTER TABLE public.non_socio_students
ADD CONSTRAINT non_socio_students_plan_type_check CHECK (
    plan_type IN ('Day Card', 'Card Mensal', 'Dependente', 'Day Card Experimental')
);

-- ============================================
-- STEP 2: Add payment status tracking columns
-- ============================================

-- 2a. Add status column (tracks active vs cancelled payments)
ALTER TABLE public.student_payments
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'
CHECK (status IN ('active', 'cancelled'));

-- 2b. Add cancelled_reason column (explains why a payment was cancelled)
ALTER TABLE public.student_payments
ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

-- 2c. Add related_payment_id (self-referencing FK: links new Card Mensal payment to cancelled Day Card Experimental)
ALTER TABLE public.student_payments
ADD COLUMN IF NOT EXISTS related_payment_id UUID REFERENCES public.student_payments(id) ON DELETE SET NULL;

-- ============================================
-- STEP 3: Backfill existing data
-- ============================================

-- Set all existing payments as 'active'
UPDATE public.student_payments
SET status = 'active'
WHERE status IS NULL;

-- Set all existing students without student_type as 'regular'
UPDATE public.non_socio_students
SET student_type = 'regular'
WHERE student_type IS NULL;

-- ============================================
-- STEP 4: Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_student_payments_status ON public.student_payments(status);
CREATE INDEX IF NOT EXISTS idx_non_socio_students_student_type ON public.non_socio_students(student_type);
CREATE INDEX IF NOT EXISTS idx_non_socio_students_responsible_socio ON public.non_socio_students(responsible_socio_id);

-- ============================================
-- STEP 5: Comments
-- ============================================
COMMENT ON COLUMN public.student_payments.status IS 'Payment status: active (valid) or cancelled (refunded/converted)';
COMMENT ON COLUMN public.student_payments.cancelled_reason IS 'Reason for cancellation, e.g. Convertido para Card Mensal';
COMMENT ON COLUMN public.student_payments.related_payment_id IS 'Links to the replacement payment when a Day Card Experimental is converted to Card Mensal';
