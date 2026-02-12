-- Execute this SQL in Supabase SQL Editor to add columns to products table
-- Go to: Supabase Dashboard > SQL Editor > New query

-- Add new columns to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT 'package',
ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 0;

-- Enable RLS policies for products if not already
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read products
DROP POLICY IF EXISTS "Allow authenticated users to read products" ON products;
CREATE POLICY "Allow authenticated users to read products" ON products
    FOR SELECT USING (auth.role() = 'authenticated');

-- Allow admins and lanchonete to manage products
DROP POLICY IF EXISTS "Allow admins to manage products" ON products;
CREATE POLICY "Allow admins to manage products" ON products
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND (profiles.role = 'admin' OR profiles.role = 'lanchonete')
        )
    );

-- Update existing products with default icons
UPDATE products SET icon = 'droplets' WHERE name ILIKE '%água%';
UPDATE products SET icon = 'cup-soda' WHERE name ILIKE '%refrigerante%';
UPDATE products SET icon = 'beer' WHERE name ILIKE '%cerveja%';
UPDATE products SET icon = 'candy' WHERE name ILIKE '%barra%' OR name ILIKE '%cereal%';

-- Done! Refresh the page after running this.
