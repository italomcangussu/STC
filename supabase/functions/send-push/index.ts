// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || Deno.env.get('VITE_VAPID_PUBLIC_KEY') || ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || ''
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets')
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
        const bodyData = await req.json()
        const { user_id, admin_broadcast, title, body, url, tag, data } = bodyData

        // O disparo para todos os admins só vale com a chave de serviço (webhook do WhatsApp):
        // a anon key é pública e qualquer visitante poderia notificar os administradores.
        if (admin_broadcast) {
            const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
            const serviceKeys = [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('SUPABASE_SECRET_KEY')].filter(Boolean)
            if (!bearer || !serviceKeys.includes(bearer)) {
                return new Response(
                    JSON.stringify({ error: 'admin_broadcast requires service role credentials' }),
                    { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
                )
            }
        }

        if ((!user_id && !admin_broadcast) || !title || !body) {
            throw new Error('Missing required fields: user_id (or admin_broadcast), title, body')
        }

        // Initialize Supabase client
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

        // Get target subscriptions
        let subscriptions = []
        if (admin_broadcast) {
            const { data: rpcSubs, error: rpcError } = await supabase.rpc('get_admin_push_subscriptions')
            if (!rpcError && rpcSubs && rpcSubs.length > 0) {
                subscriptions = rpcSubs
            } else {
                const { data: adminProfiles } = await supabase.from('profiles').select('id').eq('role', 'admin')
                const adminIds = adminProfiles?.map((p) => p.id) || []
                if (adminIds.length > 0) {
                    const { data: subData } = await supabase.from('push_subscriptions').select('*').in('user_id', adminIds)
                    subscriptions = subData || []
                }
            }
        } else {
            const { data: userSubs, error: dbError } = await supabase
                .from('push_subscriptions')
                .select('*')
                .eq('user_id', user_id)
            if (dbError) throw dbError
            subscriptions = userSubs || []
        }

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
            tag, // Optional: notifications with the same tag replace each other (one per conversation)
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

                // Assinatura expirada (404/410) ou criada com outra chave VAPID (401/403): descarta, o app refaz
                if ([401, 403, 404, 410].includes(error.statusCode)) {
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
