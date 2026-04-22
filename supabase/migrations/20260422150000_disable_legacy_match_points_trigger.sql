-- Disable legacy points trigger based on win/sets/games.
-- New scoring model: only championship + head-to-head (Desafio/SuperSet).

DROP TRIGGER IF EXISTS trg_calculate_match_points ON public.matches;
DROP FUNCTION IF EXISTS public.calculate_match_points();
