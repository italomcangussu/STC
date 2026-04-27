-- Migration: admin_audit_app_access
-- Goal: record app openings/session resumes separately from explicit login events.

CREATE OR REPLACE FUNCTION public.admin_record_user_access(
    p_event TEXT DEFAULT 'app_open',
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_event TEXT := COALESCE(NULLIF(BTRIM(p_event), ''), 'app_open');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
    END IF;

    IF v_event NOT IN ('login', 'app_open') THEN
        RAISE EXCEPTION 'Evento de acesso inválido.' USING ERRCODE = '22023';
    END IF;

    RETURN public.admin_audit_insert_log(
        v_event,
        NULL,
        NULL,
        v_actor,
        ARRAY[v_actor],
        NULL,
        NULL,
        NULL,
        COALESCE(p_metadata, '{}'::jsonb),
        CASE WHEN v_event = 'login' THEN 'auth' ELSE 'app' END,
        NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_user_access(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_user_access(TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_record_user_login(p_metadata JSONB DEFAULT '{}'::jsonb)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.admin_record_user_access('login', COALESCE(p_metadata, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_user_login(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_user_login(JSONB) TO authenticated;
