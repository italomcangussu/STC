-- Migration: championship_series
-- Goal: introduce championship_series as a parent table so point defense
--       logic can link annual editions of the same tournament.

-- 1. series table
CREATE TABLE IF NOT EXISTS public.championship_series (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    created_by  UUID        REFERENCES public.profiles(id)
);

ALTER TABLE public.championship_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read championship_series"
    ON public.championship_series FOR SELECT USING (true);

CREATE POLICY "Admins can manage championship_series"
    ON public.championship_series FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ));

-- 2. Extend championships
ALTER TABLE public.championships
    ADD COLUMN IF NOT EXISTS series_id    UUID    REFERENCES public.championship_series(id),
    ADD COLUMN IF NOT EXISTS edition_year INTEGER;

-- Partial unique: one edition per series per year (only when both are set)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_championship_series_edition_year
    ON public.championships (series_id, edition_year)
    WHERE series_id IS NOT NULL AND edition_year IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_championships_series_id
    ON public.championships (series_id);

-- 3. Backfill "Circuito de Inverno" series and link existing editions
INSERT INTO public.championship_series (name, slug)
VALUES ('Circuito de Inverno', 'circuito-de-inverno')
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
    v_series_id UUID;
BEGIN
    SELECT id INTO v_series_id
    FROM public.championship_series
    WHERE slug = 'circuito-de-inverno';

    UPDATE public.championships
    SET
        series_id    = v_series_id,
        edition_year = CASE
            WHEN name ~* '1[oOºª]?\s*(CIRCUITO|circ)'  THEN 2024
            WHEN name ~* '2[oOºª]?\s*(CIRCUITO|circ)'  THEN 2025
            WHEN name ~* '3[oOºª]?\s*(CIRCUITO|circ)'  THEN 2026
            ELSE NULL
        END
    WHERE
        name ~* 'CIRCUITO.{0,10}INVERNO'
        AND (series_id IS NULL OR edition_year IS NULL);
END;
$$;
