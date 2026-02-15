-- Migration: championship_schema_alignment
-- Goal: keep championship admin queries stable and scoring rules consistent across environments.

-- 1) Registration columns compatibility and canonical defaults
ALTER TABLE public.championships
ADD COLUMN IF NOT EXISTS registration_closed BOOLEAN;

ALTER TABLE public.championships
ADD COLUMN IF NOT EXISTS registration_closed_at TIMESTAMPTZ;

ALTER TABLE public.championships
ADD COLUMN IF NOT EXISTS pts_technical_draw INTEGER;

UPDATE public.championships
SET registration_open = COALESCE(registration_open, TRUE)
WHERE registration_open IS NULL;

UPDATE public.championships
SET registration_closed = COALESCE(registration_closed, NOT registration_open)
WHERE registration_closed IS NULL;

UPDATE public.championships
SET registration_closed_at = NOW()
WHERE registration_closed = TRUE
  AND registration_closed_at IS NULL;

ALTER TABLE public.championships
ALTER COLUMN registration_open SET DEFAULT TRUE;

ALTER TABLE public.championships
ALTER COLUMN registration_open SET NOT NULL;

ALTER TABLE public.championships
ALTER COLUMN registration_closed SET DEFAULT FALSE;

ALTER TABLE public.championships
ALTER COLUMN registration_closed SET NOT NULL;

-- 2) Scoring columns cannot stay null (prevents 0-point standings regressions)
UPDATE public.championships
SET
    pts_victory = COALESCE(pts_victory, 3),
    pts_defeat = COALESCE(pts_defeat, 0),
    pts_wo_victory = COALESCE(pts_wo_victory, 3),
    pts_set = COALESCE(pts_set, 0),
    pts_game = COALESCE(pts_game, 0),
    pts_technical_draw = COALESCE(pts_technical_draw, 0)
WHERE
    pts_victory IS NULL
    OR pts_defeat IS NULL
    OR pts_wo_victory IS NULL
    OR pts_set IS NULL
    OR pts_game IS NULL
    OR pts_technical_draw IS NULL;

ALTER TABLE public.championships
ALTER COLUMN pts_victory SET DEFAULT 3;

ALTER TABLE public.championships
ALTER COLUMN pts_victory SET NOT NULL;

ALTER TABLE public.championships
ALTER COLUMN pts_defeat SET DEFAULT 0;

ALTER TABLE public.championships
ALTER COLUMN pts_defeat SET NOT NULL;

ALTER TABLE public.championships
ALTER COLUMN pts_wo_victory SET DEFAULT 3;

ALTER TABLE public.championships
ALTER COLUMN pts_wo_victory SET NOT NULL;

ALTER TABLE public.championships
ALTER COLUMN pts_set SET DEFAULT 0;

ALTER TABLE public.championships
ALTER COLUMN pts_set SET NOT NULL;

ALTER TABLE public.championships
ALTER COLUMN pts_game SET DEFAULT 0;

ALTER TABLE public.championships
ALTER COLUMN pts_game SET NOT NULL;

ALTER TABLE public.championships
ALTER COLUMN pts_technical_draw SET DEFAULT 0;

ALTER TABLE public.championships
ALTER COLUMN pts_technical_draw SET NOT NULL;

-- 3) Keep registration_open and registration_closed synchronized
CREATE OR REPLACE FUNCTION public.sync_championship_registration_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.registration_open := COALESCE(NEW.registration_open, TRUE);
        NEW.registration_closed := COALESCE(NEW.registration_closed, NOT NEW.registration_open);

        IF NEW.registration_closed THEN
            NEW.registration_closed_at := COALESCE(NEW.registration_closed_at, NOW());
        ELSE
            NEW.registration_closed_at := NULL;
        END IF;

        RETURN NEW;
    END IF;

    NEW.registration_open := COALESCE(NEW.registration_open, NOT COALESCE(NEW.registration_closed, FALSE));
    NEW.registration_closed := COALESCE(NEW.registration_closed, NOT NEW.registration_open);

    IF NEW.registration_open IS DISTINCT FROM OLD.registration_open THEN
        NEW.registration_closed := NOT NEW.registration_open;
    END IF;

    IF NEW.registration_closed IS DISTINCT FROM OLD.registration_closed THEN
        NEW.registration_open := NOT NEW.registration_closed;
    END IF;

    IF NEW.registration_closed = TRUE AND OLD.registration_closed IS DISTINCT FROM TRUE THEN
        NEW.registration_closed_at := COALESCE(NEW.registration_closed_at, NOW());
    ELSIF NEW.registration_closed = FALSE THEN
        NEW.registration_closed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_championship_registration_flags ON public.championships;

CREATE TRIGGER trg_sync_championship_registration_flags
BEFORE INSERT OR UPDATE OF registration_open, registration_closed
ON public.championships
FOR EACH ROW
EXECUTE FUNCTION public.sync_championship_registration_flags();
