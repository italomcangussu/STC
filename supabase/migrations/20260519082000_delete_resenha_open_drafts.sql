-- Delete remaining Resenha Open draft championships shown in the admin selector.
-- The active Resenha Open championship is intentionally preserved.

WITH target_championships AS (
    SELECT c.id
    FROM public.championships c
    JOIN public.championship_series s ON s.id = c.series_id
    WHERE s.slug = 'resenha-open'
      AND c.status = 'draft'
),
deleted_matches AS (
    DELETE FROM public.matches m
    USING target_championships t
    WHERE m.championship_id = t.id
    RETURNING m.id
),
deleted_registrations AS (
    DELETE FROM public.championship_registrations cr
    USING target_championships t
    WHERE cr.championship_id = t.id
    RETURNING cr.id
),
deleted_rounds AS (
    DELETE FROM public.championship_rounds r
    USING target_championships t
    WHERE r.championship_id = t.id
    RETURNING r.id
)
DELETE FROM public.championships c
USING target_championships t
WHERE c.id = t.id;
