CREATE OR REPLACE FUNCTION public.calculate_match_points() RETURNS TRIGGER AS $$
DECLARE p_a_points INTEGER := 0;
p_b_points INTEGER := 0;
p_a_wins BOOLEAN;
i INTEGER;
set_a INTEGER;
set_b INTEGER;
games_a INTEGER := 0;
games_b INTEGER := 0;
sets_won_a INTEGER := 0;
sets_won_b INTEGER := 0;
BEGIN -- 1. Check if points already exist for this match (Idempotency)
IF EXISTS (
    SELECT 1
    FROM public.point_history
    WHERE event_id = NEW.id
) THEN RETURN NEW;
END IF;
-- Only process finished matches
IF NEW.status != 'finished' THEN RETURN NEW;
END IF;
-- 2. Logic for SuperSet
IF NEW.type = 'SuperSet' THEN -- Verify winner exists
IF NEW.winner_id IS NOT NULL THEN
INSERT INTO public.point_history (
        user_id,
        amount,
        earned_date,
        expires_at,
        event_id,
        event_type,
        status,
        description
    )
VALUES (
        NEW.winner_id,
        10,
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '1 year',
        -- or season logic
        NEW.id,
        'SuperSet',
        'active',
        'Vitória em SuperSet'
    );
END IF;
RETURN NEW;
END IF;
-- 3. Logic for Desafio (Challenge)
IF NEW.type = 'Desafio' THEN -- Calculate Games and Sets
IF NEW.score_a IS NOT NULL
AND array_length(NEW.score_a, 1) > 0 THEN FOR i IN 1..array_length(NEW.score_a, 1) LOOP set_a := NEW.score_a [i];
-- Handle score_b safely (assume same length or check)
IF NEW.score_b IS NOT NULL
AND array_length(NEW.score_b, 1) >= i THEN set_b := NEW.score_b [i];
ELSE set_b := 0;
END IF;
-- Games Sum
games_a := games_a + set_a;
games_b := games_b + set_b;
-- Sets Won
IF set_a > set_b THEN sets_won_a := sets_won_a + 1;
ELSIF set_b > set_a THEN sets_won_b := sets_won_b + 1;
END IF;
END LOOP;
END IF;
-- Base Points for Win
p_a_wins := (NEW.winner_id = NEW.player_a_id);
IF p_a_wins THEN p_a_points := p_a_points + 100;
ELSE p_b_points := p_b_points + 100;
END IF;
-- Points for Sets (+10 per set)
p_a_points := p_a_points + (sets_won_a * 10);
p_b_points := p_b_points + (sets_won_b * 10);
-- Points for Games (+1 per game)
p_a_points := p_a_points + (games_a * 1);
p_b_points := p_b_points + (games_b * 1);
-- Insert for Player A
INSERT INTO public.point_history (
        user_id,
        amount,
        earned_date,
        expires_at,
        event_id,
        event_type,
        status,
        description
    )
VALUES (
        NEW.player_a_id,
        p_a_points,
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '1 year',
        NEW.id,
        'Desafio',
        'active',
        format('Desafio: %s pts (Win/Sets/Games)', p_a_points)
    );
-- Insert for Player B
INSERT INTO public.point_history (
        user_id,
        amount,
        earned_date,
        expires_at,
        event_id,
        event_type,
        status,
        description
    )
VALUES (
        NEW.player_b_id,
        p_b_points,
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '1 year',
        NEW.id,
        'Desafio',
        'active',
        format('Desafio: %s pts (Win/Sets/Games)', p_b_points)
    );
RETURN NEW;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Drop trigger if exists to avoid duplication errors during dev
DROP TRIGGER IF EXISTS trg_calculate_match_points ON public.matches;
-- Create Trigger
CREATE TRIGGER trg_calculate_match_points
AFTER
INSERT
    OR
UPDATE OF status ON public.matches FOR EACH ROW EXECUTE FUNCTION public.calculate_match_points();