-- Fix RLS Policies for consumptions table
-- Currently RLS is enabled but NO policies exist, blocking all operations

-- 1. Allow lanchonete to do everything (manage all consumptions)
CREATE POLICY "lanchonete_full_access" ON consumptions
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'lanchonete'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'lanchonete'
  )
);

-- 2. Allow users to see their own consumptions
CREATE POLICY "users_view_own" ON consumptions
FOR SELECT
USING (user_id = auth.uid());

-- 3. Allow admin to see all consumptions (for financial reports)
CREATE POLICY "admin_view_all" ON consumptions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'admin'
  )
);
;
