-- Migration: admin_audit_logs
-- Goal: audit user logins and user-driven data changes for the admin access panel.

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id UUID NULL REFERENCES public.profiles(id),
    actor_name_snapshot TEXT NULL,
    actor_role TEXT NULL,
    action TEXT NOT NULL,
    table_name TEXT NULL,
    record_id TEXT NULL,
    target_user_id UUID NULL REFERENCES public.profiles(id),
    target_name_snapshot TEXT NULL,
    related_user_ids UUID[] NOT NULL DEFAULT '{}',
    changed_fields TEXT[] NULL,
    old_data JSONB NULL,
    new_data JSONB NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    source TEXT NOT NULL DEFAULT 'trigger',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_occurred_at_idx
    ON public.admin_audit_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_user_id_idx
    ON public.admin_audit_logs (actor_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_target_user_id_idx
    ON public.admin_audit_logs (target_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_related_user_ids_idx
    ON public.admin_audit_logs USING GIN (related_user_ids);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read admin audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can read admin audit logs"
ON public.admin_audit_logs
FOR SELECT
TO authenticated
USING (public.is_admin());

REVOKE ALL ON public.admin_audit_logs FROM PUBLIC;
GRANT SELECT ON public.admin_audit_logs TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_audit_try_uuid(p_value TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN p_value::uuid;
    END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_audit_related_users(p_table_name TEXT, p_row JSONB)
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_ids UUID[] := '{}';
    v_key TEXT;
    v_candidate UUID;
    v_value JSONB;
BEGIN
    IF p_row IS NULL THEN
        RETURN v_ids;
    END IF;

    FOREACH v_key IN ARRAY ARRAY[
        'user_id',
        'creator_id',
        'player_a_id',
        'player_b_id',
        'winner_id',
        'winner_id',
        'challenger_id',
        'challenged_id',
        'decided_by',
        'executed_by'
    ] LOOP
        v_candidate := public.admin_audit_try_uuid(p_row ->> v_key);
        IF v_candidate IS NOT NULL THEN
            v_ids := array_append(v_ids, v_candidate);
        END IF;
    END LOOP;

    IF p_table_name = 'profiles' THEN
        v_candidate := public.admin_audit_try_uuid(p_row ->> 'id');
        IF v_candidate IS NOT NULL THEN
            v_ids := array_append(v_ids, v_candidate);
        END IF;
    END IF;

    IF jsonb_typeof(p_row -> 'participant_ids') = 'array' THEN
        FOR v_value IN SELECT value FROM jsonb_array_elements(p_row -> 'participant_ids') LOOP
            v_candidate := public.admin_audit_try_uuid(trim(both '"' from v_value::text));
            IF v_candidate IS NOT NULL THEN
                v_ids := array_append(v_ids, v_candidate);
            END IF;
        END LOOP;
    END IF;

    RETURN COALESCE(ARRAY(SELECT DISTINCT unnest(v_ids)), '{}');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_audit_changed_fields(p_old JSONB, p_new JSONB)
RETURNS TEXT[]
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(array_agg(key ORDER BY key), '{}')
    FROM (
        SELECT n.key
        FROM jsonb_each(COALESCE(p_new, '{}'::jsonb)) n
        FULL OUTER JOIN jsonb_each(COALESCE(p_old, '{}'::jsonb)) o USING (key)
        WHERE n.value IS DISTINCT FROM o.value
    ) changed;
$$;

CREATE OR REPLACE FUNCTION public.admin_audit_insert_log(
    p_action TEXT,
    p_table_name TEXT DEFAULT NULL,
    p_record_id TEXT DEFAULT NULL,
    p_target_user_id UUID DEFAULT NULL,
    p_related_user_ids UUID[] DEFAULT '{}',
    p_changed_fields TEXT[] DEFAULT NULL,
    p_old_data JSONB DEFAULT NULL,
    p_new_data JSONB DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_source TEXT DEFAULT 'trigger',
    p_occurred_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_actor_name TEXT;
    v_actor_role TEXT;
    v_target_name TEXT;
    v_log_id UUID;
BEGIN
    IF v_actor IS NOT NULL THEN
        SELECT p.name, p.role::text
        INTO v_actor_name, v_actor_role
        FROM public.profiles p
        WHERE p.id = v_actor;
    END IF;

    IF p_target_user_id IS NOT NULL THEN
        SELECT p.name
        INTO v_target_name
        FROM public.profiles p
        WHERE p.id = p_target_user_id;
    END IF;

    INSERT INTO public.admin_audit_logs (
        occurred_at,
        actor_user_id,
        actor_name_snapshot,
        actor_role,
        action,
        table_name,
        record_id,
        target_user_id,
        target_name_snapshot,
        related_user_ids,
        changed_fields,
        old_data,
        new_data,
        metadata,
        source
    ) VALUES (
        p_occurred_at,
        v_actor,
        v_actor_name,
        v_actor_role,
        p_action,
        p_table_name,
        p_record_id,
        p_target_user_id,
        v_target_name,
        COALESCE(p_related_user_ids, '{}'),
        p_changed_fields,
        p_old_data,
        p_new_data,
        COALESCE(p_metadata, '{}'::jsonb),
        p_source
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_audit_insert_log(TEXT, TEXT, TEXT, UUID, UUID[], TEXT[], JSONB, JSONB, JSONB, TEXT, TIMESTAMPTZ) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_record_user_login(p_metadata JSONB DEFAULT '{}'::jsonb)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID := auth.uid();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
    END IF;

    RETURN public.admin_audit_insert_log(
        'login',
        NULL,
        NULL,
        v_actor,
        ARRAY[v_actor],
        NULL,
        NULL,
        NULL,
        COALESCE(p_metadata, '{}'::jsonb),
        'auth',
        NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_user_login(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_user_login(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_audit_table_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old JSONB := NULL;
    v_new JSONB := NULL;
    v_action TEXT := lower(TG_OP);
    v_row JSONB;
    v_record_id TEXT;
    v_related UUID[];
    v_target UUID;
    v_changed TEXT[];
BEGIN
    IF TG_TABLE_NAME = 'admin_audit_logs' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old := to_jsonb(OLD);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new := to_jsonb(NEW);
        v_row := v_new;
    ELSE
        v_row := v_old;
    END IF;

    v_record_id := COALESCE(v_row ->> 'id', v_row ->> 'uuid');
    v_related := public.admin_audit_related_users(TG_TABLE_NAME, v_row);
    v_target := NULLIF(v_related[1]::text, '')::uuid;

    IF TG_OP = 'UPDATE' THEN
        v_changed := public.admin_audit_changed_fields(v_old, v_new);
        IF COALESCE(array_length(v_changed, 1), 0) = 0 THEN
            RETURN NEW;
        END IF;
    ELSE
        v_changed := NULL;
    END IF;

    PERFORM public.admin_audit_insert_log(
        v_action,
        TG_TABLE_NAME,
        v_record_id,
        v_target,
        v_related,
        v_changed,
        v_old,
        v_new,
        '{}'::jsonb,
        'trigger',
        NOW()
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

DO $$
DECLARE
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'profiles',
        'access_requests',
        'reservations',
        'challenges',
        'matches',
        'championships',
        'point_history',
        'ranking_reset_events',
        'consumptions',
        'products'
    ] LOOP
        IF to_regclass('public.' || v_table) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_admin_audit_%I ON public.%I', v_table, v_table);
            EXECUTE format(
                'CREATE TRIGGER trg_admin_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.admin_audit_table_changes()',
                v_table,
                v_table
            );
        END IF;
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_audit_backfill_recent_table(p_table_name TEXT, p_time_column TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER := 0;
    v_sql TEXT;
BEGIN
    IF to_regclass('public.' || p_table_name) IS NULL THEN
        RETURN 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = p_table_name
          AND column_name = p_time_column
    ) THEN
        RETURN 0;
    END IF;

    v_sql := format($fmt$
        WITH rows_to_log AS (
            SELECT to_jsonb(t) AS row_data,
                   (t.%1$I)::timestamptz AS occurred_at
            FROM public.%2$I t
            WHERE (t.%1$I)::timestamptz >= NOW() - INTERVAL '3 days'
        ),
        inserted AS (
            INSERT INTO public.admin_audit_logs (
                occurred_at,
                action,
                table_name,
                record_id,
                target_user_id,
                target_name_snapshot,
                related_user_ids,
                changed_fields,
                new_data,
                metadata,
                source
            )
            SELECT
                r.occurred_at,
                'backfill_snapshot',
                %3$L,
                COALESCE(r.row_data ->> 'id', r.row_data ->> 'uuid'),
                (related.ids)[1],
                p.name,
                related.ids,
                NULL,
                r.row_data,
                jsonb_build_object('period', 'last_3_days', 'time_column', %1$L),
                'backfill'
            FROM rows_to_log r
            CROSS JOIN LATERAL (
                SELECT public.admin_audit_related_users(%3$L, r.row_data) AS ids
            ) related
            LEFT JOIN public.profiles p ON p.id = (related.ids)[1]
            WHERE NOT EXISTS (
                SELECT 1
                FROM public.admin_audit_logs existing
                WHERE existing.source = 'backfill'
                  AND existing.table_name = %3$L
                  AND existing.record_id IS NOT DISTINCT FROM COALESCE(r.row_data ->> 'id', r.row_data ->> 'uuid')
                  AND existing.occurred_at = r.occurred_at
            )
            RETURNING 1
        )
        SELECT count(*) FROM inserted
    $fmt$, p_time_column, p_table_name, p_table_name);

    EXECUTE v_sql INTO v_count;
    RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_audit_backfill_recent_table(TEXT, TEXT) FROM PUBLIC;

DO $$
DECLARE
    v_total INTEGER := 0;
BEGIN
    v_total := v_total + public.admin_audit_backfill_recent_table('profiles', 'updated_at');
    v_total := v_total + public.admin_audit_backfill_recent_table('access_requests', 'updated_at');
    v_total := v_total + public.admin_audit_backfill_recent_table('reservations', 'updated_at');
    v_total := v_total + public.admin_audit_backfill_recent_table('challenges', 'updated_at');
    v_total := v_total + public.admin_audit_backfill_recent_table('matches', 'updated_at');
    v_total := v_total + public.admin_audit_backfill_recent_table('championships', 'updated_at');
    v_total := v_total + public.admin_audit_backfill_recent_table('point_history', 'updated_at');
    v_total := v_total + public.admin_audit_backfill_recent_table('ranking_reset_events', 'created_at');
    v_total := v_total + public.admin_audit_backfill_recent_table('consumptions', 'created_at');
    v_total := v_total + public.admin_audit_backfill_recent_table('products', 'updated_at');

    RAISE NOTICE 'admin_audit_logs backfill inserted % rows from the last 3 days', v_total;
END $$;

DROP FUNCTION IF EXISTS public.admin_audit_backfill_recent_table(TEXT, TEXT);
