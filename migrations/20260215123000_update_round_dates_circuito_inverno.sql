-- Migration: update_round_dates_circuito_inverno
-- Description: Adjust round, semifinal, and final dates for "3º circuito de inverno".

WITH champ AS (
    SELECT id, COALESCE(start_date, CURRENT_DATE) AS base_date
    FROM championships
    WHERE name ILIKE '3% circuito de inverno'
    ORDER BY start_date DESC NULLS LAST
    LIMIT 1
)
UPDATE championship_rounds r
SET
    start_date = CASE r.round_number
        WHEN 1 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 2, 5)
        WHEN 2 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 2, 17)
        WHEN 3 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 3, 1)
        WHEN 4 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 3, 13)
        WHEN 5 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 3, 28)
        ELSE r.start_date
    END,
    end_date = CASE r.round_number
        WHEN 1 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 2, 16)
        WHEN 2 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 2, 28)
        WHEN 3 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 3, 12)
        WHEN 4 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 3, 24)
        WHEN 5 THEN make_date(EXTRACT(year FROM champ.base_date)::int, 3, 28)
        ELSE r.end_date
    END
FROM champ
WHERE r.championship_id = champ.id
  AND r.round_number IN (1, 2, 3, 4, 5);

-- Optional: ensure knockout round names for consistency
WITH champ AS (
    SELECT id
    FROM championships
    WHERE name ILIKE '3% circuito de inverno'
    ORDER BY start_date DESC NULLS LAST
    LIMIT 1
)
UPDATE championship_rounds r
SET name = CASE r.round_number
    WHEN 4 THEN 'Semifinais'
    WHEN 5 THEN 'Final'
    ELSE r.name
END
FROM champ
WHERE r.championship_id = champ.id
  AND r.round_number IN (4, 5);
