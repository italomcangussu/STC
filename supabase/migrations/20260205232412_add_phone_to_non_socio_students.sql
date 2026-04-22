-- Add phone column to non_socio_students table
ALTER TABLE public.non_socio_students
ADD COLUMN IF NOT EXISTS phone VARCHAR(20);;
