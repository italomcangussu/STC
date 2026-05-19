-- Replace the active Resenha Open bracket with the official published brackets.
-- Registrations are preserved. Matches are rebuilt idempotently.

DO $$
DECLARE
    v_championship_id UUID;
    v_missing_count INTEGER;
BEGIN
    SELECT c.id INTO v_championship_id
    FROM public.championships c
    JOIN public.championship_series s ON s.id = c.series_id
    WHERE s.slug = 'resenha-open'
      AND c.status = 'active'
    ORDER BY c.created_at DESC
    LIMIT 1;

    IF v_championship_id IS NULL THEN
        RAISE EXCEPTION 'Active Resenha Open championship not found';
    END IF;

    CREATE TEMP TABLE tmp_resenha_regs (
        key TEXT PRIMARY KEY,
        registration_id UUID NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_resenha_regs (key, registration_id)
    VALUES
        ('4:thieslley', '5dd50939-2c6f-4423-8ed6-a9b89ce43568'),
        ('4:josiel', '4c2a53ba-f180-4165-9f82-e047c761407f'),
        ('4:rafael', '9252ecb3-fc50-473f-8d1e-7a5b42d54dd4'),
        ('4:hermeson', '7d2b160e-cf44-4aa7-b8b8-90278fe924e9'),
        ('4:henrique', '3e81cfc4-ff1a-4a49-b719-eb41be857df8'),
        ('4:diego_memoria', 'cb505138-d70f-470c-9da6-df3a5dba345d'),
        ('4:marcelo', '859dfa10-854a-4a7a-b172-ad7a82e29207'),
        ('4:tiago', '781d5443-4da7-4afe-ae11-51f5d6f94b6f'),
        ('4:mario', '8e3a8fd0-5bee-4747-92cb-508eed9d2123'),
        ('4:gustavo', 'b6701f31-cd28-45ad-a687-023b32761b4c'),
        ('4:bruno', '19e21d7a-013d-4e73-b8e8-ac9f62f74844'),
        ('4:ednaldo', 'c9cfbe82-d393-4b59-8415-cc7f09451a8d'),
        ('4:miguel', '2688052f-ba35-443a-aba4-23bed12fdb83'),
        ('4:joaquim', '36dccf11-f1fb-4243-bbae-64725c70a2e6'),
        ('4:francielton', '29ebdc95-8ac2-48ed-9636-5258ecb1081a'),
        ('4:frederico', '0472fd16-61c9-4b9c-88c8-7d39916ff7a8'),
        ('4:hernades', 'e42db195-2ea2-438b-b480-f1a971c0be04'),
        ('4:claudio', '5c6d7efd-f94d-4f3f-ae04-038e88fc177a'),
        ('4:isamael', '96b27647-e470-48f1-adba-bc005b544bdf'),
        ('4:derlan', '73d1bbb8-f635-47a1-afc6-b734787fad42'),
        ('5:diego_parente', '7b1ab658-2644-4df8-a1bf-cb45f256d7f5'),
        ('5:marcelino', '48fc262c-4587-43fb-adf2-03b3da8caa0f'),
        ('5:mailson', '0e706b72-30da-4417-9532-1a84568d9000'),
        ('5:vinicius', '836b5b51-e4e3-424e-8288-88e870a002a3'),
        ('5:davi', 'e688d322-02a1-47a9-b14b-22474f4135b9'),
        ('5:lucas', '86457ad3-015f-4b24-98a6-99cbba6337b5'),
        ('5:italo', 'c7f8851d-b1f0-44a1-8323-022444da1709'),
        ('5:derlan', '393e4eba-3750-4d47-bf56-10a64acb1d0d'),
        ('5:macel', 'dc3a94ea-4ca6-46ad-82a5-1cf3e0f81059'),
        ('5:williams', '5d8a7ba1-ec1d-495d-ae98-0864b942ee67'),
        ('5:victor', '82feed48-dc15-482b-8f3d-1dd8f5f04480'),
        ('5:thiago', '95ca3cce-1473-42ae-ba89-dc132bb239d5'),
        ('5:romario', '6c54b1e1-936f-4796-980e-e15e00f2ad75'),
        ('5:helder', '1cd6a493-92f5-41e2-9320-5b8edffee579'),
        ('5:ricardo', '9b5a50f0-7e7b-431e-822d-f2908d426abe'),
        ('5:mardes', '47709706-9e66-4de0-ad04-b8c124f5f5fd');

    SELECT COUNT(*) INTO v_missing_count
    FROM tmp_resenha_regs tr
    LEFT JOIN public.championship_registrations cr
      ON cr.id = tr.registration_id
     AND cr.championship_id = v_championship_id
    WHERE cr.id IS NULL;

    IF v_missing_count > 0 THEN
        RAISE EXCEPTION 'Official bracket replacement aborted: % required registrations are missing from active Resenha Open', v_missing_count;
    END IF;

    DELETE FROM public.matches
    WHERE championship_id = v_championship_id;

    DELETE FROM public.championship_rounds
    WHERE championship_id = v_championship_id;

    CREATE TEMP TABLE tmp_resenha_rounds (
        phase TEXT PRIMARY KEY,
        round_id UUID NOT NULL
    ) ON COMMIT DROP;

    WITH inserted_rounds AS (
        INSERT INTO public.championship_rounds (
            championship_id, round_number, name, phase, start_date, end_date, status
        )
        VALUES
            (v_championship_id, 1, 'Preliminar', 'preliminar', '2026-05-19', '2026-05-22', 'pending'),
            (v_championship_id, 2, 'Oitavas de Final', 'oitavas', '2026-05-22', '2026-05-23', 'pending'),
            (v_championship_id, 3, 'Quartas de Final', 'quartas', '2026-05-23', '2026-05-24', 'pending'),
            (v_championship_id, 4, 'Semifinais', 'semifinal', '2026-05-23', '2026-05-24', 'pending'),
            (v_championship_id, 5, 'Final', 'final', '2026-05-23', '2026-05-24', 'pending')
        RETURNING phase, id
    )
    INSERT INTO tmp_resenha_rounds (phase, round_id)
    SELECT phase, id
    FROM inserted_rounds;

    CREATE TEMP TABLE tmp_resenha_match_defs (
        class_key TEXT NOT NULL,
        match_number INTEGER NOT NULL,
        round_phase TEXT NOT NULL,
        registration_a_key TEXT,
        registration_b_key TEXT,
        source_a_match_number INTEGER,
        source_b_match_number INTEGER,
        scheduled_time TIME,
        PRIMARY KEY (class_key, match_number)
    ) ON COMMIT DROP;

    INSERT INTO tmp_resenha_match_defs (
        class_key, match_number, round_phase, registration_a_key, registration_b_key,
        source_a_match_number, source_b_match_number, scheduled_time
    )
    VALUES
        ('5ª Classe', 1, 'oitavas', '5:davi', '5:williams', NULL, NULL, '17:00'),
        ('5ª Classe', 2, 'oitavas', '5:lucas', '5:macel', NULL, NULL, '18:00'),
        ('5ª Classe', 3, 'oitavas', '5:mailson', '5:diego_parente', NULL, NULL, '19:00'),
        ('5ª Classe', 4, 'oitavas', '5:thiago', '5:derlan', NULL, NULL, '20:00'),
        ('5ª Classe', 5, 'oitavas', '5:marcelino', '5:victor', NULL, NULL, '21:00'),
        ('5ª Classe', 6, 'oitavas', '5:mardes', '5:vinicius', NULL, NULL, '22:00'),
        ('5ª Classe', 7, 'oitavas', '5:ricardo', '5:romario', NULL, NULL, '23:00'),
        ('5ª Classe', 8, 'oitavas', '5:helder', '5:italo', NULL, NULL, '00:00'),
        ('5ª Classe', 9, 'quartas', NULL, NULL, 1, 2, '17:00'),
        ('5ª Classe', 10, 'quartas', NULL, NULL, 3, 4, '18:00'),
        ('5ª Classe', 11, 'quartas', NULL, NULL, 5, 6, '19:00'),
        ('5ª Classe', 12, 'quartas', NULL, NULL, 7, 8, '20:00'),
        ('5ª Classe', 13, 'semifinal', NULL, NULL, 9, 10, '17:00'),
        ('5ª Classe', 14, 'semifinal', NULL, NULL, 11, 12, '18:00'),
        ('5ª Classe', 15, 'final', NULL, NULL, 13, 14, '20:00'),
        ('4ª Classe', 1, 'preliminar', '4:hernades', '4:claudio', NULL, NULL, '17:00'),
        ('4ª Classe', 2, 'preliminar', '4:derlan', '4:joaquim', NULL, NULL, '18:00'),
        ('4ª Classe', 3, 'preliminar', '4:isamael', '4:frederico', NULL, NULL, '19:00'),
        ('4ª Classe', 4, 'preliminar', '4:hermeson', '4:francielton', NULL, NULL, '20:00'),
        ('4ª Classe', 5, 'oitavas', '4:thieslley', NULL, NULL, 1, '17:00'),
        ('4ª Classe', 6, 'oitavas', '4:miguel', '4:henrique', NULL, NULL, '18:00'),
        ('4ª Classe', 7, 'oitavas', '4:bruno', '4:diego_memoria', NULL, NULL, '21:00'),
        ('4ª Classe', 8, 'oitavas', '4:gustavo', NULL, NULL, 2, '19:00'),
        ('4ª Classe', 9, 'oitavas', '4:rafael', NULL, NULL, 3, '20:00'),
        ('4ª Classe', 10, 'oitavas', '4:ednaldo', '4:mario', NULL, NULL, '22:00'),
        ('4ª Classe', 11, 'oitavas', '4:tiago', '4:marcelo', NULL, NULL, NULL),
        ('4ª Classe', 12, 'oitavas', '4:josiel', NULL, NULL, 4, '21:00'),
        ('4ª Classe', 13, 'quartas', NULL, NULL, 5, 6, '17:00'),
        ('4ª Classe', 14, 'quartas', NULL, NULL, 7, 8, '18:00'),
        ('4ª Classe', 15, 'quartas', NULL, NULL, 9, 10, '19:00'),
        ('4ª Classe', 16, 'quartas', NULL, NULL, 11, 12, '20:00'),
        ('4ª Classe', 17, 'semifinal', NULL, NULL, 13, 14, '17:00'),
        ('4ª Classe', 18, 'semifinal', NULL, NULL, 15, 16, '18:00'),
        ('4ª Classe', 19, 'final', NULL, NULL, 17, 18, '20:00');

    INSERT INTO public.matches (
        championship_id,
        round_id,
        phase,
        type,
        status,
        match_number,
        registration_a_id,
        registration_b_id,
        player_a_id,
        player_b_id,
        scheduled_time
    )
    SELECT
        v_championship_id,
        rr.round_id,
        d.class_key,
        'Campeonato',
        'pending',
        d.match_number,
        reg_a.id,
        reg_b.id,
        reg_a.user_id,
        reg_b.user_id,
        d.scheduled_time
    FROM tmp_resenha_match_defs d
    JOIN tmp_resenha_rounds rr ON rr.phase = d.round_phase
    LEFT JOIN tmp_resenha_regs tra ON tra.key = d.registration_a_key
    LEFT JOIN public.championship_registrations reg_a ON reg_a.id = tra.registration_id
    LEFT JOIN tmp_resenha_regs trb ON trb.key = d.registration_b_key
    LEFT JOIN public.championship_registrations reg_b ON reg_b.id = trb.registration_id;

    CREATE TEMP TABLE tmp_resenha_inserted_matches AS
    SELECT m.id, m.phase AS class_key, m.match_number
    FROM public.matches m
    WHERE m.championship_id = v_championship_id
      AND m.phase IN ('4ª Classe', '5ª Classe');

    UPDATE public.matches m
    SET player_a_source_match_id = source_m.id
    FROM tmp_resenha_match_defs d
    JOIN tmp_resenha_inserted_matches inserted_m
      ON inserted_m.class_key = d.class_key
     AND inserted_m.match_number = d.match_number
    JOIN tmp_resenha_inserted_matches source_m
      ON source_m.class_key = d.class_key
     AND source_m.match_number = d.source_a_match_number
    WHERE m.id = inserted_m.id
      AND d.source_a_match_number IS NOT NULL;

    UPDATE public.matches m
    SET player_b_source_match_id = source_m.id
    FROM tmp_resenha_match_defs d
    JOIN tmp_resenha_inserted_matches inserted_m
      ON inserted_m.class_key = d.class_key
     AND inserted_m.match_number = d.match_number
    JOIN tmp_resenha_inserted_matches source_m
      ON source_m.class_key = d.class_key
     AND source_m.match_number = d.source_b_match_number
    WHERE m.id = inserted_m.id
      AND d.source_b_match_number IS NOT NULL;
END $$;
