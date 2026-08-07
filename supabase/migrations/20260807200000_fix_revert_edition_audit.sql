-- revert_championship_edition_points gravava a auditoria em
-- ranking_reset_events (reason, notes), mas a tabela não tem a coluna `notes`
-- e exige `executed_by` (NOT NULL, FK para profiles). O INSERT falhava sempre
-- com "column notes of relation ranking_reset_events does not exist", e como é
-- a última instrução da função, o cancelamento de edição nunca concluía.
--
-- Muda apenas esse INSERT. Toda a lógica de pontos é a original, verbatim.
-- auth.uid() já é usado no início da função para a checagem de admin, então
-- está garantidamente disponível para preencher executed_by.

CREATE OR REPLACE FUNCTION public.revert_championship_edition_points(p_championship_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_series_id     UUID;
    v_edition_year  INTEGER;
    v_prev_champ_id UUID;
    v_reg           RECORD;
    v_cancel_pts    INTEGER;
BEGIN
    -- Only admins
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
    END IF;

    SELECT series_id, edition_year
    INTO   v_series_id, v_edition_year
    FROM   public.championships
    WHERE  id = p_championship_id;

    -- For each user who earned points in this edition, cancel them
    FOR v_reg IN
        SELECT user_id, SUM(amount) AS total_pts
        FROM   public.point_history
        WHERE  event_id = p_championship_id
          AND  reason IN ('championship_earn', 'championship_earn_lower_class')
          AND  status   = 'active'
        GROUP  BY user_id
    LOOP
        v_cancel_pts := v_reg.total_pts;

        INSERT INTO public.point_history (
            user_id, amount, event_type, event_id,
            description, earned_date, expires_at,
            series_id, edition_year, reason, status
        ) VALUES (
            v_reg.user_id,
            -v_cancel_pts,
            'Campeonato',
            p_championship_id,
            'Cancelamento da edição ' || v_edition_year,
            NOW()::DATE,
            NOW()::DATE,
            v_series_id,
            v_edition_year,
            'edition_cancelled',
            'active'
        );

        UPDATE public.point_history
        SET    status = 'revoked'
        WHERE  user_id  = v_reg.user_id
          AND  event_id = p_championship_id
          AND  reason IN ('championship_earn', 'championship_earn_lower_class');

        -- Restore defense_removal entry (if any) — re-activate prior edition points
        UPDATE public.point_history
        SET    status = 'active'
        WHERE  user_id   = v_reg.user_id
          AND  series_id = v_series_id
          AND  reason    IN ('championship_earn', 'championship_earn_lower_class')
          AND  status    = 'revoked'
          AND  edition_year = (
              SELECT MAX(edition_year)
              FROM   public.championships
              WHERE  series_id = v_series_id
                AND  edition_year < v_edition_year
          );

        UPDATE public.profiles
        SET    legacy_points = COALESCE(legacy_points, 0) - v_cancel_pts
        WHERE  id = v_reg.user_id;
    END LOOP;

    -- Auditoria: schema real é (executed_by, reason, reset_scope).
    INSERT INTO public.ranking_reset_events (executed_by, reason, reset_scope)
    VALUES (
        auth.uid(),
        'Cancelamento de edição: championship_id=' || p_championship_id::TEXT,
        'edition_cancellation'
    );
END;
$function$;
