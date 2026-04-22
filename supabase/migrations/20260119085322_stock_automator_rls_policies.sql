-- Enable RLS on stock_automator_config table
ALTER TABLE public.stock_automator_config ENABLE ROW LEVEL SECURITY;

-- Create a simple policy that allows authenticated users to access configs
-- Note: For proper multi-tenant isolation, you'd use get_user_store_ids() function
DROP POLICY IF EXISTS "stock_automator_config_authenticated_access" ON public.stock_automator_config;
CREATE POLICY "stock_automator_config_authenticated_access" ON public.stock_automator_config
FOR ALL 
TO authenticated
USING (true)
WITH CHECK (true);;
