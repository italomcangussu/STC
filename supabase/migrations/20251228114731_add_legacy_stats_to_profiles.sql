
-- Adicionar colunas de estatísticas legadas (campeonatos anteriores)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS legacy_wins integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS legacy_losses integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS legacy_sets_won integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS legacy_games_won integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS legacy_points integer DEFAULT 0;

-- Comentários para documentação
COMMENT ON COLUMN profiles.legacy_wins IS 'Vitórias de campeonatos anteriores (antes da migração)';
COMMENT ON COLUMN profiles.legacy_losses IS 'Derrotas de campeonatos anteriores';
COMMENT ON COLUMN profiles.legacy_sets_won IS 'Sets ganhos em campeonatos anteriores';
COMMENT ON COLUMN profiles.legacy_games_won IS 'Games ganhos em campeonatos anteriores';
COMMENT ON COLUMN profiles.legacy_points IS 'Pontos totais de campeonatos anteriores';
;
