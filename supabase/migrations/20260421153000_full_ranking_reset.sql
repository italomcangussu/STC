-- Migration: full_ranking_reset
-- Goal: allow admins to fully reset ranking (points, wins, sets, games) and start a new ranking cycle.

-- Ensure legacy stats columns exist on profiles (idempotent safety for old environments)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_wins INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_losses INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_sets_won INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_sets_lost INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_games_won INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_games_lost INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_tiebreaks_won INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_tiebreaks_lost INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_matches_played INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_matches_with_tiebreak INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS legacy_points INTEGER DEFAULT 0;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Reset events (audit + cycle marker)
CREATE TABLE IF NOT EXISTS public.ranking_reset_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    executed_by UUID NOT NULL REFERENCES public.profiles(id),
    reason TEXT,
    reset_scope TEXT NOT NULL DEFAULT 'full',
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ranking_reset_events_executed_at
    ON public.ranking_reset_events(executed_at DESC);

ALTER TABLE public.ranking_reset_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read ranking reset events" ON public.ranking_reset_events;
CREATE POLICY "Admins can read ranking reset events"
ON public.ranking_reset_events
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role::text = 'admin'
    )
);

-- Public helper used by rankingService to know cycle start without exposing full audit rows
CREATE OR REPLACE FUNCTION public.get_ranking_cycle_start()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cycle_start TIMESTAMPTZ;
BEGIN
    SELECT r.executed_at
    INTO v_cycle_start
    FROM public.ranking_reset_events r
    ORDER BY r.executed_at DESC
    LIMIT 1;

    RETURN v_cycle_start;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ranking_cycle_start() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ranking_cycle_start() TO authenticated;

-- Main admin action: full reset of ranking counters + cycle marker event
CREATE OR REPLACE FUNCTION public.admin_reset_ranking_full(
    p_confirmation TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_event_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_affected_profiles INTEGER := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = v_actor
          AND p.role::text = 'admin'
    ) THEN
        RAISE EXCEPTION 'Apenas administradores podem zerar o ranking.' USING ERRCODE = '42501';
    END IF;

    IF COALESCE(BTRIM(p_confirmation), '') <> 'ZERAR' THEN
        RAISE EXCEPTION 'Confirmação inválida. Digite ZERAR para continuar.' USING ERRCODE = '22023';
    END IF;

    -- Prevent concurrent resets and keep cycle event ordering consistent
    LOCK TABLE public.ranking_reset_events IN EXCLUSIVE MODE;

    UPDATE public.profiles
    SET
        legacy_wins = 0,
        legacy_losses = 0,
        legacy_sets_won = 0,
        legacy_sets_lost = 0,
        legacy_games_won = 0,
        legacy_games_lost = 0,
        legacy_tiebreaks_won = 0,
        legacy_tiebreaks_lost = 0,
        legacy_matches_played = 0,
        legacy_matches_with_tiebreak = 0,
        legacy_points = 0
    WHERE role::text IN ('socio', 'admin')
      AND COALESCE(is_active, TRUE) = TRUE;

    GET DIAGNOSTICS v_affected_profiles = ROW_COUNT;

    INSERT INTO public.ranking_reset_events (
        executed_by,
        reason,
        reset_scope,
        executed_at
    ) VALUES (
        v_actor,
        NULLIF(BTRIM(p_reason), ''),
        'full',
        v_now
    )
    RETURNING id INTO v_event_id;

    RETURN jsonb_build_object(
        'event_id', v_event_id,
        'executed_at', v_now,
        'affected_profiles', v_affected_profiles,
        'reset_scope', 'full'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_ranking_full(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_ranking_full(TEXT, TEXT) TO authenticated;
