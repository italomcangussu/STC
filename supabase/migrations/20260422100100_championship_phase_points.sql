-- Migration: championship_phase_points
-- Goal: single source of truth for points per elimination phase.

CREATE TABLE IF NOT EXISTS public.championship_phase_points (
    phase   TEXT    PRIMARY KEY,
    points  INTEGER NOT NULL CHECK (points >= 0)
);

ALTER TABLE public.championship_phase_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read phase points"
    ON public.championship_phase_points FOR SELECT USING (true);

CREATE POLICY "Admins can manage phase points"
    ON public.championship_phase_points FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ));

INSERT INTO public.championship_phase_points (phase, points) VALUES
    ('champion',      125),
    ('finalist',       64),
    ('semifinal',      35),
    ('quarterfinal',   16),
    ('round_of_16',     8),
    ('participation',   5)
ON CONFLICT (phase) DO UPDATE SET points = EXCLUDED.points;

-- Helper function callable from PL/pgSQL and from the API
CREATE OR REPLACE FUNCTION public.get_championship_phase_points(p_phase TEXT)
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT points FROM public.championship_phase_points WHERE phase = p_phase;
$$;

GRANT EXECUTE ON FUNCTION public.get_championship_phase_points(TEXT) TO authenticated, anon;

-- Utility: convert numeric class name to rank integer (lower = better class)
-- '4ª Classe' → 4, '5ª Classe' → 5, '6ª Classe' → 6, unknown → 999
CREATE OR REPLACE FUNCTION public.class_rank(p_class TEXT)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(
        (regexp_match(COALESCE(p_class, ''), '(\d+)'))[1]::INTEGER,
        999
    );
$$;

GRANT EXECUTE ON FUNCTION public.class_rank(TEXT) TO authenticated, anon;

-- Convenience: is registration_class lower than profile_class?
-- "lower" means higher numeric rank (e.g., 6ª < 5ª < 4ª in quality)
CREATE OR REPLACE FUNCTION public.is_lower_class(p_registration_class TEXT, p_profile_class TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT public.class_rank(p_registration_class) > public.class_rank(p_profile_class);
$$;

GRANT EXECUTE ON FUNCTION public.is_lower_class(TEXT, TEXT) TO authenticated, anon;
