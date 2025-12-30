-- Substitua 'admin@reservasct.com' pelo email do seu usuário admin
-- Execute este script no Supabase SQL Editor

DO $$
DECLARE
    target_email TEXT := 'admin@reservasct.com'; -- <--- COLOQUE O EMAIL DO ADMIN AQUI
    target_user_id UUID;
BEGIN
    -- 1. Buscar ID do usuário na tabela de autenticação
    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email = target_email;

    -- 2. Verificar se usuário existe
    IF target_user_id IS NULL THEN
        RAISE NOTICE 'Usuário com email % não encontrado em auth.users. Crie a conta primeiro.', target_email;
    ELSE
        -- 3. Inserir ou Atualizar Perfil
        INSERT INTO public.profiles (id, email, name, role, is_active)
        VALUES (
            target_user_id,
            target_email,
            'Administrador', -- Nome padrão
            'admin',         -- Garante o cargo de admin
            true             -- Garante que está ativo
        )
        ON CONFLICT (id) DO UPDATE
        SET 
            role = 'admin',
            is_active = true;
            
        RAISE NOTICE 'Perfil do usuário % corrigido/criado com sucesso com cargo ADMIN.', target_email;
    END IF;
END $$;
