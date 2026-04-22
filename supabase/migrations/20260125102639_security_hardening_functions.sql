-- Migration: Security Hardening for SECURITY DEFINER functions
-- Date: 2026-01-25
-- Description: Adds SET search_path = '' to all SECURITY DEFINER functions in public schema 
-- to prevent potential search_path hijacking attacks.

-- 1. get_user_store_ids
CREATE OR REPLACE FUNCTION public.get_user_store_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
BEGIN
    RETURN (SELECT store_ids FROM public.profiles WHERE id = auth.uid());
END;
$$;

-- 2. is_admin
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$;

-- 3. upsert_crm_lead
CREATE OR REPLACE FUNCTION public.upsert_crm_lead(
        p_store_id UUID,
        p_phone TEXT,
        p_name TEXT DEFAULT NULL,
        p_contact_id TEXT DEFAULT NULL,
        p_entity_id TEXT DEFAULT NULL,
        p_channel_id UUID DEFAULT NULL
    ) RETURNS UUID 
    LANGUAGE plpgsql 
    SECURITY DEFINER 
    SET search_path = ''
AS $$
DECLARE v_lead_id UUID;
v_customer_id UUID;
BEGIN -- Try to find existing lead by phone (normalized)
SELECT id INTO v_lead_id
FROM public.crm_leads
WHERE store_id = p_store_id
    AND public.compare_phones(phone, p_phone);
IF v_lead_id IS NULL THEN -- Create new lead (Trigger tr_link_lead_to_customer will handle customer linkage)
INSERT INTO public.crm_leads (
        store_id,
        phone,
        name,
        contact_id,
        entity_id,
        source_channel_id,
        last_interaction_at
    )
VALUES (
        p_store_id,
        p_phone,
        p_name,
        p_contact_id,
        p_entity_id,
        p_channel_id,
        now()
    )
RETURNING id INTO v_lead_id;
ELSE -- Update existing lead
SELECT customer_id INTO v_customer_id
FROM public.crm_leads
WHERE id = v_lead_id;
IF v_customer_id IS NULL THEN 
SELECT id INTO v_customer_id
FROM public.customers
WHERE (
        store_id = p_store_id
        OR store_id IS NULL
    )
    AND (
        public.compare_phones(whatsapp, p_phone)
        OR public.compare_phones(alt_phone, p_phone)
    );
END IF;
UPDATE public.crm_leads
SET name = COALESCE(p_name, name),
    contact_id = COALESCE(p_contact_id, contact_id),
    entity_id = COALESCE(p_entity_id, entity_id),
    customer_id = COALESCE(v_customer_id, customer_id),
    is_customer = (COALESCE(v_customer_id, customer_id) IS NOT NULL),
    last_message_at = now(),
    last_interaction_at = now(),
    updated_at = now()
WHERE id = v_lead_id;
END IF;
RETURN v_lead_id;
END;
$$;

-- 4. increment_unread_count
CREATE OR REPLACE FUNCTION public.increment_unread_count(
        p_conversation_id UUID,
        p_last_customer_message_at TIMESTAMPTZ
    ) RETURNS VOID 
    LANGUAGE plpgsql 
    SECURITY DEFINER 
    SET search_path = ''
AS $$ 
BEGIN
UPDATE public.crm_conversations
SET unread_count = unread_count + 1,
    last_message_at = p_last_customer_message_at
WHERE id = p_conversation_id;
END;
$$;

-- 5. insert_stock_automator_config
CREATE OR REPLACE FUNCTION public.insert_stock_automator_config(p_store_id uuid, p_config_type text, p_value text, p_sku_code text, p_aliases text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
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

-- 6. get_stock_automator_config
CREATE OR REPLACE FUNCTION public.get_stock_automator_config(p_store_id uuid)
 RETURNS TABLE(id uuid, store_id uuid, config_type text, value text, sku_code text, aliases text[], active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
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

-- 7. refresh_familias_trigger
CREATE OR REPLACE FUNCTION public.refresh_familias_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
DECLARE
  arr text[];
BEGIN
  -- Build normalized array from NEW fields
  arr := public.normalize_and_expand_models(array_to_string(ARRAY[COALESCE(NEW.modelo_canonico,''), COALESCE(NEW.modelo_compativel,''), COALESCE(NEW.categoria,'')], ' '));
  IF arr IS NOT NULL THEN
    NEW.familias_backup := COALESCE(NEW.familias_backup, to_jsonb(NEW.familias)::text);
    NEW.familias := to_jsonb((SELECT array_agg(distinct trim(x)) FROM unnest(arr) x));
  END IF;
  RETURN NEW;
END; 
$$;

-- 8. get_lead_marketing_intelligence
CREATE OR REPLACE FUNCTION public.get_lead_marketing_intelligence(p_lead_id UUID) 
    RETURNS JSONB 
    LANGUAGE plpgsql 
    SECURITY DEFINER 
    SET search_path = ''
AS $$
DECLARE v_store_id UUID;
v_customer_id UUID;
v_phone TEXT;
-- Stats
v_total_spent NUMERIC(10, 2) := 0;
v_sales_count INTEGER := 0;
v_services_count INTEGER := 0;
v_last_purchase_at TIMESTAMPTZ;
v_stores_visited UUID [];
v_products_acquired TEXT [];
v_services_performed TEXT [];
v_abc_category TEXT;
-- Result
v_result JSONB;
BEGIN -- 1. Get Lead Info
SELECT store_id,
    customer_id,
    phone INTO v_store_id,
    v_customer_id,
    v_phone
FROM public.crm_leads
WHERE id = p_lead_id;
-- If no lead found, return null
IF NOT FOUND THEN RETURN NULL;
END IF;
-- 2. Aggregate SALES data
SELECT COALESCE(SUM(s.total_amount), 0),
    COUNT(s.id),
    MAX(s.sale_date),
    array_agg(DISTINCT s.store_id),
    array_agg(DISTINCT si.product_name) FILTER (
        WHERE si.product_name IS NOT NULL
    ) INTO v_total_spent,
    v_sales_count,
    v_last_purchase_at,
    v_stores_visited,
    v_products_acquired
FROM public.sales s
    LEFT JOIN public.sale_items si ON s.id = si.sale_id
    LEFT JOIN public.customers c ON s.customer_id = c.id
WHERE -- Match by explicit customer_id link on lead
    (
        v_customer_id IS NOT NULL
        AND s.customer_id = v_customer_id
    ) -- OR match by phone if customer_id link is missing/different
    OR (
        c.whatsapp = v_phone
        OR c.alt_phone = v_phone
    ) -- AND restrict to accessible stores
    AND s.store_id = ANY(public.get_user_store_ids());
-- Aggregate SERVICE ORDERS data
DECLARE v_os_total NUMERIC(10, 2);
v_os_count INTEGER;
v_os_last TIMESTAMPTZ;
v_os_stores UUID [];
v_os_services TEXT [];
BEGIN
SELECT COALESCE(SUM(so.total_value), 0),
    COUNT(so.id),
    MAX(so.finished_at),
    array_agg(DISTINCT so.store_id) INTO v_os_total,
    v_os_count,
    v_os_last,
    v_os_stores
FROM public.service_orders so
    LEFT JOIN public.customers c ON so.customer_id = c.id
WHERE (
        (
            v_customer_id IS NOT NULL
            AND so.customer_id = v_customer_id
        )
        OR (
            c.whatsapp = v_phone
            OR c.alt_phone = v_phone
        )
    )
    AND so.store_id = ANY(public.get_user_store_ids())
    AND so.status = 'finished';
v_total_spent := v_total_spent + v_os_total;
v_services_count := v_os_count;
IF v_os_last > v_last_purchase_at
OR v_last_purchase_at IS NULL THEN v_last_purchase_at := v_os_last;
END IF;
IF v_os_stores IS NOT NULL THEN v_stores_visited := ARRAY(
    SELECT DISTINCT unnest(v_stores_visited || v_os_stores)
);
END IF;
END;
-- 3. Calculate ABC Classification
IF v_total_spent >= 10000 THEN v_abc_category := 'A';
ELSIF v_total_spent >= 5000 THEN v_abc_category := 'B';
ELSE v_abc_category := 'C';
END IF;
-- 4. Build JSON Result
v_result := jsonb_build_object(
    'totalSpent',
    v_total_spent,
    'salesCount',
    v_sales_count,
    'servicesCount',
    v_services_count,
    'lastPurchaseAt',
    v_last_purchase_at,
    'storesVisited',
    v_stores_visited,
    'abcCategory',
    v_abc_category,
    'productsAcquired',
    COALESCE(v_products_acquired, '{}'::TEXT []),
    'servicesPerformed',
    '{}'::TEXT [] 
);
RETURN v_result;
END;
$$;;
