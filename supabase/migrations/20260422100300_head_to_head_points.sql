-- Migration: head_to_head_points
-- Goal: track Desafio (8 pts) and SUPERSET (3 pts) head-to-head records.
--       Active record per pair is invalidated when the same pair plays again.
--       Guests/non-socios are excluded.

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.head_to_head_points (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    winner_id               UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    loser_id                UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    match_type              TEXT        NOT NULL CHECK (match_type IN ('challenge', 'superset')),
    points                  INTEGER     NOT NULL CHECK (points > 0),
    match_id                UUID        REFERENCES public.matches(id),
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    invalidated_at          TIMESTAMPTZ,
    invalidated_by_match_id UUID        REFERENCES public.matches(id),

    CONSTRAINT h2h_different_players CHECK (winner_id <> loser_id)
);

ALTER TABLE public.head_to_head_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read h2h points"
    ON public.head_to_head_points FOR SELECT
    TO authenticated USING (true);

CREATE POLICY "Service role manages h2h points"
    ON public.head_to_head_points FOR ALL
    USING (auth.role() = 'service_role');

-- Fast lookup by pair (order-independent) for active records
CREATE INDEX IF NOT EXISTS idx_h2h_pair_active
    ON public.head_to_head_points (
        LEAST(winner_id::TEXT, loser_id::TEXT),
        GREATEST(winner_id::TEXT, loser_id::TEXT)
    )
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_h2h_winner ON public.head_to_head_points (winner_id, is_active);

-- ─── 2. Function: process a new Desafio/SUPERSET match ───────────────────────
-- Called by trigger after a match of type Desafio/SuperSet is finished.
-- Invalidates previous active H2H record for the pair (if any),
-- creates a new active record for current winner.
-- Guests are excluded: only socios participate in H2H points.

CREATE OR REPLACE FUNCTION public.process_head_to_head_points()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_match_type    TEXT;
    v_points        INTEGER;
    v_winner_id     UUID;
    v_loser_id      UUID;
    v_existing      RECORD;
    v_winner_role   TEXT;
    v_loser_role    TEXT;
BEGIN
    -- Only process finished matches of relevant types
    IF NEW.status <> 'finished' OR NEW.winner_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'finished' THEN
        RETURN NEW; -- already processed
    END IF;

    -- Map match type to H2H category and points
    IF NEW.type IN ('Desafio', 'Desafio Ranking') THEN
        v_match_type := 'challenge';
        v_points     := 8;
    ELSIF NEW.type = 'SuperSet' THEN
        v_match_type := 'superset';
        v_points     := 3;
    ELSE
        RETURN NEW; -- not a H2H type
    END IF;

    v_winner_id := NEW.winner_id;
    v_loser_id  := CASE
        WHEN NEW.player_a_id = v_winner_id THEN NEW.player_b_id
        ELSE NEW.player_a_id
    END;

    IF v_loser_id IS NULL THEN
        RETURN NEW; -- no loser (guest or missing data)
    END IF;

    -- Exclude guests: only socios/admins get H2H points
    SELECT role INTO v_winner_role FROM public.profiles WHERE id = v_winner_id;
    SELECT role INTO v_loser_role  FROM public.profiles WHERE id = v_loser_id;

    IF v_winner_role NOT IN ('socio', 'admin') THEN
        RETURN NEW;
    END IF;
    -- Loser can be guest — winner still earns, guest just doesn't get a record

    -- Invalidate any existing active record between this pair (either direction)
    FOR v_existing IN
        SELECT id, winner_id, points
        FROM   public.head_to_head_points
        WHERE  is_active = TRUE
          AND  match_type = v_match_type
          AND  (
              (winner_id = v_winner_id AND loser_id = v_loser_id) OR
              (winner_id = v_loser_id  AND loser_id = v_winner_id)
          )
    LOOP
        UPDATE public.head_to_head_points
        SET    is_active               = FALSE,
               invalidated_at          = NOW(),
               invalidated_by_match_id = NEW.id
        WHERE  id = v_existing.id;

        -- Remove points from the previous winner in point_history
        INSERT INTO public.point_history (
            user_id, amount, event_type, event_id,
            description, earned_date, expires_at, reason, status
        ) VALUES (
            v_existing.winner_id,
            -v_existing.points,
            CASE WHEN v_match_type = 'challenge' THEN 'Desafio' ELSE 'SuperSet' END,
            NEW.id,
            'H2H invalidado por novo confronto',
            NOW()::DATE,
            NOW()::DATE,
            'head_to_head_invalidation',
            'active'
        );

        UPDATE public.profiles
        SET    legacy_points = GREATEST(0, COALESCE(legacy_points, 0) - v_existing.points)
        WHERE  id = v_existing.winner_id;
    END LOOP;

    -- Create new active record for current winner
    INSERT INTO public.head_to_head_points (
        winner_id, loser_id, match_type, points, match_id, is_active
    ) VALUES (
        v_winner_id, v_loser_id, v_match_type, v_points, NEW.id, TRUE
    );

    -- Award points to winner (only if socio/admin)
    INSERT INTO public.point_history (
        user_id, amount, event_type, event_id,
        description, earned_date, expires_at, reason, status
    ) VALUES (
        v_winner_id,
        v_points,
        CASE WHEN v_match_type = 'challenge' THEN 'Desafio' ELSE 'SuperSet' END,
        NEW.id,
        CASE WHEN v_match_type = 'challenge'
             THEN 'Desafio: ' || v_points || ' pts (válido até próximo confronto)'
             ELSE 'SUPERSET: ' || v_points || ' pts (válido até próximo confronto)'
        END,
        NOW()::DATE,
        (NOW() + INTERVAL '2 years')::DATE,
        'head_to_head_earn',
        'active'
    );

    UPDATE public.profiles
    SET    legacy_points = COALESCE(legacy_points, 0) + v_points
    WHERE  id = v_winner_id;

    RETURN NEW;
END;
$$;

-- ─── 3. Attach trigger to matches ────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_process_head_to_head ON public.matches;
CREATE TRIGGER trg_process_head_to_head
    AFTER UPDATE OF status ON public.matches
    FOR EACH ROW
    WHEN (NEW.status = 'finished' AND OLD.status <> 'finished')
    EXECUTE FUNCTION public.process_head_to_head_points();

-- ─── 4. RPC helper: get active H2H points summary per user ───────────────────

CREATE OR REPLACE FUNCTION public.get_user_h2h_points(p_user_id UUID)
RETURNS TABLE (
    opponent_id     UUID,
    opponent_name   TEXT,
    match_type      TEXT,
    points          INTEGER,
    since           TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT
        CASE WHEN h.winner_id = p_user_id THEN h.loser_id ELSE h.winner_id END AS opponent_id,
        p.name                                                                   AS opponent_name,
        h.match_type,
        CASE WHEN h.winner_id = p_user_id THEN h.points ELSE 0 END             AS points,
        h.created_at                                                             AS since
    FROM   public.head_to_head_points h
    JOIN   public.profiles p
           ON p.id = CASE WHEN h.winner_id = p_user_id THEN h.loser_id ELSE h.winner_id END
    WHERE  h.is_active = TRUE
      AND  (h.winner_id = p_user_id OR h.loser_id = p_user_id)
    ORDER  BY h.points DESC, h.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_h2h_points(UUID) TO authenticated, anon;
