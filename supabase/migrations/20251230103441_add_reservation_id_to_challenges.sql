-- Add reservation_id column to challenges table
ALTER TABLE challenges 
ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES reservations(id);;
