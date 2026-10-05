-- A student profile is metadata attached to an existing person or non-member
-- student. Existing people and reservation identifiers remain unchanged.
CREATE TABLE IF NOT EXISTS public.student_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    non_socio_student_id UUID REFERENCES public.non_socio_students(id) ON DELETE RESTRICT,
    technical_level TEXT CHECK (technical_level IN (
        'Iniciante',
        'Iniciante Avançado',
        'Intermediário',
        'Intermediário Avançado',
        'Avançado'
    )),
    student_status TEXT NOT NULL DEFAULT 'active'
        CHECK (student_status IN ('active', 'paused', 'ended')),
    professor_id UUID REFERENCES public.professors(id) ON DELETE SET NULL,
    card_expired_reviewed_for DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT student_profiles_single_person CHECK (
        (profile_id IS NOT NULL AND non_socio_student_id IS NULL)
        OR (profile_id IS NULL AND non_socio_student_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profiles_profile_id
    ON public.student_profiles(profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profiles_non_socio_id
    ON public.student_profiles(non_socio_student_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_professor_status
    ON public.student_profiles(professor_id, student_status);
CREATE INDEX IF NOT EXISTS idx_student_profiles_status_level
    ON public.student_profiles(student_status, technical_level);

CREATE TABLE IF NOT EXISTS public.student_level_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_profile_id UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE RESTRICT,
    previous_level TEXT CHECK (previous_level IS NULL OR previous_level IN (
        'Iniciante',
        'Iniciante Avançado',
        'Intermediário',
        'Intermediário Avançado',
        'Avançado'
    )),
    new_level TEXT NOT NULL CHECK (new_level IN (
        'Iniciante',
        'Iniciante Avançado',
        'Intermediário',
        'Intermediário Avançado',
        'Avançado'
    )),
    changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    observation TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_level_history_student_changed_at
    ON public.student_level_history(student_profile_id, changed_at DESC);

-- Preserve current roster membership and attach metadata to the existing IDs.
INSERT INTO public.student_profiles (non_socio_student_id, student_status, professor_id)
SELECT s.id,
       CASE WHEN COALESCE(s.is_active, true) THEN 'active' ELSE 'paused' END,
       s.professor_id
FROM public.non_socio_students AS s
ON CONFLICT (non_socio_student_id) DO NOTHING;

INSERT INTO public.student_profiles (profile_id, professor_id)
SELECT DISTINCT ON (p.id) p.id, r.professor_id
FROM public.reservations AS r
CROSS JOIN LATERAL unnest(COALESCE(r.participant_ids, ARRAY[]::UUID[])) AS participant_id
JOIN public.profiles AS p ON p.id = participant_id
WHERE r.type = 'Aula'
  AND r.professor_id IS NOT NULL
ORDER BY p.id, r.date DESC, r.start_time DESC
ON CONFLICT (profile_id) DO NOTHING;

ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_level_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.student_profiles TO authenticated;
GRANT SELECT ON public.student_level_history TO authenticated;

DROP POLICY IF EXISTS "Admins manage student profiles" ON public.student_profiles;
CREATE POLICY "Admins manage student profiles" ON public.student_profiles
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Professors read assigned student profiles" ON public.student_profiles;
CREATE POLICY "Professors read assigned student profiles" ON public.student_profiles
    FOR SELECT TO authenticated
    USING (
        profile_id = (SELECT auth.uid())
        OR professor_id IN (
            SELECT p.id FROM public.professors AS p WHERE p.user_id = (SELECT auth.uid())
        )
        OR EXISTS (
            SELECT 1
            FROM public.non_socio_students AS student
            WHERE student.id = student_profiles.non_socio_student_id
              AND student.responsible_socio_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Professors manage assigned student profiles" ON public.student_profiles;
CREATE POLICY "Professors manage assigned student profiles" ON public.student_profiles
    FOR INSERT TO authenticated
    WITH CHECK (
        profile_id = (SELECT auth.uid())
        OR professor_id IN (
            SELECT p.id FROM public.professors AS p WHERE p.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Professors update assigned student profiles" ON public.student_profiles;
CREATE POLICY "Professors update assigned student profiles" ON public.student_profiles
    FOR UPDATE TO authenticated
    USING (
        professor_id IN (
            SELECT p.id FROM public.professors AS p WHERE p.user_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        professor_id IN (
            SELECT p.id FROM public.professors AS p WHERE p.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Admins read student level history" ON public.student_level_history;
CREATE POLICY "Admins read student level history" ON public.student_level_history
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Professors read assigned student level history" ON public.student_level_history;
CREATE POLICY "Professors read assigned student level history" ON public.student_level_history
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.student_profiles AS student
            WHERE student.id = student_level_history.student_profile_id
              AND student.professor_id IN (
                  SELECT p.id FROM public.professors AS p WHERE p.user_id = (SELECT auth.uid())
              )
        )
    );

CREATE OR REPLACE FUNCTION public.record_student_level_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.technical_level IS NOT NULL THEN
        INSERT INTO public.student_level_history (
            student_profile_id, previous_level, new_level, changed_by
        ) VALUES (
            NEW.id, NULL, NEW.technical_level, auth.uid()
        );
    ELSIF TG_OP = 'UPDATE' AND NEW.technical_level IS DISTINCT FROM OLD.technical_level
          AND NEW.technical_level IS NOT NULL THEN
        INSERT INTO public.student_level_history (
            student_profile_id, previous_level, new_level, changed_by, observation
        ) VALUES (
            NEW.id,
            OLD.technical_level,
            NEW.technical_level,
            auth.uid(),
            NULLIF(current_setting('app.student_level_observation', true), '')
        );
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_student_level_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS student_profiles_record_level_change ON public.student_profiles;
CREATE TRIGGER student_profiles_record_level_change
    AFTER INSERT OR UPDATE OF technical_level ON public.student_profiles
    FOR EACH ROW EXECUTE FUNCTION public.record_student_level_change();

CREATE OR REPLACE FUNCTION public.set_student_level(
    p_student_profile_id UUID,
    p_new_level TEXT,
    p_observation TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF p_new_level IS NULL OR p_new_level NOT IN (
        'Iniciante',
        'Iniciante Avançado',
        'Intermediário',
        'Intermediário Avançado',
        'Avançado'
    ) THEN
        RAISE EXCEPTION 'Nível técnico inválido.' USING ERRCODE = '22023';
    END IF;

    PERFORM set_config('app.student_level_observation', COALESCE(p_observation, ''), true);
    UPDATE public.student_profiles
    SET technical_level = p_new_level,
        updated_at = now()
    WHERE id = p_student_profile_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Perfil de aluno não encontrado ou sem permissão.' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_student_level(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_student_level(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_student_profile_status_to_legacy_student()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.non_socio_student_id IS NOT NULL THEN
        UPDATE public.non_socio_students
        SET is_active = (NEW.student_status = 'active')
        WHERE id = NEW.non_socio_student_id
          AND is_active IS DISTINCT FROM (NEW.student_status = 'active');
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_student_profile_status_to_legacy_student() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS student_profiles_sync_legacy_status ON public.student_profiles;
CREATE TRIGGER student_profiles_sync_legacy_status
    AFTER UPDATE OF student_status ON public.student_profiles
    FOR EACH ROW
    WHEN (OLD.student_status IS DISTINCT FROM NEW.student_status)
    EXECUTE FUNCTION public.sync_student_profile_status_to_legacy_student();

COMMENT ON TABLE public.student_profiles IS
    'Student metadata linked to an existing member profile or non-member student; does not duplicate the person.';
COMMENT ON COLUMN public.student_profiles.student_status IS
    'Operational student status, independent of membership and Card Mensal payment status.';
COMMENT ON COLUMN public.student_profiles.card_expired_reviewed_for IS
    'Expired Card Mensal date already reviewed by the responsible professor.';
