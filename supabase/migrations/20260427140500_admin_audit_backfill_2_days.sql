-- Migration: admin_audit_backfill_2_days
-- Goal: backfill audit snapshots for records changed in the last 2 days before audit logging started.

CREATE OR REPLACE FUNCTION public.admin_audit_backfill_recent_table(
    p_table_name TEXT,
    p_time_column TEXT,
    p_since TIMESTAMPTZ,
    p_until TIMESTAMPTZ
)
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
            WHERE (t.%1$I)::timestamptz >= $1
              AND (t.%1$I)::timestamptz < $2
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
                jsonb_build_object('period', 'last_2_days', 'time_column', %1$L, 'backfill_until', $2),
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

    EXECUTE v_sql USING p_since, p_until INTO v_count;
    RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_audit_backfill_recent_table(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;

DO $$
DECLARE
    v_since TIMESTAMPTZ := NOW() - INTERVAL '2 days';
    v_until TIMESTAMPTZ;
    v_total INTEGER := 0;
BEGIN
    SELECT COALESCE(MIN(created_at), NOW())
    INTO v_until
    FROM public.admin_audit_logs;

    v_total := v_total + public.admin_audit_backfill_recent_table('profiles', 'updated_at', v_since, v_until);
    v_total := v_total + public.admin_audit_backfill_recent_table('access_requests', 'updated_at', v_since, v_until);
    v_total := v_total + public.admin_audit_backfill_recent_table('reservations', 'updated_at', v_since, v_until);
    v_total := v_total + public.admin_audit_backfill_recent_table('challenges', 'updated_at', v_since, v_until);
    v_total := v_total + public.admin_audit_backfill_recent_table('matches', 'updated_at', v_since, v_until);
    v_total := v_total + public.admin_audit_backfill_recent_table('championships', 'updated_at', v_since, v_until);
    v_total := v_total + public.admin_audit_backfill_recent_table('point_history', 'updated_at', v_since, v_until);
    v_total := v_total + public.admin_audit_backfill_recent_table('ranking_reset_events', 'created_at', v_since, v_until);
    v_total := v_total + public.admin_audit_backfill_recent_table('consumptions', 'created_at', v_since, v_until);
    v_total := v_total + public.admin_audit_backfill_recent_table('products', 'updated_at', v_since, v_until);

    RAISE NOTICE 'admin_audit_logs 2-day backfill inserted % rows from % until %', v_total, v_since, v_until;
END $$;

DROP FUNCTION IF EXISTS public.admin_audit_backfill_recent_table(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
