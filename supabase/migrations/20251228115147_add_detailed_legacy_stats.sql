
-- Adicionar estatísticas detalhadas para dados legados
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS legacy_sets_lost integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS legacy_games_lost integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS legacy_tiebreaks_won integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS legacy_tiebreaks_lost integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS legacy_matches_played integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS legacy_matches_with_tiebreak integer DEFAULT 0;

-- Comentários
COMMENT ON COLUMN profiles.legacy_sets_lost IS 'Sets perdidos em campeonatos anteriores';
COMMENT ON COLUMN profiles.legacy_games_lost IS 'Games perdidos em campeonatos anteriores';
COMMENT ON COLUMN profiles.legacy_tiebreaks_won IS 'Tiebreaks vencidos em campeonatos anteriores';
COMMENT ON COLUMN profiles.legacy_tiebreaks_lost IS 'Tiebreaks perdidos em campeonatos anteriores';
COMMENT ON COLUMN profiles.legacy_matches_played IS 'Total de partidas disputadas em campeonatos anteriores';
COMMENT ON COLUMN profiles.legacy_matches_with_tiebreak IS 'Partidas que foram para tiebreak em campeonatos anteriores';
;
