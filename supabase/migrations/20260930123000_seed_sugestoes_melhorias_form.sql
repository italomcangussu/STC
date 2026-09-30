-- Migration: seed_sugestoes_melhorias_form
-- Description: Cria o primeiro formulário oficial de sugestões de melhorias para o clube solicitado pela presidência.

DO $$
DECLARE
    v_form_id UUID;
BEGIN
    -- 1. Inserir ou atualizar o formulário principal
    INSERT INTO public.club_forms (
        title,
        description,
        slug,
        is_active,
        is_secret_vote,
        requires_auth,
        allow_multiple_submissions,
        show_live_results
    ) VALUES (
        'Sugestões de Melhorias para o Clube',
        'Prezado sócio, sua opinião é fundamental para a diretoria. Deixe suas sugestões de melhorias nos aspectos abaixo para construirmos juntos um clube cada vez melhor!',
        'sugestoes-melhorias',
        true,
        false, -- Identificado para a diretoria saber quem sugeriu e dar retorno
        true,  -- Apenas sócios ativos
        true,  -- Permite que o sócio envie novas sugestões sempre que desejar
        false  -- Respostas qualitativas de uso interno da diretoria
    )
    ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        is_active = EXCLUDED.is_active,
        is_secret_vote = EXCLUDED.is_secret_vote,
        requires_auth = EXCLUDED.requires_auth,
        allow_multiple_submissions = EXCLUDED.allow_multiple_submissions,
        show_live_results = EXCLUDED.show_live_results,
        updated_at = NOW()
    RETURNING id INTO v_form_id;

    -- 2. Limpar perguntas antigas caso já existam para recriar de forma limpa
    DELETE FROM public.club_form_questions WHERE form_id = v_form_id;

    -- 3. Inserir as perguntas com texto aberto conforme pedido do presidente:
    -- A. Infraestrutura
    INSERT INTO public.club_form_questions (
        form_id,
        title,
        description,
        question_type,
        is_required,
        display_order
    ) VALUES (
        v_form_id,
        'A. Infraestrutura & Estrutura Física',
        'Vestiários, banheiros, sede social, estacionamento, iluminação geral, limpeza e manutenção.',
        'open_text',
        false,
        1
    );

    -- B. Quadras
    INSERT INTO public.club_form_questions (
        form_id,
        title,
        description,
        question_type,
        is_required,
        display_order
    ) VALUES (
        v_form_id,
        'B. Quadras de Tênis & Prática Esportiva',
        'Pisos (saibro e rápida), redes, iluminação das quadras, agendamento de horários e regras de uso.',
        'open_text',
        false,
        2
    );

    -- C. Lazer
    INSERT INTO public.club_form_questions (
        form_id,
        title,
        description,
        question_type,
        is_required,
        display_order
    ) VALUES (
        v_form_id,
        'C. Lazer, Convivência & Eventos',
        'Espaço de convivência, bar/lanchonete Klanches, churrasqueira, torneios sociais e integração entre famílias.',
        'open_text',
        false,
        3
    );

    -- D. Espaço livre
    INSERT INTO public.club_form_questions (
        form_id,
        title,
        description,
        question_type,
        is_required,
        display_order
    ) VALUES (
        v_form_id,
        'D. Outras Sugestões, Ideias ou Elogios',
        'Espaço livre para você compartilhar qualquer outra ideia, oportunidade de melhoria ou consideração para a diretoria.',
        'open_text',
        false,
        4
    );

END $$;
