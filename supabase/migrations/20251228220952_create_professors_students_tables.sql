-- Create professors table
CREATE TABLE IF NOT EXISTS professors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) NOT NULL,
    bio TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create non_socio_students table
CREATE TABLE IF NOT EXISTS non_socio_students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    plan_status TEXT DEFAULT 'active',
    master_expiration_date DATE,
    professor_id UUID REFERENCES professors(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE professors ENABLE ROW LEVEL SECURITY;
ALTER TABLE non_socio_students ENABLE ROW LEVEL SECURITY;

-- Policies for professors
CREATE POLICY "Anyone can view professors" ON professors FOR SELECT USING (true);

-- Policies for non_socio_students  
CREATE POLICY "Professors can view their students" ON non_socio_students FOR SELECT USING (true);;
