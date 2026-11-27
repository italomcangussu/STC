-- Serra e Sertão 2026, 5ª Classe: Ealber Luna (sócio) desistiu e o convidado Mardes entra na vaga dele.
--
-- - Mardes ganha inscrição de convidado e toma a vaga A do J5 (contra Ismael Pedrosa Machado).
-- - Não herda a condição de cabeça de chave: entra só na vaga.
-- - A inscrição do Ealber sai do campeonato; o signup dele fica como 'canceled', com o pagamento
--   (R$ 130, fin_entry) intacto: devolver ou não é decisão da organização, fora desta migration.
-- Guardado por existência: no banco de teste (sem dados) não faz nada.

DO $$
DECLARE
    c_camp     CONSTANT uuid := '8d8e7ec9-bb0a-4290-90f0-716bc0802b07';
    c_ealber   CONSTANT uuid := 'da261c7b-d92b-4534-b09e-6af5718bdc00';
    c_j5       CONSTANT uuid := 'a1fd95b3-c3ef-493e-8303-de2af1432bb6';
    v_admin    uuid;
    v_mardes   uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.championship_registrations WHERE id = c_ealber) THEN
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM public.matches WHERE id = c_j5 AND status <> 'pending') THEN
        RAISE EXCEPTION 'O J5 da 5ª Classe já tem resultado; a troca precisa ser revista.';
    END IF;

    SELECT registered_by INTO v_admin FROM public.championship_registrations WHERE id = c_ealber;

    INSERT INTO public.championship_registrations
        (championship_id, participant_type, guest_name, class, registered_by, cabeca_de_chave)
    VALUES (c_camp, 'guest', 'Mardes', '5ª Classe', v_admin, false)
    RETURNING id INTO v_mardes;

    UPDATE public.matches
    SET registration_a_id = v_mardes, player_a_id = NULL
    WHERE id = c_j5 AND registration_a_id = c_ealber;

    UPDATE public.matches
    SET registration_b_id = v_mardes, player_b_id = NULL
    WHERE id = c_j5 AND registration_b_id = c_ealber;

    UPDATE public.championship_signups
    SET status = 'canceled', registration_id = NULL
    WHERE registration_id = c_ealber;

    DELETE FROM public.championship_registrations WHERE id = c_ealber;
END $$;
