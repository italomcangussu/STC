-- One-time cleanup: remove all draft championships created during development.
-- Matches and registrations are deleted first due to FK constraints.

DO $$
DECLARE
    draft_ids UUID[];
BEGIN
    SELECT ARRAY_AGG(id) INTO draft_ids
    FROM public.championships
    WHERE status = 'draft';

    IF draft_ids IS NULL OR ARRAY_LENGTH(draft_ids, 1) = 0 THEN
        RETURN;
    END IF;

    -- Matches reference rounds (round_id) — delete before rounds
    DELETE FROM public.matches
    WHERE championship_id = ANY(draft_ids);

    DELETE FROM public.championship_registrations
    WHERE championship_id = ANY(draft_ids);

    DELETE FROM public.championship_rounds
    WHERE championship_id = ANY(draft_ids);

    DELETE FROM public.championships
    WHERE id = ANY(draft_ids);
END;
$$;
