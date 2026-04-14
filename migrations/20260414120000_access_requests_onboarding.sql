-- Migration: access_requests_onboarding
-- Goal: support athlete onboarding by phone OTP with admin approval flow.

CREATE TABLE IF NOT EXISTS public.access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    phone_normalized TEXT NOT NULL,
    email TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT NULL,
    decided_by UUID NULL REFERENCES public.profiles(id),
    decided_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS access_requests_phone_normalized_key
    ON public.access_requests (phone_normalized);

CREATE INDEX IF NOT EXISTS access_requests_status_created_at_idx
    ON public.access_requests (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.access_requests_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_access_requests_updated_at ON public.access_requests;
CREATE TRIGGER trg_access_requests_updated_at
    BEFORE UPDATE ON public.access_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.access_requests_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.access_requests TO anon, authenticated;

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'access_requests'
          AND policyname = 'Anon can submit access requests'
    ) THEN
        CREATE POLICY "Anon can submit access requests"
            ON public.access_requests
            FOR INSERT
            TO anon, authenticated
            WITH CHECK (status = 'pending');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'access_requests'
          AND policyname = 'Anon can resubmit access requests'
    ) THEN
        CREATE POLICY "Anon can resubmit access requests"
            ON public.access_requests
            FOR UPDATE
            TO anon, authenticated
            USING (status IN ('pending', 'rejected'))
            WITH CHECK (
                status = 'pending'
                AND decided_by IS NULL
                AND decided_at IS NULL
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'access_requests'
          AND policyname = 'Admins can read access requests'
    ) THEN
        CREATE POLICY "Admins can read access requests"
            ON public.access_requests
            FOR SELECT
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    WHERE p.id = auth.uid()
                      AND p.role = 'admin'
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'access_requests'
          AND policyname = 'Admins can manage access requests'
    ) THEN
        CREATE POLICY "Admins can manage access requests"
            ON public.access_requests
            FOR ALL
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    WHERE p.id = auth.uid()
                      AND p.role = 'admin'
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    WHERE p.id = auth.uid()
                      AND p.role = 'admin'
                )
            );
    END IF;
END $$;
