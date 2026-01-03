// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const VAPID_PUBLIC_KEY = 'BLnOCELBk2YT3FlawO9KimRA0lrWRMO98zFzttXdrK6L_lW9yUXTvsVHZWEPKKtle1jSPwlPU3e97w6qT06p8qQ'
const VAPID_PRIVATE_KEY = 'H-woFjW3qgPezjgtgyYVe8MAEpbHwq0htW3PibITtAs'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

webpush.setVapidDetails(
    'mailto:contato@stcplay.com.br',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
)

Deno.serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
            },
        })
    }

    try {
        const { user_id, title, body, url, data } = await req.json()

        if (!user_id || !title || !body) {
            throw new Error('Missing required fields: user_id, title, body')
        }

        // Initialize Supabase client
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

        // Get user subscriptions
        const { data: subscriptions, error: dbError } = await supabase
            .from('push_subscriptions')
            .select('*')
            .eq('user_id', user_id)

        if (dbError) throw dbError

        if (!subscriptions || subscriptions.length === 0) {
            return new Response(
                JSON.stringify({ message: 'No subscriptions found for user', success: true }),
                { headers: { 'Content-Type': 'application/json' } }
            )
        }

        const payload = JSON.stringify({
            title,
            body,
            url, // Optional URL to open
            icon: '/android-chrome-192x192.png',
            badge: '/favicon-32.png',
            data // Arbitrary data
        })

        const results = []

        // Send to all user subscriptions (usually one per device)
        for (const sub of subscriptions) {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: sub.keys
            }

            try {
                await webpush.sendNotification(pushSubscription, payload)
                results.push({ id: sub.id, status: 'sent' })
            } catch (error) {
                console.error('Error sending push:', error)

                // If subscription is invalid (404 or 410), delete it
                if (error.statusCode === 404 || error.statusCode === 410) {
                    await supabase.from('push_subscriptions').delete().eq('id', sub.id)
                    results.push({ id: sub.id, status: 'deleted' })
                } else {
                    results.push({ id: sub.id, status: 'error', error: error.message })
                }
            }
        }

        return new Response(
            JSON.stringify({ success: true, results }),
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                }
            }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                }
            }
        )
    }
})
