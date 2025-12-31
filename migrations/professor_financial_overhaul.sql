-- 1. Rename 'Master Card' to 'Card Mensal' in existing records
UPDATE non_socio_students
SET plan_type = 'Card Mensal'
WHERE plan_type = 'Master Card';

-- 2. Create student_payments table for audit trail
CREATE TABLE IF NOT EXISTS student_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id UUID REFERENCES non_socio_students(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) DEFAULT 200.00,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    approved_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE student_payments ENABLE ROW LEVEL SECURITY;

-- 4. Policies for student_payments

-- Admins can INSERT, SELECT, UPDATE, DELETE (Full Control)
CREATE POLICY "Admins can manage payments" ON student_payments
    FOR ALL USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- Professors can VIEW payments for their own students
CREATE POLICY "Professors can view own student payments" ON student_payments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM non_socio_students s
            JOIN professors p ON s.professor_id = p.id
            WHERE s.id = student_payments.student_id
            AND p.user_id = auth.uid()
        )
    );
