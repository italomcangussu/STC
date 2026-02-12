-- Migration: init_missing_tables_v2
-- Description: Create courts and ensure profiles exists.
-- Reason: Errors reporting missing relations 'courts'.
-- 1. Profiles (Usually exists, but just in case of weird state)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT,
    phone TEXT,
    role VARCHAR(20) DEFAULT 'socio',
    -- 'socio', 'admin', 'lanchonete'
    balance DECIMAL(10, 2) DEFAULT 0,
    avatar_url TEXT,
    category VARCHAR(50),
    -- e.g. "1ª Classe"
    is_professor BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    age INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. Courts
CREATE TABLE IF NOT EXISTS courts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    -- 'Saibro', 'Rápida'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Seed initial courts if empty
INSERT INTO courts (name, type)
SELECT 'Quadra 1',
    'Saibro'
WHERE NOT EXISTS (
        SELECT 1
        FROM courts
    );
INSERT INTO courts (name, type)
SELECT 'Quadra 2',
    'Saibro'
WHERE NOT EXISTS (
        SELECT 1
        FROM courts
        WHERE name = 'Quadra 2'
    );
INSERT INTO courts (name, type)
SELECT 'Quadra 3',
    'Saibro'
WHERE NOT EXISTS (
        SELECT 1
        FROM courts
        WHERE name = 'Quadra 3'
    );
INSERT INTO courts (name, type)
SELECT 'Quadra 4',
    'Rápida'
WHERE NOT EXISTS (
        SELECT 1
        FROM courts
        WHERE name = 'Quadra 4'
    );
-- RLS
ALTER TABLE courts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'courts'
        AND policyname = 'Public view courts'
) THEN CREATE POLICY "Public view courts" ON courts FOR
SELECT USING (true);
END IF;
END $$;