-- Migration: create_finish_championship_rpc
-- Goal: Create atomic SECURITY DEFINER RPC to finalize any championship, resolve phases, and credit points safely bypassing client RLS constraints.

CREATE OR REPLACE FUNCTION public.finish_championship(p_championship_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_champ            RECORD;
    v_is_resenha_open  BOOLEAN;
    v_applied_count    INTEGER := 0;
BEGIN
    -- 1. Fetch championship
    SELECT id, name, status, series_id, slug
    INTO v_champ
    FROM public.championships
    WHERE id = p_championship_id;

    IF v_champ.id IS NULL THEN
        RAISE EXCEPTION 'Campeonato % não encontrado.', p_championship_id;
    END IF;

    -- 2. Determine if Resenha Open
    v_is_resenha_open := (v_champ.name ILIKE '%resenha open%' OR COALESCE(v_champ.slug, '') ILIKE '%resenha-open%');

    -- 3. Resolve final phases
    IF v_is_resenha_open THEN
        PERFORM public.resolve_resenha_open_final_phases(p_championship_id);
    ELSE
        PERFORM public.resolve_championship_final_phases(p_championship_id);
    END IF;

    -- 4. Update status to 'finished'
    UPDATE public.championships
    SET status = 'finished'
    WHERE id = p_championship_id;

    -- 5. Apply edition points if linked to a series
    IF v_champ.series_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_applied_count
        FROM public.apply_championship_edition_points(p_championship_id);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'championship_id', p_championship_id,
        'applied_points_count', v_applied_count,
        'message', 'Campeonato finalizado e pontos apurados com sucesso!'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.finish_championship(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_championship(UUID) TO authenticated, anon;

-- Ensure RLS policy for updating championships table as admin
ALTER TABLE public.championships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users on championships" ON public.championships;
CREATE POLICY "Enable read access for all users on championships"
ON public.championships FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable update for authenticated users on championships" ON public.championships;
CREATE POLICY "Enable update for authenticated users on championships"
ON public.championships FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Enable insert for authenticated users on championships" ON public.championships;
CREATE POLICY "Enable insert for authenticated users on championships"
ON public.championships FOR INSERT TO authenticated WITH CHECK (true);
