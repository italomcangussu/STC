-- Criador de Campeonatos — schema (M1–M4 da spec 2026-08-07)

-- M1: rodadas por classe. Sem backfill: rodadas antigas ficam com class NULL
-- e seguem válidas porque Postgres trata NULL como distinto em índice único.
ALTER TABLE public.championship_rounds
    ADD COLUMN IF NOT EXISTS class TEXT;

ALTER TABLE public.championship_rounds
    DROP CONSTRAINT IF EXISTS championship_rounds_championship_id_round_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_championship_rounds_champ_class_number
    ON public.championship_rounds (championship_id, class, round_number);

COMMENT ON COLUMN public.championship_rounds.class IS
    'Classe a que esta rodada pertence. NULL = campeonato do modelo antigo (pré-Criador), cujas classes compartilham rodadas.';

-- M2: alunos como participantes.
ALTER TABLE public.championship_registrations
    ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.non_socio_students(id);

ALTER TABLE public.championship_registrations
    DROP CONSTRAINT IF EXISTS championship_registrations_participant_type_check;

ALTER TABLE public.championship_registrations
    ADD CONSTRAINT championship_registrations_participant_type_check
    CHECK (participant_type = ANY (ARRAY['socio'::text, 'guest'::text, 'aluno'::text]));

ALTER TABLE public.championship_registrations
    DROP CONSTRAINT IF EXISTS valid_participant;

ALTER TABLE public.championship_registrations
    ADD CONSTRAINT valid_participant CHECK (
        (participant_type = 'socio' AND user_id IS NOT NULL)
     OR (participant_type = 'guest' AND guest_name IS NOT NULL)
     OR (participant_type = 'aluno' AND student_id IS NOT NULL)
    );

-- M3: vocabulário de fases. Nenhum ponto semeado: fase sem linha em
-- championship_phase_points vale 5 via apply_championship_edition_points.
ALTER TABLE public.championship_registrations
    DROP CONSTRAINT IF EXISTS championship_registrations_final_phase_check;

ALTER TABLE public.championship_registrations
    ADD CONSTRAINT championship_registrations_final_phase_check
    CHECK (final_phase = ANY (ARRAY[
        'champion'::text, 'finalist'::text, 'semifinal'::text,
        'quarterfinal'::text, 'round_of_16'::text, 'round_of_32'::text,
        'qualifying'::text, 'participation'::text
    ]));

-- M4: configuração do formato.
ALTER TABLE public.championships
    ADD COLUMN IF NOT EXISTS format_config JSONB;

COMMENT ON COLUMN public.championships.format_config IS
    'Configuração do formato escolhida no Criador. Formato do objeto em lib/championship/formatConfig.ts.';
