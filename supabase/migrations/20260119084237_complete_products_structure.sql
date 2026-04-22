-- =====================================================
-- COMPLETE PRODUCTS TABLE STRUCTURE
-- Adds all missing columns for HDI ERP
-- =====================================================

-- Add base columns first
ALTER TABLE public.products 
    ADD COLUMN IF NOT EXISTS store_id UUID,
    ADD COLUMN IF NOT EXISTS display_code TEXT,
    ADD COLUMN IF NOT EXISTS sku TEXT,
    ADD COLUMN IF NOT EXISTS brand TEXT,
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS subcategory TEXT,
    ADD COLUMN IF NOT EXISTS type TEXT,
    ADD COLUMN IF NOT EXISTS subtype TEXT,
    ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS sell_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS min_stock INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS warranty_time_days INTEGER DEFAULT 90,
    ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Copy price to sell_price if sell_price is empty
UPDATE public.products SET sell_price = price WHERE sell_price IS NULL AND price IS NOT NULL;

-- Now add the new accessory fields
ALTER TABLE public.products 
    ADD COLUMN IF NOT EXISTS submarca TEXT,
    ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT 'available',
    ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS color TEXT,
    ADD COLUMN IF NOT EXISTS size_subtype TEXT,
    ADD COLUMN IF NOT EXISTS compatibility TEXT;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_products_store ON public.products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products(brand);
CREATE INDEX IF NOT EXISTS idx_products_type ON public.products(type);;
