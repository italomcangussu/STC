-- Push Subscriptions: Múltiplos dispositivos por usuário (mobile + desktop) e suporte a notificações para administradores
-- Migration: 20261007130000_push_subscriptions_multi_device_and_admin_notify.sql

-- 1. Remove restrição de um único dispositivo por usuário para permitir notificações tanto no celular quanto no computador
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'push_subscriptions_user_id_key' 
        AND conrelid = 'public.push_subscriptions'::regclass
    ) THEN
        ALTER TABLE public.push_subscriptions DROP CONSTRAINT push_subscriptions_user_id_key;
    END IF;
END $$;

-- 2. Garante que cada endpoint de navegador seja único
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'push_subscriptions_endpoint_key' 
        AND conrelid = 'public.push_subscriptions'::regclass
    ) THEN
        ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
    END IF;
EXCEPTION
    WHEN duplicate_table THEN NULL;
END $$;

-- 3. Índices otimizados para busca
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON public.push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_updated ON public.push_subscriptions(user_id, updated_at DESC);

-- 4. Políticas de RLS atualizadas
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can manage own subscriptions" ON public.push_subscriptions
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can all" ON public.push_subscriptions;
CREATE POLICY "Service role can all" ON public.push_subscriptions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. Função para obter endpoints de todos os administradores cadastrados
CREATE OR REPLACE FUNCTION public.get_admin_push_subscriptions()
RETURNS TABLE (
    id UUID,
    user_id UUID,
    endpoint TEXT,
    keys JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT s.id, s.user_id, s.endpoint, s.keys
    FROM public.push_subscriptions s
    INNER JOIN public.profiles p ON p.id = s.user_id
    WHERE p.role = 'admin';
$$;

-- Só o service_role (edge function send-push) lista endpoints e chaves: expor a RPC a
-- authenticated/anon deixaria qualquer sócio logado ler as assinaturas de todos os admins.
REVOKE ALL ON FUNCTION public.get_admin_push_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_push_subscriptions() TO service_role;

COMMENT ON FUNCTION public.get_admin_push_subscriptions IS 'Retorna todas as assinaturas push ativas dos administradores do clube';
