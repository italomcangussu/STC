DO $$
DECLARE
    v_updated_count INTEGER := 0;
BEGIN
    UPDATE public.profiles
    SET
        category = '4ª Classe',
        updated_at = NOW()
    WHERE name ILIKE '%Hermeson%'
      AND category = '5ª Classe'
      AND role::text IN ('socio', 'admin');

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
        RAISE EXCEPTION 'Nenhum perfil de Hermeson em 5ª Classe foi encontrado.';
    END IF;

    IF v_updated_count > 1 THEN
        RAISE EXCEPTION 'Mais de um perfil de Hermeson em 5ª Classe encontrado (%). Operação abortada para segurança.', v_updated_count;
    END IF;

    RAISE NOTICE 'Perfil atualizado com sucesso: Hermeson 5ª Classe -> 4ª Classe.';
END;
$$;
