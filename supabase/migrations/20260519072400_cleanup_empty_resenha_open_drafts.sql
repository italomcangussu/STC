-- Remove empty Resenha Open draft duplicates.
-- Drafts with any registration are intentionally preserved.

WITH target_championships AS (
    SELECT c.id
    FROM public.championships c
    JOIN public.championship_series s ON s.id = c.series_id
    WHERE s.slug = 'resenha-open'
      AND c.status = 'draft'
      AND NOT EXISTS (
          SELECT 1
          FROM public.championship_registrations cr
          WHERE cr.championship_id = c.id
      )
),
deleted_matches AS (
    DELETE FROM public.matches m
    USING target_championships t
    WHERE m.championship_id = t.id
    RETURNING m.id
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
