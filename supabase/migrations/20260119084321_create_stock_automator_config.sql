-- =====================================================
-- CREATE STOCK AUTOMATOR CONFIGURATION TABLE
-- Stores brands, categories, subcategories for the store
-- =====================================================

-- Create stores table if not exists (for foreign key)
CREATE TABLE IF NOT EXISTS public.stores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    cnpj TEXT,
    logo_url TEXT,
    address TEXT,
    phone TEXT,
    settings JSONB DEFAULT '{}',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default stores
INSERT INTO public.stores (id, name, cnpj) VALUES 
    ('11111111-1111-1111-1111-111111111111', 'Hospital dos iPhones Sobral', NULL),
    ('22222222-2222-2222-2222-222222222222', 'Hospital dos iPhones Fortaleza', NULL)
ON CONFLICT (id) DO NOTHING;

-- Add foreign key to products if not exists
DO $$ BEGIN
    ALTER TABLE public.products 
        ADD CONSTRAINT fk_products_store 
        FOREIGN KEY (store_id) REFERENCES public.stores(id);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create stock automator config table
CREATE TABLE IF NOT EXISTS public.stock_automator_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id UUID NOT NULL REFERENCES public.stores(id),
    config_type TEXT NOT NULL CHECK (config_type IN ('brand', 'category', 'subcategory', 'submarca', 'size_subtype', 'color')),
    value TEXT NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    sku_code TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (store_id, config_type, value)
);

CREATE INDEX IF NOT EXISTS idx_stock_automator_config_store ON public.stock_automator_config(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_automator_config_type ON public.stock_automator_config(config_type);

-- =====================================================
-- INSERT DEFAULT BRANDS (for HDI)
-- =====================================================

INSERT INTO public.stock_automator_config (store_id, config_type, value, sku_code, aliases)
SELECT '11111111-1111-1111-1111-111111111111', 'brand', brand_name, sku_code, aliases
FROM (VALUES 
    ('Volt', 'VT', ARRAY['volt', 'VOLT']::text[]),
    ('Geonav', 'GN', ARRAY['geonav', 'GEONAV', 'Geo Nav']::text[]),
    ('Gold Pro', 'GP', ARRAY['gold pro', 'goldpro', 'GOLD PRO']::text[]),
    ('Hprime', 'HP', ARRAY['hprime', 'HPRIME', 'H Prime', 'h-prime']::text[]),
    ('Energy', 'EN', ARRAY['energy', 'ENERGY']::text[]),
    ('iWill', 'IW', ARRAY['iwill', 'IWILL', 'i-will']::text[]),
    ('Dr Cell', 'DC', ARRAY['dr cell', 'drcell', 'DR CELL']::text[]),
    ('Khostar', 'KH', ARRAY['khostar', 'KHOSTAR']::text[]),
    ('Espada', 'ES', ARRAY['espada', 'ESPADA']::text[]),
    ('EZRA', 'EZ', ARRAY['ezra', 'Ezra']::text[]),
    ('Anker', 'AK', ARRAY['anker', 'ANKER']::text[]),
    ('HDI', 'HD', ARRAY['hdi', 'Hospital dos iPhones']::text[])
) AS t(brand_name, sku_code, aliases)
ON CONFLICT (store_id, config_type, value) DO NOTHING;

-- =====================================================
-- INSERT DEFAULT CATEGORIES (for HDI)
-- =====================================================

INSERT INTO public.stock_automator_config (store_id, config_type, value, sku_code, aliases)
SELECT '11111111-1111-1111-1111-111111111111', 'category', cat_name, sku_code, aliases
FROM (VALUES 
    ('Cabo', 'CAB', ARRAY['cable', 'cabo', 'CABO']::text[]),
    ('Película', 'PEL', ARRAY['pelicula', 'película', 'PELICULA', 'film', 'protetor de tela']::text[]),
    ('Fonte', 'FON', ARRAY['fonte', 'FONTE', 'carregador', 'charger', 'adapter']::text[]),
    ('Caixa de som', 'CXS', ARRAY['caixa de som', 'speaker', 'CAIXA DE SOM', 'caixa som']::text[]),
    ('Fone de Ouvido', 'AUD', ARRAY['fone', 'fone de ouvido', 'FONE', 'headphone', 'earphone', 'earbuds']::text[]),
    ('Carregador Veicular', 'CVE', ARRAY['carregador veicular', 'car charger', 'CARREGADOR VEICULAR']::text[]),
    ('Capa', 'CAP', ARRAY['capa', 'CAPA', 'case', 'capinha', 'cover']::text[]),
    ('Suporte', 'SUP', ARRAY['suporte', 'SUPORTE', 'holder', 'stand', 'mount']::text[]),
    ('Adaptador', 'ADP', ARRAY['adaptador', 'ADAPTADOR', 'adapter', 'dongle']::text[]),
    ('Hub', 'HUB', ARRAY['hub', 'HUB', 'dock', 'docking']::text[]),
    ('Pulseira', 'PUL', ARRAY['pulseira', 'PULSEIRA', 'band', 'strap', 'watch band']::text[]),
    ('Balança', 'BAL', ARRAY['balanca', 'balança', 'BALANCA', 'scale']::text[]),
    ('Tag', 'TAG', ARRAY['tag', 'TAG', 'airtag', 'localizador']::text[])
) AS t(cat_name, sku_code, aliases)
ON CONFLICT (store_id, config_type, value) DO NOTHING;

-- =====================================================
-- INSERT DEFAULT SUBMARCAS (for HDI)
-- =====================================================

INSERT INTO public.stock_automator_config (store_id, config_type, value, sku_code, aliases)
SELECT '11111111-1111-1111-1111-111111111111', 'submarca', submarca_name, sku_code, aliases
FROM (VALUES 
    ('Metal Pro', 'MP', ARRAY['metalpro', 'metal pro', 'METAL PRO', 'MetalPro']::text[]),
    ('Power Pro', 'PP', ARRAY['powerpro', 'power pro', 'POWER PRO', 'PowerPro']::text[]),
    ('Fiber', 'FB', ARRAY['fiber', 'FIBER', 'Fibra']::text[])
) AS t(submarca_name, sku_code, aliases)
ON CONFLICT (store_id, config_type, value) DO NOTHING;

-- =====================================================
-- INSERT DEFAULT SUBCATEGORIES (Cables)
-- =====================================================

INSERT INTO public.stock_automator_config (store_id, config_type, value, sku_code, aliases)
SELECT '11111111-1111-1111-1111-111111111111', 'subcategory', subcat_name, sku_code, aliases
FROM (VALUES 
    ('USB / Lightning', 'LGT', ARRAY['usb-lightning', 'lightning', 'usb lightning']::text[]),
    ('USB / Tipo C', 'USBC', ARRAY['usb-c', 'tipo c', 'type c', 'usb tipo c']::text[]),
    ('USB / Micro USB', 'MUSB', ARRAY['micro usb', 'micro-usb', 'microusb']::text[]),
    ('Tipo C / Tipo C', 'C2C', ARRAY['c to c', 'type c to type c', 'tipo c para tipo c']::text[]),
    ('Tipo C / Lightning', 'C2L', ARRAY['c to lightning', 'tipo c lightning']::text[]),
    ('P2 / Lightning', 'P2L', ARRAY['p2 lightning', 'aux lightning']::text[]),
    ('HDMI', 'HDMI', ARRAY['hdmi']::text[])
) AS t(subcat_name, sku_code, aliases)
ON CONFLICT (store_id, config_type, value) DO NOTHING;

-- =====================================================
-- COPY CONFIG TO FORTALEZA STORE
-- =====================================================

INSERT INTO public.stock_automator_config (store_id, config_type, value, sku_code, aliases, active)
SELECT '22222222-2222-2222-2222-222222222222', config_type, value, sku_code, aliases, active
FROM public.stock_automator_config
WHERE store_id = '11111111-1111-1111-1111-111111111111'
ON CONFLICT (store_id, config_type, value) DO NOTHING;

-- Grant permissions
GRANT ALL ON public.stock_automator_config TO authenticated;
GRANT SELECT ON public.stores TO authenticated;;
