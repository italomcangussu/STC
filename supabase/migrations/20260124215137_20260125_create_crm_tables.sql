-- Create crm_leads table
CREATE TABLE IF NOT EXISTS public.crm_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id),
    phone TEXT NOT NULL,
    name TEXT,
    contact_id TEXT, -- WhatsApp ID or similar
    entity_id TEXT, -- Instance ID
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    last_interaction_at TIMESTAMPTZ DEFAULT now(),
    avatar_url TEXT,
    tags TEXT[],
    email TEXT,
    UNIQUE(store_id, phone)
);

-- Create crm_conversations table
CREATE TABLE IF NOT EXISTS public.crm_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id),
    lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
    talk_id TEXT, -- External conversation ID
    status TEXT DEFAULT 'open', -- open, closed, pending, swouth
    ai_enabled BOOLEAN DEFAULT TRUE,
    unread_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create crm_messages table
CREATE TABLE IF NOT EXISTS public.crm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.crm_conversations(id) ON DELETE CASCADE,
    direction TEXT CHECK (direction IN ('inbound', 'outbound')),
    sender_type TEXT DEFAULT 'customer', -- customer, agent, ai, system
    content TEXT,
    media_url TEXT,
    media_type TEXT,
    external_id TEXT,
    webhook_payload JSONB,
    status TEXT DEFAULT 'sent', -- sent, delivered, read, failed
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_crm_leads_store_phone ON public.crm_leads(store_id, phone);
CREATE INDEX IF NOT EXISTS idx_crm_conversations_store_lead ON public.crm_conversations(store_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_messages_conversation ON public.crm_messages(conversation_id);

-- Enable RLS
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Simplified for now - adjust as needed for auth model)
CREATE POLICY "Enable all access for authenticated users" ON public.crm_leads FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all access for authenticated users" ON public.crm_conversations FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all access for authenticated users" ON public.crm_messages FOR ALL USING (auth.role() = 'authenticated');

-- RPC: upsert_crm_lead
CREATE OR REPLACE FUNCTION public.upsert_crm_lead(
    p_store_id UUID,
    p_phone TEXT,
    p_name TEXT,
    p_contact_id TEXT,
    p_entity_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_lead_id UUID;
BEGIN
    INSERT INTO public.crm_leads (store_id, phone, name, contact_id, entity_id, last_interaction_at)
    VALUES (p_store_id, p_phone, p_name, p_contact_id, p_entity_id, now())
    ON CONFLICT (store_id, phone) 
    DO UPDATE SET 
        name = COALESCE(EXCLUDED.name, public.crm_leads.name), -- Don't overwrite name with null
        contact_id = COALESCE(EXCLUDED.contact_id, public.crm_leads.contact_id),
        entity_id = COALESCE(EXCLUDED.entity_id, public.crm_leads.entity_id),
        last_interaction_at = now()
    RETURNING id INTO v_lead_id;

    RETURN v_lead_id;
END;
$$;

-- RPC: increment_unread_count
CREATE OR REPLACE FUNCTION public.increment_unread_count(
    p_conversation_id UUID,
    p_last_customer_message_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.crm_conversations
    SET 
        unread_count = unread_count + 1,
        last_message_at = p_last_customer_message_at
    WHERE id = p_conversation_id;
END;
$$;;
