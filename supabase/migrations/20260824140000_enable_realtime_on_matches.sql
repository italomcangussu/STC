-- Migration: publicar `matches` para realtime
--
-- O app já assinava mudanças de partida em pelo menos dois lugares
-- (TournamentBracketView e ResenhaOpenBracketView, via
-- `supabase.channel(...).on('postgres_changes', { table: 'matches' })`),
-- mas a publicação `supabase_realtime` só continha `public.Cliente_CRM`.
-- O servidor nunca enviava esses eventos, então a inscrição era decorativa:
-- o quadro de confrontos só relia ao montar, e um reagendamento feito por
-- outra pessoa não aparecia até alguém reabrir a tela.
--
-- Segurança: a política `Public select matches` já é `USING (true)`, então o
-- realtime não expõe nada que uma consulta comum não exponha. A checagem de
-- RLS do realtime roda sobre essa mesma política.
--
-- `REPLICA IDENTITY` fica no padrão de propósito. `FULL` só é necessário para
-- filtrar DELETE por RLS e para receber a linha antiga inteira — nenhum dos
-- dois é usado aqui, onde o handler apenas relê a chave a cada evento, e
-- `FULL` engorda o WAL de uma tabela que muda o tempo todo durante um torneio.

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
          AND c.relname = 'matches'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
    END IF;
END
$$;
