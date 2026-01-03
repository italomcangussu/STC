-- Migration: Create push_subscriptions table for Web Push Notifications
-- iOS PWA push notification support requires storing subscription endpoints

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    keys JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Each user can only have one active subscription per device
    UNIQUE(user_id)
);

-- Index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Enable RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage their own subscriptions
CREATE POLICY "Users can manage own subscriptions" ON push_subscriptions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Service role can read all (for sending notifications)
CREATE POLICY "Service role can read all" ON push_subscriptions
    FOR SELECT
    USING (auth.role() = 'service_role');

-- Add comment for documentation
COMMENT ON TABLE push_subscriptions IS 'Stores Web Push notification subscription data for iOS PWA and other browsers';
