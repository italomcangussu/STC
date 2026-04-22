
-- Tabela para armazenar os campeões de cada categoria em cada campeonato
CREATE TABLE IF NOT EXISTS championship_winners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    championship_id uuid REFERENCES championships(id) ON DELETE CASCADE,
    category text NOT NULL,
    winner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
    position integer DEFAULT 1, -- 1 = campeão, 2 = vice, 3 = terceiro
    created_at timestamptz DEFAULT now(),
    UNIQUE(championship_id, category, position)
);

-- RLS
ALTER TABLE championship_winners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON championship_winners FOR SELECT USING (true);
CREATE POLICY "Admin insert" ON championship_winners FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin update" ON championship_winners FOR UPDATE USING (true);
;
