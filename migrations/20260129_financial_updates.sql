-- 1. Create Payment Status Enum if not exists
DO $$ BEGIN CREATE TYPE payment_status_type AS ENUM ('paid', 'pending', 'exempt');
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
-- 2. Add payment_status to reservations (default 'paid' for backward compatibility)
ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS payment_status payment_status_type DEFAULT 'paid';
-- 3. Create student_payments table (if not exists from previous attempts)
CREATE TABLE IF NOT EXISTS student_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id UUID REFERENCES non_socio_students(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) DEFAULT 200.00,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    approved_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- 4. Enable RLS on student_payments
ALTER TABLE student_payments ENABLE ROW LEVEL SECURITY;
-- 5. Policies for student_payments
DROP POLICY IF EXISTS "Admins can manage payments" ON student_payments;
CREATE POLICY "Admins can manage payments" ON student_payments FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role = 'admin'
    )
);
DROP POLICY IF EXISTS "Professors can view own student payments" ON student_payments;
CREATE POLICY "Professors can view own student payments" ON student_payments FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM non_socio_students s
                JOIN professors p ON s.professor_id = p.id
            WHERE s.id = student_payments.student_id
                AND p.user_id = auth.uid()
        )
    );