-- Update Carlos Carneiro to 4ª Classe and reset legacy points
-- The 10 points from the SuperSet will be calculated automatically if the match is registered in the system.

UPDATE profiles 
SET 
    category = '4ª Classe',
    legacy_points = 0,
    legacy_wins = 0,
    legacy_losses = 0,
    legacy_sets_won = 0,
    legacy_sets_lost = 0,
    legacy_games_won = 0,
    legacy_games_lost = 0,
    legacy_tiebreaks_won = 0,
    legacy_tiebreaks_lost = 0,
    legacy_matches_played = 0,
    legacy_matches_with_tiebreak = 0
WHERE name ILIKE 'Carlos Carneiro';
