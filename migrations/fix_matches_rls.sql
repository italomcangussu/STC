-- 1. Drop existing loose policy
DROP POLICY IF EXISTS "Public update championship matches" ON matches;
DROP POLICY IF EXISTS "Public select matches" ON matches;
-- 2. Re-create Public Select (View) Policy
CREATE POLICY "Public select matches" ON matches FOR
SELECT USING (true);
-- 3. Create Admin Full Access Policy
CREATE POLICY "Admins manage matches" ON matches FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
    )
);
-- 4. Create Player Update Policy (Own matches only, not finished)
CREATE POLICY "Players update own matches" ON matches FOR
UPDATE USING (
        -- Must be one of the players in the match
        (
            auth.uid() = player_a_id
            OR auth.uid() = player_b_id
        )
        AND -- Match must not be finished
        status != 'finished'
    );
-- Ensure RLS is enabled
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;