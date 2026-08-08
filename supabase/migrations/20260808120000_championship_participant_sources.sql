-- Origens de participante aceitas no campeonato (Criador → "Quem pode se inscrever").
--
-- Antes desta migration os dois toggles viviam só no estado do React: fechar o
-- Criador e voltar mostrava "Aceitar convidados" desligado num campeonato que
-- já tinha convidados inscritos — a tela negando o que os próprios dados
-- afirmavam — e sem a aba "Convidado" o admin não conseguia inscrever o
-- próximo.
--
-- O default é `false` porque sócio é a origem padrão de todo campeonato do
-- clube; convidado e aluno são a exceção, e exceção se liga de propósito.

ALTER TABLE public.championships
    ADD COLUMN IF NOT EXISTS allow_guests BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS allow_students BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.championships.allow_guests IS
    'Se o Criador oferece a aba "Convidado" ao inscrever. Não restringe o que já foi inscrito.';

COMMENT ON COLUMN public.championships.allow_students IS
    'Se o Criador oferece a aba "Aluno" ao inscrever. Não restringe o que já foi inscrito.';

-- Backfill pela evidência: quem já tem convidado inscrito aceitou convidado.
-- É a mesma regra que o cliente aplicava em memória, agora gravada uma vez.
UPDATE public.championships c
SET
    allow_guests = EXISTS (
        SELECT 1 FROM public.championship_registrations r
        WHERE r.championship_id = c.id AND r.participant_type = 'guest'
    ),
    allow_students = EXISTS (
        SELECT 1 FROM public.championship_registrations r
        WHERE r.championship_id = c.id AND r.participant_type = 'aluno'
    )
WHERE EXISTS (
    SELECT 1 FROM public.championship_registrations r
    WHERE r.championship_id = c.id AND r.participant_type IN ('guest', 'aluno')
);
