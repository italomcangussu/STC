-- Backfill Championship Points
INSERT INTO point_history (user_id, amount, event_type, event_id, description, earned_date, expires_at, status)
SELECT 
    cw.winner_id,
    CASE 
        WHEN cw.position = 1 THEN c.final_ranking_pts
        WHEN cw.position = 2 THEN FLOOR(c.final_ranking_pts / 2)
        WHEN cw.position = 3 THEN FLOOR(c.final_ranking_pts / 4)
        ELSE 0
    END as amount,
    'championship',
    c.id,
    CONCAT(c.name, ' - ', cw.category, ' (', cw.position, 'º Place)'),
    COALESCE(c.end_date, c.created_at::date),
    (COALESCE(c.end_date, c.created_at::date) + INTERVAL '1 year'),
    'active'
FROM championship_winners cw
JOIN championships c ON cw.championship_id = c.id
WHERE 
    CASE 
        WHEN cw.position = 1 THEN c.final_ranking_pts
        WHEN cw.position = 2 THEN FLOOR(c.final_ranking_pts / 2)
        WHEN cw.position = 3 THEN FLOOR(c.final_ranking_pts / 4)
        ELSE 0
    END > 0;

-- Backfill Challenge Points (Matches linked to Challenges)
INSERT INTO point_history (user_id, amount, event_type, event_id, description, earned_date, expires_at, status)
SELECT 
    m.winner_id,
    50, -- Assuming 50 points per challenge win
    'challenge',
    ch.id,
    'Challenge/Match Victory',
    m.date,
    (m.date + INTERVAL '1 year'),
    'active'
FROM matches m
JOIN challenges ch ON m.id = ch.match_id
WHERE m.winner_id IS NOT NULL AND m.status = 'finished';

-- Backfill SuperSet Matches (if they exist separately)
INSERT INTO point_history (user_id, amount, event_type, event_id, description, earned_date, expires_at, status)
SELECT 
    m.winner_id,
    50, -- Assuming 50 points per superset
    'superset',
    m.id,
    'SuperSet Victory',
    m.date,
    (m.date + INTERVAL '1 year'),
    'active'
FROM matches m
WHERE m.type = 'SuperSet' 
AND m.winner_id IS NOT NULL 
AND m.status = 'finished'
AND NOT EXISTS (SELECT 1 FROM challenges ch WHERE ch.match_id = m.id); -- Avoid duplicates if challenge linked
;
