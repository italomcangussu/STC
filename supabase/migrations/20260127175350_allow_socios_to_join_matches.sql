-- First, drop the old restrictive update policy
DROP POLICY IF EXISTS "Creator or Admin can update reservation" ON public.reservations;

-- Create a new policy that allows updates by Creator, Admin, or any Socio joining a 'Play' match
-- Note: We are using a permissive policy. For even tighter security, we could split this into two,
-- but this is the most direct fix for the current issue.
CREATE POLICY "Allow update for creators, admins, or participants"
ON public.reservations
FOR UPDATE
TO authenticated
USING (
  auth.uid() = creator_id 
  OR is_admin() 
  OR (type = 'Play' AND status = 'active')
)
WITH CHECK (
  auth.uid() = creator_id 
  OR is_admin() 
  OR (type = 'Play' AND status = 'active')
);
;
