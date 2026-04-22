
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON "public"."profiles";
CREATE POLICY "Enable insert for authenticated users only" ON "public"."profiles" FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Ensure update is also allowed
DROP POLICY IF EXISTS "Enable update for users based on email" ON "public"."profiles";
CREATE POLICY "Enable update for users based on email" ON "public"."profiles" FOR UPDATE USING (auth.uid() = id);
;
