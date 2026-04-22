-- Create a function to get stock automator config
-- This bypasses the PostgREST schema cache issue
CREATE OR REPLACE FUNCTION get_stock_automator_config(p_store_id UUID)
RETURNS TABLE (
    id UUID,
    store_id UUID,
    config_type TEXT,
    value TEXT,
    sku_code TEXT,
    aliases TEXT[],
    active BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sac.id,
        sac.store_id,
        sac.config_type,
        sac.value,
        sac.sku_code,
        sac.aliases,
        sac.active
    FROM public.stock_automator_config sac
    WHERE sac.store_id = p_store_id
    AND sac.active = true
    ORDER BY sac.config_type, sac.value;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_stock_automator_config TO authenticated;
GRANT EXECUTE ON FUNCTION get_stock_automator_config TO anon;

-- Also create insert function
CREATE OR REPLACE FUNCTION insert_stock_automator_config(
    p_store_id UUID,
    p_config_type TEXT,
    p_value TEXT,
    p_sku_code TEXT,
    p_aliases TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_id UUID;
BEGIN
    INSERT INTO public.stock_automator_config (store_id, config_type, value, sku_code, aliases, active)
    VALUES (p_store_id, p_config_type, p_value, p_sku_code, p_aliases, true)
    RETURNING id INTO new_id;
    
    RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_stock_automator_config TO authenticated;

-- Reload schema
NOTIFY pgrst, 'reload schema';;
