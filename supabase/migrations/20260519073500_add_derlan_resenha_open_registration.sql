-- Add Derlan as the 20th registration in the active Resenha Open bracket.
-- Idempotent: does nothing if Derlan is already registered in the active edition.

INSERT INTO public.championship_registrations (
    championship_id,
    participant_type,
    user_id,
    class,
    cabeca_de_chave
)
SELECT
    c.id,
    'socio',
    p.id,
    '4ª Classe',
    false
FROM public.championships c
JOIN public.championship_series s ON s.id = c.series_id
JOIN public.profiles p ON p.id = 'e94aef10-e42c-4760-a794-0bb719a073bf'
WHERE s.slug = 'resenha-open'
  AND c.status = 'active'
  AND NOT EXISTS (
      SELECT 1
      FROM public.championship_registrations cr
      WHERE cr.championship_id = c.id
        AND cr.user_id = p.id
  )
ORDER BY c.created_at DESC
LIMIT 1;
