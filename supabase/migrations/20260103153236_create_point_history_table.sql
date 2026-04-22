CREATE TABLE IF NOT EXISTS point_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  event_type TEXT CHECK (event_type IN ('championship', 'challenge', 'superset')),
  event_id UUID, -- Can be nullable as not all points might map to a strict FK depending on legacy data
  description TEXT, -- Readable description like "Winner 4ª Classe - Winter Circuit"
  earned_date DATE NOT NULL,
  expires_at DATE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast calculations of current balance
CREATE INDEX idx_point_history_calculation 
ON point_history (user_id, status, expires_at);

-- Add comment
COMMENT ON TABLE point_history IS 'Ledger of all points earned to allow for 1-year expiration policies.';
;
