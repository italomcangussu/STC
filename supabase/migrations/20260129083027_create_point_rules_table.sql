CREATE TABLE IF NOT EXISTS public.point_rules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rule_key TEXT UNIQUE NOT NULL,
    points INTEGER NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.point_rules ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename = 'point_rules' AND policyname = 'Enable read access for all users') THEN
        CREATE POLICY "Enable read access for all users" ON public.point_rules FOR SELECT USING (true);
    END IF;
    
    IF NOT EXISTS (SELECT FROM pg_policies WHERE tablename = 'point_rules' AND policyname = 'Enable all access for admins') THEN
        CREATE POLICY "Enable all access for admins" ON public.point_rules FOR ALL USING (
          auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin')
        );
    END IF;
END $$;

-- Seed initial data
INSERT INTO public.point_rules (rule_key, points, description) VALUES
('victory', 200, 'Vitória em desafio'),
('defeat', 100, 'Derrota em desafio (Bônus de consolação)'),
('wo_victory', 200, 'Vitória por W.O.'),
('superset_victory', 10, 'Vitória em Super Set (Acumulativo)'),
('tournament_victory', 500, 'Vitória em Campeonato'),
('tournament_participation', 50, 'Participação em Campeonato')
ON CONFLICT (rule_key) DO NOTHING;;
