CREATE OR REPLACE FUNCTION public.get_lead_marketing_intelligence(p_lead_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_store_id UUID;
    v_customer_id UUID;
    v_phone TEXT;
    
    -- Stats
    v_total_spent NUMERIC(10, 2) := 0;
    v_sales_count INTEGER := 0;
    v_services_count INTEGER := 0;
    v_last_purchase_at TIMESTAMPTZ;
    v_stores_visited UUID[];
    v_products_acquired TEXT[];
    v_services_performed TEXT[];
    v_abc_category TEXT;
    
    -- Result
    v_result JSONB;
BEGIN
    -- 1. Get Lead Info
    SELECT store_id, customer_id, phone 
    INTO v_store_id, v_customer_id, v_phone
    FROM public.crm_leads
    WHERE id = p_lead_id;

    -- If no lead found, return null
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- 2. Aggregate SALES data
    -- Note: using get_user_store_ids() to enforce tenant isolation even in this security definer function
    SELECT 
        COALESCE(SUM(s.total_amount), 0),
        COUNT(s.id),
        MAX(s.sale_date),
        array_agg(DISTINCT s.store_id),
        array_agg(DISTINCT si.product_name) FILTER (WHERE si.product_name IS NOT NULL)
    INTO 
        v_total_spent,
        v_sales_count,
        v_last_purchase_at,
        v_stores_visited,
        v_products_acquired
    FROM public.sales s
    LEFT JOIN public.sale_items si ON s.id = si.sale_id
    LEFT JOIN public.customers c ON s.customer_id = c.id
    WHERE 
        -- Match by explicit customer_id link on lead
        (v_customer_id IS NOT NULL AND s.customer_id = v_customer_id)
        -- OR match by phone if customer_id link is missing/different
        OR (c.whatsapp = v_phone OR c.alt_phone = v_phone)
        -- AND restrict to accessible stores
        AND s.store_id = ANY(get_user_store_ids());
        
    -- Aggregate SERVICE ORDERS data
    DECLARE
        v_os_total NUMERIC(10,2);
        v_os_count INTEGER;
        v_os_last TIMESTAMPTZ;
        v_os_stores UUID[];
        v_os_services TEXT[]; 
    BEGIN
        SELECT 
            COALESCE(SUM(so.total_value), 0),
            COUNT(so.id),
            MAX(so.finished_at),
            array_agg(DISTINCT so.store_id)
        INTO 
            v_os_total,
            v_os_count,
            v_os_last,
            v_os_stores
        FROM public.service_orders so
        LEFT JOIN public.customers c ON so.customer_id = c.id
        WHERE 
            ((v_customer_id IS NOT NULL AND so.customer_id = v_customer_id)
            OR (c.whatsapp = v_phone OR c.alt_phone = v_phone))
            AND so.store_id = ANY(get_user_store_ids())
            AND so.status = 'finished'; 
            
        -- Add to totals
        v_total_spent := v_total_spent + v_os_total;
        v_services_count := v_os_count;
        IF v_os_last > v_last_purchase_at OR v_last_purchase_at IS NULL THEN
            v_last_purchase_at := v_os_last;
        END IF;
        
        -- Merge store arrays
        IF v_os_stores IS NOT NULL THEN
            v_stores_visited :=  ARRAY(SELECT DISTINCT unnest(v_stores_visited || v_os_stores));
        END IF;
    END;

    -- 3. Calculate ABC Classification
    -- A: > 10,000
    -- B: > 5,000
    -- C: <= 5,000
    IF v_total_spent >= 10000 THEN
        v_abc_category := 'A';
    ELSIF v_total_spent >= 5000 THEN
        v_abc_category := 'B';
    ELSE
        v_abc_category := 'C';
    END IF;

    -- 4. Build JSON Result
    v_result := jsonb_build_object(
        'totalSpent', v_total_spent,
        'salesCount', v_sales_count,
        'servicesCount', v_services_count,
        'lastPurchaseAt', v_last_purchase_at,
        'storesVisited', v_stores_visited,
        'abcCategory', v_abc_category,
        'productsAcquired', COALESCE(v_products_acquired, '{}'::TEXT[]),
        'servicesPerformed', '{}'::TEXT[]
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_marketing_intelligence(UUID) TO authenticated;
;
