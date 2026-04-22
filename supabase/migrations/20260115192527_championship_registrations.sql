-- Championship Registrations table for managing signups
CREATE TABLE championship_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  championship_id UUID NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  participant_type TEXT NOT NULL CHECK (participant_type IN ('socio', 'guest')),
  user_id UUID REFERENCES profiles(id),
  guest_name TEXT,
  class TEXT NOT NULL,
  shirt_size TEXT NOT NULL CHECK (shirt_size IN ('P', 'M', 'G', 'GG', 'XGG')),
  created_at TIMESTAMPTZ DEFAULT now(),
  registered_by UUID REFERENCES profiles(id),
  
  CONSTRAINT valid_participant CHECK (
    (participant_type = 'socio' AND user_id IS NOT NULL) OR
    (participant_type = 'guest' AND guest_name IS NOT NULL)
  )
);

-- Add registration status to championships
ALTER TABLE championships ADD COLUMN IF NOT EXISTS registration_open BOOLEAN DEFAULT false;

-- RLS Policies
ALTER TABLE championship_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view registrations" ON championship_registrations
  FOR SELECT USING (true);

CREATE POLICY "Admins can insert registrations" ON championship_registrations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update registrations" ON championship_registrations
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete registrations" ON championship_registrations
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Index for faster queries
CREATE INDEX idx_championship_registrations_championship ON championship_registrations(championship_id);
CREATE INDEX idx_championship_registrations_class ON championship_registrations(class);;
