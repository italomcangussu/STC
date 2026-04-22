-- Mark 3rd Circuito de Inverno (2026) as finished.
-- Also finishes rounds whose matches are all finished.

DO $$
DECLARE
    v_championship_id UUID;
BEGIN
    SELECT c.id
    INTO v_championship_id
    FROM public.championships c
    JOIN public.championship_series cs ON cs.id = c.series_id
    WHERE cs.slug = 'circuito-de-inverno'
      AND c.edition_year = 2026
      AND c.name ILIKE '3%Circuito%Inverno%'
    ORDER BY c.id
    LIMIT 1;

    IF v_championship_id IS NULL THEN
        RAISE EXCEPTION '3º Circuito de Inverno (2026) não encontrado.';
    END IF;

    UPDATE public.championships
    SET
        status = 'finished',
        end_date = COALESCE(end_date, CURRENT_DATE)
    WHERE id = v_championship_id;

    UPDATE public.championship_rounds r
    SET status = 'finished'
    WHERE r.championship_id = v_championship_id
      AND EXISTS (
          SELECT 1
          FROM public.matches m
          WHERE m.round_id = r.id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM public.matches m
          WHERE m.round_id = r.id
            AND m.status <> 'finished'
      );
END;
$$;
