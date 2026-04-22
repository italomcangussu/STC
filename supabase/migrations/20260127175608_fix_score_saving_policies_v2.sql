-- 1. Challenges: Enable RLS and add basic policies
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public select challenges" ON public.challenges;
CREATE POLICY "Public select challenges" ON public.challenges FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated can insert challenges" ON public.challenges;
CREATE POLICY "Authenticated can insert challenges" ON public.challenges FOR INSERT TO authenticated WITH CHECK (auth.uid() = challenger_id);

DROP POLICY IF EXISTS "Participants or Admin can update challenges" ON public.challenges;
CREATE POLICY "Participants or Admin can update challenges" ON public.challenges FOR UPDATE TO authenticated USING (auth.uid() IN (challenger_id, challenged_id) OR is_admin());

-- 2. Matches: Add INSERT policy for authenticated users
-- Regular users need to be able to save results of their own matches/supersets
DROP POLICY IF EXISTS "Authenticated can insert matches" ON public.matches;
CREATE POLICY "Authenticated can insert matches" ON public.matches FOR INSERT TO authenticated WITH CHECK (auth.uid() IN (player_a_id, player_b_id) OR is_admin());

-- 3. Reservations: Expand update policy to include 'Desafio' and allow finishing
DROP POLICY IF EXISTS "Allow update for creators, admins, or participants" ON public.reservations;
CREATE POLICY "Allow update for creators, admins, or participants"
ON public.reservations
FOR UPDATE
TO authenticated
USING (
  auth.uid() = creator_id 
  OR is_admin() 
  OR (type IN ('Play', 'Desafio') AND status = 'active')
)
WITH CHECK (
  auth.uid() = creator_id 
  OR is_admin() 
  OR (type IN ('Play', 'Desafio'))
);
;
