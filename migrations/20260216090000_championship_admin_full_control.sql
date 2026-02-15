-- Migration: championship_admin_full_control
-- Description: Adds full administrative control for championships (result types, audit logs,
-- technical draw points, and schema normalization for championship_group_members).

-- 1) Matches: richer result metadata
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS result_type TEXT NOT NULL DEFAULT 'played';

ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS admin_notes TEXT;

ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS result_set_by UUID REFERENCES public.profiles(id);

ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS result_set_at TIMESTAMPTZ;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'matches_result_type_check'
          AND conrelid = 'public.matches'::regclass
    ) THEN
        ALTER TABLE public.matches DROP CONSTRAINT matches_result_type_check;
    END IF;

    ALTER TABLE public.matches
        ADD CONSTRAINT matches_result_type_check
        CHECK (result_type IN ('played', 'walkover', 'technical_draw'));
END $$;

-- 2) Championships: explicit points for technical draw
ALTER TABLE public.championships
ADD COLUMN IF NOT EXISTS pts_technical_draw INTEGER NOT NULL DEFAULT 0;

-- 3) Admin audit log table
CREATE TABLE IF NOT EXISTS public.championship_admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    championship_id UUID NOT NULL REFERENCES public.championships(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    action TEXT NOT NULL,
    before_data JSONB,
    after_data JSONB,
    actor_user_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_champ_admin_audit_champ_created_at
    ON public.championship_admin_audit_logs(championship_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_champ_admin_audit_entity
    ON public.championship_admin_audit_logs(entity_type, entity_id);

-- 4) Schema normalization: championship_group_members.group_id as canonical
DO $$
DECLARE
    has_group_id BOOLEAN;
    has_legacy_group_id BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'championship_group_members'
          AND column_name = 'group_id'
    ) INTO has_group_id;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'championship_group_members'
          AND column_name = 'championship_group_id'
    ) INTO has_legacy_group_id;

    IF has_legacy_group_id AND NOT has_group_id THEN
        ALTER TABLE public.championship_group_members
            RENAME COLUMN championship_group_id TO group_id;
        has_group_id := TRUE;
    END IF;

    IF has_legacy_group_id AND has_group_id THEN
        EXECUTE '
            UPDATE public.championship_group_members
            SET group_id = COALESCE(group_id, championship_group_id)
            WHERE group_id IS NULL
              AND championship_group_id IS NOT NULL
        ';

        EXECUTE '
            ALTER TABLE public.championship_group_members
            DROP COLUMN championship_group_id
        ';
    END IF;
END $$;

-- Ensure canonical FK + index after normalization
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'championship_group_members_group_id_fkey'
          AND conrelid = 'public.championship_group_members'::regclass
    ) THEN
        ALTER TABLE public.championship_group_members
            ADD CONSTRAINT championship_group_members_group_id_fkey
            FOREIGN KEY (group_id)
            REFERENCES public.championship_groups(id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_championship_group_members_group
    ON public.championship_group_members(group_id);

-- 5) Helpful indexes for admin queries
CREATE INDEX IF NOT EXISTS idx_matches_champ_round_status
    ON public.matches(championship_id, round_id, status);

CREATE INDEX IF NOT EXISTS idx_matches_champ_result_type
    ON public.matches(championship_id, result_type);

-- 6) Integrity trigger: prevent technical draw in knockout and validate finished result payload
CREATE OR REPLACE FUNCTION public.validate_match_result_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_round_phase TEXT;
    v_is_knockout BOOLEAN := FALSE;
BEGIN
    IF NEW.result_type IS NULL THEN
        NEW.result_type := 'played';
    END IF;

    IF NEW.status = 'finished' THEN
        IF NEW.result_type = 'played' THEN
            IF NEW.winner_id IS NULL
               AND (
                    (SELECT COALESCE(SUM(v), 0) FROM unnest(COALESCE(NEW.score_a, ARRAY[]::INTEGER[])) v)
                  + (SELECT COALESCE(SUM(v), 0) FROM unnest(COALESCE(NEW.score_b, ARRAY[]::INTEGER[])) v)
               ) > 0 THEN
                RAISE EXCEPTION 'Played result requires winner_id';
            END IF;
        ELSIF NEW.result_type = 'walkover' THEN
            IF NEW.walkover_winner_id IS NULL
               AND NEW.walkover_winner_registration_id IS NULL THEN
                RAISE EXCEPTION 'Walkover result requires walkover winner';
            END IF;
        ELSIF NEW.result_type = 'technical_draw' THEN
            IF NEW.winner_id IS NOT NULL
               OR NEW.walkover_winner_id IS NOT NULL
               OR NEW.walkover_winner_registration_id IS NOT NULL THEN
                RAISE EXCEPTION 'Technical draw cannot define winner';
            END IF;
        END IF;
    END IF;

    IF NEW.result_type = 'technical_draw' THEN
        IF NEW.phase IN ('Oitavas', 'Quartas', 'Semi', 'Final', 'round_of_16', 'quarterfinal', 'semifinal', 'final') THEN
            v_is_knockout := TRUE;
        END IF;

        IF NEW.round_id IS NOT NULL THEN
            SELECT r.phase INTO v_round_phase
            FROM public.championship_rounds r
            WHERE r.id = NEW.round_id;

            IF v_round_phase LIKE 'mata-mata%' THEN
                v_is_knockout := TRUE;
            END IF;
        END IF;

        IF v_is_knockout THEN
            RAISE EXCEPTION 'technical_draw is not allowed in knockout phases';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_match_result_integrity ON public.matches;

CREATE TRIGGER trg_validate_match_result_integrity
BEFORE INSERT OR UPDATE OF status, result_type, winner_id, walkover_winner_id, walkover_winner_registration_id, round_id, phase
ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.validate_match_result_integrity();

-- 7) RLS for audit logs
ALTER TABLE public.championship_admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read championship admin audit logs" ON public.championship_admin_audit_logs;
CREATE POLICY "Admins can read championship admin audit logs"
ON public.championship_admin_audit_logs
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
    )
);

DROP POLICY IF EXISTS "Admins can insert championship admin audit logs" ON public.championship_admin_audit_logs;
CREATE POLICY "Admins can insert championship admin audit logs"
ON public.championship_admin_audit_logs
FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
    )
);

-- 8) Utility function for admin logging (optional use from RPC)
CREATE OR REPLACE FUNCTION public.log_championship_admin_action(
    p_championship_id UUID,
    p_entity_type TEXT,
    p_entity_id UUID,
    p_action TEXT,
    p_before_data JSONB DEFAULT NULL,
    p_after_data JSONB DEFAULT NULL,
    p_actor_user_id UUID DEFAULT auth.uid()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.championship_admin_audit_logs (
        championship_id,
        entity_type,
        entity_id,
        action,
        before_data,
        after_data,
        actor_user_id
    )
    VALUES (
        p_championship_id,
        p_entity_type,
        p_entity_id,
        p_action,
        p_before_data,
        p_after_data,
        p_actor_user_id
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_championship_admin_action(UUID, TEXT, UUID, TEXT, JSONB, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_championship_admin_action(UUID, TEXT, UUID, TEXT, JSONB, JSONB, UUID) TO authenticated;
