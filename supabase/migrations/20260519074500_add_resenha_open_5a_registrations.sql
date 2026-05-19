-- Add 5ª Classe registrations for the active Resenha Open edition.
-- Idempotent by championship + class + participant.

WITH active_resenha AS (
    SELECT c.id AS championship_id
    FROM public.championships c
    JOIN public.championship_series s ON s.id = c.series_id
    WHERE s.slug = 'resenha-open'
      AND c.status = 'active'
    ORDER BY c.created_at DESC
    LIMIT 1
),
socio_entries AS (
    SELECT *
    FROM (
        VALUES
            ('73d13c0f-e1fc-4d72-9138-2eb62cd96b25'::uuid), -- Davi Arcelino
            ('e94aef10-e42c-4760-a794-0bb719a073bf'::uuid), -- Derlan
            ('41a0e57a-469d-4271-97b4-43de351bfef3'::uuid), -- Diego Parente
            ('a585c738-98cc-45bf-a80a-e555f9cc16e3'::uuid), -- Ítalo Cangussú
            ('0f17caea-f877-4e5a-a4cb-bef83b6e0fdc'::uuid), -- Lucas Rodrigues
            ('7a20491d-ca9d-4c43-9fb9-49b6aa3adfd6'::uuid), -- Mailson Freitas
            ('8d5adbb8-8fd0-42f1-8253-5a37d3ef4aca'::uuid), -- Marcelino
            ('4ff66acf-223f-4aec-bdac-129bb30b4e71'::uuid)  -- Vinicius Cangussú
    ) AS v(user_id)
),
guest_entries AS (
    SELECT *
    FROM (
        VALUES
            ('Helder Filho'),
            ('Macel Ponte'),
            ('Mardes Souza'),
            ('Ricardo Barroso'),
            ('Romário Soares'),
            ('Thiago Freitas'),
            ('Victor Luceti'),
            ('Williams Santos')
    ) AS v(guest_name)
),
inserted_socios AS (
    INSERT INTO public.championship_registrations (
        championship_id,
        participant_type,
        user_id,
        class,
        cabeca_de_chave
    )
    SELECT
        ar.championship_id,
        'socio',
        se.user_id,
        '5ª Classe',
        false
    FROM active_resenha ar
    JOIN socio_entries se ON true
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.championship_registrations cr
        WHERE cr.championship_id = ar.championship_id
          AND cr.class = '5ª Classe'
          AND cr.user_id = se.user_id
    )
    RETURNING id
)
INSERT INTO public.championship_registrations (
    championship_id,
    participant_type,
    guest_name,
    class,
    cabeca_de_chave
)
SELECT
    ar.championship_id,
    'guest',
    ge.guest_name,
    '5ª Classe',
    false
FROM active_resenha ar
JOIN guest_entries ge ON true
WHERE NOT EXISTS (
    SELECT 1
    FROM public.championship_registrations cr
    WHERE cr.championship_id = ar.championship_id
      AND cr.class = '5ª Classe'
      AND cr.participant_type = 'guest'
      AND lower(btrim(cr.guest_name)) = lower(btrim(ge.guest_name))
);
