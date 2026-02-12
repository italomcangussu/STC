SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'des';

-- Also select a few rows to see data format
SELECT * FROM public.des LIMIT 5;
