-- Create support messages table
CREATE TABLE IF NOT EXISTS public.support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    country_code TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    message_type TEXT NOT NULL CHECK (message_type IN ('suggestion', 'support', 'error', 'compliment', 'complaint')),
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'answered')),
    admin_response TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_support_messages_status ON public.support_messages(status);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON public.support_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_email ON public.support_messages(email);

-- Enable RLS
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert (para permitir formulário público)
CREATE POLICY "Anyone can submit support messages"
    ON public.support_messages
    FOR INSERT
    WITH CHECK (true);

-- Policy: Admins podem ver tudo (assumindo que existe uma função is_admin())
-- Se você não tem função is_admin, vou criar uma versão baseada em email
CREATE POLICY "Admins can view all support messages"
    ON public.support_messages
    FOR SELECT
    USING (
        -- Permitir se for admin (você pode ajustar a lógica)
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE auth.users.id = auth.uid()
            AND auth.users.email IN ('italomcangussu@icloud.com') -- Adicione emails de admins aqui
        )
    );

-- Policy: Admins podem atualizar
CREATE POLICY "Admins can update support messages"
    ON public.support_messages
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE auth.users.id = auth.uid()
            AND auth.users.email IN ('italomcangussu@icloud.com')
        )
    );

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_support_messages_updated_at
    BEFORE UPDATE ON public.support_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();;
