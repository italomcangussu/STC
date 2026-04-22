-- Add missing columns to reservations table
ALTER TABLE reservations 
    ADD COLUMN IF NOT EXISTS challenge_id UUID REFERENCES challenges(id),
    ADD COLUMN IF NOT EXISTS match_id UUID REFERENCES matches(id),
    ADD COLUMN IF NOT EXISTS participant_ids UUID[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS guest_name TEXT,
    ADD COLUMN IF NOT EXISTS guest_responsible_id UUID REFERENCES profiles(id),
    ADD COLUMN IF NOT EXISTS student_type TEXT,
    ADD COLUMN IF NOT EXISTS non_socio_student_id TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_reservations_challenge ON reservations(challenge_id);
CREATE INDEX IF NOT EXISTS idx_reservations_match ON reservations(match_id);;
