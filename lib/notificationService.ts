import { supabase } from './supabase';

interface NotificationPayload {
    userId: string;
    title: string;
    body: string;
    url?: string;
    data?: any;
}

/**
 * Sends a push notification to a user via the 'send-push' Edge Function.
 */
export async function sendPushNotification({ userId, title, body, url, data }: NotificationPayload): Promise<boolean> {
    try {
        const { data: result, error } = await supabase.functions.invoke('send-push', {
            body: {
                user_id: userId,
                title,
                body,
                url,
                data
            }
        });

        if (error) {
            console.error('[Notification] Error calling Edge Function:', error);
            return false;
        }

        console.log('[Notification] Sent successfully:', result);
        return true;
    } catch (err) {
        console.error('[Notification] Unexpected error:', err);
        return false;
    }
}
