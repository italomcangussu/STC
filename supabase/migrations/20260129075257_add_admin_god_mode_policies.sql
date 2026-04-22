-- Allow admins to update any profile (God Mode for User Management)
CREATE POLICY "Admins can update any profile"
ON "public"."profiles"
FOR UPDATE
TO "authenticated"
USING (is_admin());

-- Allow admins to insert any challenge (God Mode for Retro-Challenges)
CREATE POLICY "Admins can insert challenges"
ON "public"."challenges"
FOR INSERT
TO "authenticated"
WITH CHECK (is_admin());

-- Allow admins to delete any challenge (God Mode for Cleanup)
CREATE POLICY "Admins can delete challenges"
ON "public"."challenges"
FOR DELETE
TO "authenticated"
USING (is_admin());
;
