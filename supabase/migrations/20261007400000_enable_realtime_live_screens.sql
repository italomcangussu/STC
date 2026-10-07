-- Migration: publicar no realtime as tabelas que alimentam telas que antes só atualizavam ao recarregar
--
-- Telas atendidas (via hooks/useLiveRefresh.ts, que só relê os dados a cada evento):
--   Desafios (challenges), Ranking (matches, challenges), selos do painel admin
--   (access_requests, challenges, reservations, club_forms) e Financeiro (fin_receipt_submissions).
--
-- Segurança: o realtime aplica as mesmas políticas RLS do SELECT; quem não lê a linha não recebe o evento.
-- Desempenho: REPLICA IDENTITY fica no padrão (o handler não usa a linha antiga) e o cliente
-- junta rajadas com debounce e não relê com a aba oculta.
-- Rollback: ALTER PUBLICATION supabase_realtime DROP TABLE public.<tabela>.

DO $$
DECLARE
    v_tabela text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE NOTICE 'publicação supabase_realtime ausente: telas sem tempo real';
        RETURN;
    END IF;

    FOREACH v_tabela IN ARRAY ARRAY['challenges', 'matches', 'access_requests', 'reservations', 'club_forms', 'fin_receipt_submissions'] LOOP
        IF to_regclass('public.' || v_tabela) IS NOT NULL
           AND NOT EXISTS (
                SELECT 1 FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_tabela
           ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tabela);
        END IF;
    END LOOP;
END
$$;
