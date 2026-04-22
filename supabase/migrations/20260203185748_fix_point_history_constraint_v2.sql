ALTER TABLE public.point_history DROP CONSTRAINT IF EXISTS point_history_event_type_check;

ALTER TABLE public.point_history ADD CONSTRAINT point_history_event_type_check 
CHECK (event_type IN (
  'Desafio', 'Campeonato', 'Aula', 'SuperSet', 'Torneio', 'Racha', 'Ranking', 'Outro',
  'superset', 'championship', 'challenge'
));;
