-- Migration: publicar `reservations` e `challenges` para realtime
--
-- A Agenda (components/Agenda.tsx, via hooks/useAgendaRealtime.ts) assina mudanças de
-- `reservations`, `matches` e `challenges` para se atualizar quando alguém cria uma reserva,
-- entra nela ou sai dela. Só `matches` estava na publicação `supabase_realtime`
-- (ver 20260824140000_enable_realtime_on_matches.sql): para as outras duas o servidor nunca
-- enviava evento, e a Agenda só mostrava a mudança depois de recarregar a tela.
--
-- Segurança: as políticas de leitura (`Reservations viewable by everyone`,
-- `Public select challenges`) já são `USING (true)`, então o realtime não expõe nada que uma
-- consulta comum não exponha. A checagem de RLS do realtime roda sobre essas mesmas políticas.
--
-- `REPLICA IDENTITY` fica no padrão de propósito: o handler relê os dados a cada evento e não
-- usa a linha antiga. `FULL` engordaria o WAL sem benefício.

DO $$
DECLARE
    v_tabela text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE NOTICE 'publicação supabase_realtime ausente: Agenda sem tempo real';
        RETURN;
    END IF;

    FOREACH v_tabela IN ARRAY ARRAY['reservations', 'challenges'] LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = v_tabela
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tabela);
        END IF;
    END LOOP;
END
$$;
