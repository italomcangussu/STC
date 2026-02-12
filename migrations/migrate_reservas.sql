-- Migration Script: Legacy Reservas to Reservations
-- Run this in Supabase SQL Editor

-- 1. Create reservation_participants table (if not exists)
CREATE TABLE IF NOT EXISTS reservation_participants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE reservation_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON reservation_participants FOR SELECT USING (true);
CREATE POLICY "Admin full access" ON reservation_participants FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- 2. Migrate Reservas
-- WARNING: Adjust column names ("Data", "hora", "Tipo de Jogo") if they differ in your 'reservas' table.

INSERT INTO reservations (
    date, 
    start_time, 
    end_time, 
    type, 
    court_id, 
    creator_id, 
    status,
    participant_ids -- Keeping array for compatibility with current code
)
SELECT 
    -- Date conversion: Adjust format if needed. Assuming 'Data' is date or text 'YYYY-MM-DD'
    -- If text 'DD/MM/YYYY', use: to_date("Data", 'DD/MM/YYYY')
    "Data"::date,
    
    -- Time conversion
    "Hora da Reserva"::time,
    ("Hora da Reserva"::time + INTERVAL '1 hour'), -- Default 1 hour duration
    
    -- Type mapping
    CASE 
        WHEN "Tipo de Jogo" ILIKE '%aula%' THEN 'Aula'
        WHEN "Tipo de Jogo" ILIKE '%ranking%' OR "Tipo de Jogo" ILIKE '%desafio%' THEN 'Desafio'
        WHEN "Tipo de Jogo" ILIKE '%campeonato%' THEN 'Campeonato'
        ELSE 'Play'
    END,
    
    -- Default Court: Pega a primeira quadra ativa (Saibro 1 ou similar)
    COALESCE(
        (SELECT id FROM courts WHERE name ILIKE '%Saibro 1%' LIMIT 1),
        (SELECT id FROM courts LIMIT 1)
    ),
    
    -- Default Creator: Pega o primeiro admin encontrado
    (SELECT id FROM profiles WHERE role = 'admin' LIMIT 1),
    
    'active',
    ARRAY[]::uuid[] -- Empty participants initially
    
FROM public.reservas;

-- 3. Populate reservation_participants (Optional/Future)
-- If 'reservas' has participant data, we would need to join with profiles to get UUIDs.
-- Example:
-- INSERT INTO reservation_participants (reservation_id, user_id) ...

-- 4. Update Dashboard
-- The Dashboard component automatically reads from 'reservations' table, so data should appear immediately.
