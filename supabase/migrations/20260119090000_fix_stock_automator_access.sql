-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

-- Temporarily disable RLS to ensure access works
ALTER TABLE public.stock_automator_config DISABLE ROW LEVEL SECURITY;

-- Grant all permissions
GRANT ALL ON public.stock_automator_config TO authenticated;
GRANT ALL ON public.stock_automator_config TO anon;
GRANT ALL ON public.stock_automator_config TO service_role;

-- Grant sequence usage
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;;
