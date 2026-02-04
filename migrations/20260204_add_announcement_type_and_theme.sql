-- Add type and theme to announcements
ALTER TABLE announcements
ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'banner';
ALTER TABLE announcements
ADD COLUMN IF NOT EXISTS theme TEXT;
ALTER TABLE announcements
ADD COLUMN IF NOT EXISTS agenda_date DATE;