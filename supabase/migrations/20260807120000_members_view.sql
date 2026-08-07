-- Migration: members view
-- Goal: dar um único ponto de verdade, no SQL, para "quem é sócio do clube".
--
-- A coluna profiles.role usa o ENUM exclusivo user_role ('admin','socio','lanchonete'),
-- então um perfil promovido a admin deixa de ser 'socio' no banco. Na prática o admin
-- continua sendo sócio: reserva quadra, joga campeonato, pontua no ranking e consome.
--
-- Antes desta view a regra "socio OU admin" estava repetida à mão em ~19 consultas do
-- frontend e em várias funções SQL; alguns lugares esqueceram o admin e passaram a
-- tratá-lo como não-sócio. O equivalente no cliente é MEMBER_ROLES / isMember (utils.ts).

CREATE OR REPLACE VIEW public.members
WITH (security_invoker = true) AS
SELECT *
FROM public.profiles
WHERE role::text IN ('socio', 'admin');

COMMENT ON VIEW public.members IS
    'Perfis vinculados ao clube como sócio, incluindo admins. Espelha MEMBER_ROLES/isMember em utils.ts. security_invoker mantém a RLS de profiles válida para quem consulta.';

GRANT SELECT ON public.members TO anon, authenticated;
