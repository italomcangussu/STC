
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON "public"."profiles";
DROP POLICY IF EXISTS "Enable update for users based on email" ON "public"."profiles";
DROP POLICY IF EXISTS "Users can insert their own profile" ON "public"."profiles";
DROP POLICY IF EXISTS "Users can update their own profile" ON "public"."profiles";

CREATE POLICY "Enable insert for authenticated" ON "public"."profiles" FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Enable update for authenticated" ON "public"."profiles" FOR UPDATE TO authenticated USING (true);
;
