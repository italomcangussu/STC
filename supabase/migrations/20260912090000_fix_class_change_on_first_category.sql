-- Corrige o falso "Faltou preencher um campo obrigatório" ao salvar o perfil.
--
-- `class_rank()` devolve 999 para qualquer texto sem dígito — inclusive NULL.
-- Por isso, definir a classe pela primeira vez (NULL → '6ª Classe') era lido
-- pelo gatilho como PROMOÇÃO (999 → 6). Ele então inseria em
-- `class_change_events` com `from_class = OLD.category = NULL`, e essa coluna
-- é NOT NULL: o Postgres devolvia 23502, que a UI traduz como
-- "Faltou preencher um campo obrigatório." — um erro falso, porque o
-- formulário estava todo preenchido. Quem tem `category` NULL só precisava
-- abrir "Editar Perfil" para trocar a foto e salvar para bater nisso.
--
-- Sem classe de origem não existe promoção nem pontos a dividir pela metade.
-- O mesmo vale para o caminho inverso (limpar a classe), que produziria
-- `to_class` NULL.

CREATE OR REPLACE FUNCTION public.on_profile_class_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_old_rank  INTEGER;
    v_new_rank  INTEGER;
    v_pts_now   INTEGER;
    v_halved    INTEGER;
BEGIN
    -- Only act on category changes
    IF NEW.category IS NOT DISTINCT FROM OLD.category THEN
        RETURN NEW;
    END IF;

    -- Primeira definição da classe (ou remoção dela) não é promoção: não há
    -- classe de origem para comparar, nem pontos acumulados nela para dividir.
    IF OLD.category IS NULL OR btrim(OLD.category) = ''
       OR NEW.category IS NULL OR btrim(NEW.category) = '' THEN
        RETURN NEW;
    END IF;

    v_old_rank := public.class_rank(OLD.category);
    v_new_rank := public.class_rank(NEW.category);

    -- Promotion = moving to a better (lower rank number) class
    IF v_new_rank >= v_old_rank THEN
        RETURN NEW; -- demotion or same — no adjustment
    END IF;

    -- Idempotency: avoid double-adjustment for the same class transition
    IF EXISTS (
        SELECT 1 FROM public.class_change_events
        WHERE  user_id    = NEW.id
          AND  from_class = OLD.category
          AND  to_class   = NEW.category
          AND  changed_at > NOW() - INTERVAL '5 seconds'
    ) THEN
        RETURN NEW;
    END IF;

    v_pts_now := COALESCE(NEW.legacy_points, 0);
    v_halved  := FLOOR(v_pts_now::NUMERIC / 2)::INTEGER;

    -- Insert audit entry
    INSERT INTO public.class_change_events (
        user_id, from_class, to_class, points_before, points_after, changed_by
    ) VALUES (
        NEW.id, OLD.category, NEW.category, v_pts_now, v_halved, auth.uid()
    );

    -- Insert adjustment in point_history
    INSERT INTO public.point_history (
        user_id, amount, event_type,
        description, earned_date, expires_at, reason, status
    ) VALUES (
        NEW.id,
        -(v_pts_now - v_halved),
        'Campeonato',
        'Promoção de classe: ' || OLD.category || ' → ' || NEW.category || ' (÷2)',
        NOW()::DATE,
        NOW()::DATE,
        'class_promotion_adjustment',
        'active'
    );

    -- Apply halving to the profile
    NEW.legacy_points := v_halved;

    RETURN NEW;
END;
$$;
