-- Migration: create_club_forms_and_voting
-- Description: Tabelas e RPCs para Formulários do Clube e Urna de Votação com Placar ao Vivo

-- 1. Tabela Principal de Formulários
CREATE TABLE IF NOT EXISTS public.club_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NULL,
    slug TEXT UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_secret_vote BOOLEAN NOT NULL DEFAULT false,
    requires_auth BOOLEAN NOT NULL DEFAULT true,
    allow_multiple_submissions BOOLEAN NOT NULL DEFAULT false,
    show_live_results BOOLEAN NOT NULL DEFAULT true,
    starts_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NULL,
    created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabela de Perguntas
CREATE TABLE IF NOT EXISTS public.club_form_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES public.club_forms(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NULL,
    question_type TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'open_text')),
    is_required BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabela de Alternativas / Opções de Resposta
CREATE TABLE IF NOT EXISTS public.club_form_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES public.club_form_questions(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabela de Recibos de Participação (Urna Cega: impede voto duplo sem registrar em quem votou)
CREATE TABLE IF NOT EXISTS public.club_form_voter_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES public.club_forms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT club_form_voter_receipts_user_unique UNIQUE (form_id, user_id)
);

-- 5. Tabela de Respostas e Votos Computados
CREATE TABLE IF NOT EXISTS public.club_form_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES public.club_forms(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.club_form_questions(id) ON DELETE CASCADE,
    option_id UUID NULL REFERENCES public.club_form_options(id) ON DELETE CASCADE,
    text_response TEXT NULL,
    user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    submission_batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de Performance
CREATE INDEX IF NOT EXISTS idx_club_forms_slug ON public.club_forms(slug);
CREATE INDEX IF NOT EXISTS idx_club_forms_active ON public.club_forms(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_club_form_questions_form_order ON public.club_form_questions(form_id, display_order ASC);
CREATE INDEX IF NOT EXISTS idx_club_form_options_question_order ON public.club_form_options(question_id, display_order ASC);
CREATE INDEX IF NOT EXISTS idx_club_form_voter_receipts_lookup ON public.club_form_voter_receipts(form_id, user_id);
CREATE INDEX IF NOT EXISTS idx_club_form_responses_lookup ON public.club_form_responses(form_id, question_id, option_id);
CREATE INDEX IF NOT EXISTS idx_club_form_responses_batch ON public.club_form_responses(submission_batch_id);

-- Habilitar RLS
ALTER TABLE public.club_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_form_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_form_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_form_voter_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_form_responses ENABLE ROW LEVEL SECURITY;

-- Políticas: club_forms
DROP POLICY IF EXISTS "Public can view active forms or admins view all" ON public.club_forms;
CREATE POLICY "Public can view active forms or admins view all"
ON public.club_forms FOR SELECT
USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage forms" ON public.club_forms;
CREATE POLICY "Admins can manage forms"
ON public.club_forms FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Políticas: club_form_questions
DROP POLICY IF EXISTS "Questions viewable if form is accessible" ON public.club_form_questions;
CREATE POLICY "Questions viewable if form is accessible"
ON public.club_form_questions FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.club_forms f
        WHERE f.id = club_form_questions.form_id
          AND (f.is_active = true OR public.is_admin())
    )
);

DROP POLICY IF EXISTS "Admins can manage questions" ON public.club_form_questions;
CREATE POLICY "Admins can manage questions"
ON public.club_form_questions FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Políticas: club_form_options
DROP POLICY IF EXISTS "Options viewable if question is accessible" ON public.club_form_options;
CREATE POLICY "Options viewable if question is accessible"
ON public.club_form_options FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.club_form_questions q
        JOIN public.club_forms f ON f.id = q.form_id
        WHERE q.id = club_form_options.question_id
          AND (f.is_active = true OR public.is_admin())
    )
);

DROP POLICY IF EXISTS "Admins can manage options" ON public.club_form_options;
CREATE POLICY "Admins can manage options"
ON public.club_form_options FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Políticas: club_form_voter_receipts
DROP POLICY IF EXISTS "Users can view own receipts or admins view all" ON public.club_form_voter_receipts;
CREATE POLICY "Users can view own receipts or admins view all"
ON public.club_form_voter_receipts FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users can insert own receipt" ON public.club_form_voter_receipts;
CREATE POLICY "Users can insert own receipt"
ON public.club_form_voter_receipts FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- Políticas: club_form_responses
DROP POLICY IF EXISTS "Responses select policy" ON public.club_form_responses;
CREATE POLICY "Responses select policy"
ON public.club_form_responses FOR SELECT
USING (
    public.is_admin()
    OR EXISTS (
        SELECT 1 FROM public.club_forms f
        WHERE f.id = club_form_responses.form_id
          AND f.show_live_results = true
    )
);

DROP POLICY IF EXISTS "Responses insert policy" ON public.club_form_responses;
CREATE POLICY "Responses insert policy"
ON public.club_form_responses FOR INSERT
TO authenticated
WITH CHECK (
    user_id IS NULL OR user_id = auth.uid() OR public.is_admin()
);

DROP POLICY IF EXISTS "Admins can delete responses" ON public.club_form_responses;
CREATE POLICY "Admins can delete responses"
ON public.club_form_responses FOR DELETE
TO authenticated
USING (public.is_admin());

-- RPC: Obter Resultados Agregados ao Vivo (Seguro e Performático)
CREATE OR REPLACE FUNCTION public.get_form_live_results(p_form_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_form RECORD;
    v_result JSONB;
BEGIN
    SELECT id, title, is_secret_vote, show_live_results, is_active
    INTO v_form
    FROM public.club_forms
    WHERE id = p_form_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Formulário não encontrado.';
    END IF;

    -- Se não for admin e o formulário não permitir resultados ao vivo, bloqueia
    IF NOT v_form.show_live_results AND NOT public.is_admin() THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'message', 'Os resultados desta votação não estão disponíveis publicamente.'
        );
    END IF;

    SELECT jsonb_build_object(
        'allowed', true,
        'form_id', v_form.id,
        'total_participants', (
            SELECT COUNT(DISTINCT r.id)
            FROM public.club_form_voter_receipts r
            WHERE r.form_id = p_form_id
        ),
        'questions', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'question_id', q.id,
                    'title', q.title,
                    'question_type', q.question_type,
                    'total_votes', (
                        SELECT COUNT(*)
                        FROM public.club_form_responses res
                        WHERE res.question_id = q.id
                    ),
                    'options', (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'option_id', o.id,
                                'label', o.label,
                                'display_order', o.display_order,
                                'votes', (
                                    SELECT COUNT(*)
                                    FROM public.club_form_responses res
                                    WHERE res.question_id = q.id
                                      AND res.option_id = o.id
                                )
                            ) ORDER BY o.display_order ASC
                        )
                        FROM public.club_form_options o
                        WHERE o.question_id = q.id
                    ),
                    'open_responses_count', (
                        SELECT COUNT(*)
                        FROM public.club_form_responses res
                        WHERE res.question_id = q.id
                          AND res.text_response IS NOT NULL
                          AND trim(res.text_response) <> ''
                    )
                ) ORDER BY q.display_order ASC
            )
            FROM public.club_form_questions q
            WHERE q.form_id = p_form_id
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- RPC: Submissão Atômica com Validação de Urna Cega
CREATE OR REPLACE FUNCTION public.submit_club_form(
    p_form_id UUID,
    p_answers JSONB -- Array of { question_id: UUID, option_id?: UUID, option_ids?: UUID[], text_response?: string }
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_form RECORD;
    v_answer JSONB;
    v_opt_id_text TEXT;
    v_batch_id UUID := gen_random_uuid();
    v_user_to_store UUID := NULL;
    v_has_voted BOOLEAN := false;
BEGIN
    -- 1. Validar existência e estado do formulário
    SELECT id, is_active, is_secret_vote, requires_auth, allow_multiple_submissions, starts_at, expires_at
    INTO v_form
    FROM public.club_forms
    WHERE id = p_form_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Formulário não encontrado.';
    END IF;

    IF NOT v_form.is_active THEN
        RAISE EXCEPTION 'Este formulário ou votação está encerrado.';
    END IF;

    IF v_form.starts_at IS NOT NULL AND NOW() < v_form.starts_at THEN
        RAISE EXCEPTION 'Esta votação ainda não foi iniciada.';
    END IF;

    IF v_form.expires_at IS NOT NULL AND NOW() > v_form.expires_at THEN
        RAISE EXCEPTION 'O prazo desta votação já expirou.';
    END IF;

    -- 2. Validar autenticação se requerida
    IF v_form.requires_auth AND v_user_id IS NULL THEN
        RAISE EXCEPTION 'É necessário estar autenticado como sócio para responder.';
    END IF;

    -- 3. Checar se já votou quando múltiplas submissões não são permitidas
    IF v_user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.club_form_voter_receipts
            WHERE form_id = p_form_id AND user_id = v_user_id
        ) INTO v_has_voted;

        IF v_has_voted AND NOT v_form.allow_multiple_submissions THEN
            RAISE EXCEPTION 'Você já enviou sua resposta para este formulário.';
        END IF;

        -- Registrar recibo de votação (Garante bloqueio de re-voto)
        INSERT INTO public.club_form_voter_receipts (form_id, user_id, created_at)
        VALUES (p_form_id, v_user_id, NOW())
        ON CONFLICT (form_id, user_id) DO NOTHING;
    END IF;

    -- 4. Definir se o usuário será vinculado às respostas (Urna Cega: NULL se secreta)
    IF NOT v_form.is_secret_vote THEN
        v_user_to_store := v_user_id;
    ELSE
        v_user_to_store := NULL;
    END IF;

    -- 5. Inserir respostas iterando sobre o JSON
    FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
    LOOP
        -- Se vier opção única
        IF v_answer ? 'option_id' AND (v_answer->>'option_id') IS NOT NULL AND (v_answer->>'option_id') <> '' THEN
            INSERT INTO public.club_form_responses (
                form_id,
                question_id,
                option_id,
                text_response,
                user_id,
                submission_batch_id,
                created_at
            ) VALUES (
                p_form_id,
                (v_answer->>'question_id')::UUID,
                (v_answer->>'option_id')::UUID,
                NULL,
                v_user_to_store,
                v_batch_id,
                NOW()
            );
        END IF;

        -- Se vier múltiplas opções (checkbox)
        IF v_answer ? 'option_ids' AND jsonb_typeof(v_answer->'option_ids') = 'array' THEN
            FOR v_opt_id_text IN SELECT jsonb_array_elements_text(v_answer->'option_ids')
            LOOP
                IF v_opt_id_text IS NOT NULL AND v_opt_id_text <> '' THEN
                    INSERT INTO public.club_form_responses (
                        form_id,
                        question_id,
                        option_id,
                        text_response,
                        user_id,
                        submission_batch_id,
                        created_at
                    ) VALUES (
                        p_form_id,
                        (v_answer->>'question_id')::UUID,
                        v_opt_id_text::UUID,
                        NULL,
                        v_user_to_store,
                        v_batch_id,
                        NOW()
                    );
                END IF;
            END LOOP;
        END IF;

        -- Se vier resposta de texto
        IF v_answer ? 'text_response' AND (v_answer->>'text_response') IS NOT NULL AND trim(v_answer->>'text_response') <> '' THEN
            INSERT INTO public.club_form_responses (
                form_id,
                question_id,
                option_id,
                text_response,
                user_id,
                submission_batch_id,
                created_at
            ) VALUES (
                p_form_id,
                (v_answer->>'question_id')::UUID,
                NULL,
                trim(v_answer->>'text_response'),
                v_user_to_store,
                v_batch_id,
                NOW()
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'batch_id', v_batch_id,
        'message', 'Resposta registrada com sucesso!'
    );
END;
$$;

-- Garantir permissões de execução
GRANT EXECUTE ON FUNCTION public.get_form_live_results(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_club_form(UUID, JSONB) TO anon, authenticated;

-- Publicar no Supabase Realtime
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_rel pr
        JOIN pg_publication p ON p.oid = pr.prpubid
        JOIN pg_class c ON c.oid = pr.prrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE p.pubname = 'supabase_realtime'
          AND n.nspname = 'public'
          AND c.relname = 'club_form_responses'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.club_form_responses;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_rel pr
        JOIN pg_publication p ON p.oid = pr.prpubid
        JOIN pg_class c ON c.oid = pr.prrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE p.pubname = 'supabase_realtime'
          AND n.nspname = 'public'
          AND c.relname = 'club_form_voter_receipts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.club_form_voter_receipts;
    END IF;
END
$$;
