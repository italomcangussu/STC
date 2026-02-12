-- Purpose: Support multiple non-socio/dependent students per class reservation

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'reservations'
    ) THEN

        ALTER TABLE public.reservations
        ADD COLUMN IF NOT EXISTS non_socio_student_ids UUID[];

        -- Backfill legacy data where non-socio students were stored in participant_ids
        UPDATE public.reservations r
        SET non_socio_student_ids = (
            SELECT ARRAY(
                SELECT DISTINCT u
                FROM unnest(r.participant_ids) u
                WHERE EXISTS (SELECT 1 FROM public.non_socio_students s WHERE s.id = u)
            )
        ),
        participant_ids = ARRAY[]::uuid[]
        WHERE r.type = 'Aula'
        AND r.student_type = 'non-socio'
        AND r.participant_ids IS NOT NULL
        AND array_length(r.participant_ids, 1) > 0
        AND (r.non_socio_student_ids IS NULL OR array_length(r.non_socio_student_ids, 1) IS NULL)
        AND r.non_socio_student_id IS NULL;

        -- Ensure legacy single student column is present in the new array
        UPDATE public.reservations r
        SET non_socio_student_ids = ARRAY(
            SELECT DISTINCT u
            FROM unnest(
                COALESCE(r.non_socio_student_ids, ARRAY[]::uuid[]) ||
                CASE WHEN r.non_socio_student_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[r.non_socio_student_id]::uuid[] END
            ) u
        )
        WHERE r.type = 'Aula'
        AND r.non_socio_student_id IS NOT NULL;

        -- Optional compatibility: keep non_socio_student_id when there's exactly one student
        UPDATE public.reservations r
        SET non_socio_student_id = r.non_socio_student_ids[1]
        WHERE r.type = 'Aula'
        AND r.non_socio_student_id IS NULL
        AND r.non_socio_student_ids IS NOT NULL
        AND array_length(r.non_socio_student_ids, 1) = 1;

    ELSE
        RAISE NOTICE 'Table public.reservations not found; skipping add_non_socio_student_ids migration.';
    END IF;
END
$$;
