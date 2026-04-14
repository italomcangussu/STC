// @ts-nocheck
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const normalizePhoneDigits = (phone: string): string => (phone || '').replace(/\D/g, '');

const normalizePhoneBr = (phone: string): string => {
    const digits = normalizePhoneDigits(phone);
    if (!digits) return '';

    let local = digits;

    if (local.startsWith('55') && local.length >= 12) {
        local = local.slice(2);
    }

    if (local.length > 11) {
        local = local.slice(-11);
    }

    return local;
};

const generateLegacyEmailFromPhone = (phone: string): string => `${normalizePhoneBr(phone)}@reserva.com`;
const generateLegacyPasswordFromPhone = (phone: string): string => `sct${normalizePhoneBr(phone)}2024`;
const isDuplicateAuthEmailError = (error: any): boolean => /already|duplicate|exists/i.test(String(error?.message || ''));

const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
        },
    });

const getAdminContext = async (req: Request) => {
    const authorization = req.headers.get('Authorization');
    if (!authorization) {
        return { error: json(401, { error: 'Authorization header ausente.' }) };
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
            headers: {
                Authorization: authorization,
            },
        },
    });

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const {
        data: { user },
        error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
        return { error: json(401, { error: 'Usuário não autenticado.' }) };
    }

    const { data: profile, error: profileError } = await adminClient
        .from('profiles')
        .select('id, role')
        .eq('id', user.id)
        .single();

    if (profileError || !profile || profile.role !== 'admin') {
        return { error: json(403, { error: 'Apenas administradores podem executar esta ação.' }) };
    }

    return { adminClient, adminUserId: user.id };
};

const buildEmailCandidates = (preferredEmail: string, normalizedPhone: string): string[] => {
    const fallback = generateLegacyEmailFromPhone(normalizedPhone);
    const alias = `legacy.${normalizedPhone}@reserva.com`;
    return Array.from(
        new Set(
            [preferredEmail, fallback, alias]
                .map((value) => String(value || '').trim().toLowerCase())
                .filter(Boolean)
        )
    );
};

const ensureLegacyAuthUser = async ({
    adminClient,
    existingProfileId,
    name,
    normalizedPhone,
    preferredEmail,
    authPassword,
}: {
    adminClient: any;
    existingProfileId?: string;
    name: string;
    normalizedPhone: string;
    preferredEmail: string;
    authPassword: string;
}) => {
    const emailCandidates = buildEmailCandidates(preferredEmail, normalizedPhone);
    const basePayload = {
        password: authPassword,
        email_confirm: true,
        user_metadata: {
            name,
            phone: normalizedPhone,
        },
    };

    if (existingProfileId) {
        const { data: profileAuthUser, error: getUserError } = await adminClient.auth.admin.getUserById(existingProfileId);
        if (getUserError && getUserError.status !== 404) {
            throw new Error(getUserError.message || 'Falha ao buscar usuário existente no Auth.');
        }

        if (profileAuthUser?.user?.id) {
            for (const candidateEmail of emailCandidates) {
                const { error: updateError } = await adminClient.auth.admin.updateUserById(existingProfileId, {
                    ...basePayload,
                    email: candidateEmail,
                });

                if (!updateError) {
                    return { userId: existingProfileId, created: false, authEmail: candidateEmail };
                }

                if (!isDuplicateAuthEmailError(updateError)) {
                    throw new Error(updateError.message || 'Falha ao atualizar credenciais do Auth.');
                }
            }

            throw new Error('Não foi possível atualizar usuário Auth: todos os emails candidatos já estão em uso.');
        }
    }

    for (const candidateEmail of emailCandidates) {
        const { data: createdUserData, error: createUserError } = await adminClient.auth.admin.createUser({
            ...basePayload,
            email: candidateEmail,
        });

        if (!createUserError && createdUserData?.user?.id) {
            return { userId: createdUserData.user.id, created: true, authEmail: candidateEmail };
        }

        if (!isDuplicateAuthEmailError(createUserError)) {
            throw new Error(createUserError?.message || 'Falha ao criar usuário no Auth.');
        }
    }

    throw new Error('Não foi possível criar usuário Auth: todos os emails candidatos já estão em uso.');
};

const provisionAthlete = async ({
    adminClient,
    name,
    phone,
    email,
}: {
    adminClient: any;
    name: string;
    phone: string;
    email?: string | null;
}) => {
    const normalizedPhone = normalizePhoneBr(phone);
    if (!normalizedPhone) {
        throw new Error('Telefone inválido.');
    }
    const preferredEmail = (email && String(email).trim()) || generateLegacyEmailFromPhone(normalizedPhone);
    const authPassword = generateLegacyPasswordFromPhone(normalizedPhone);

    const { data: existingProfile } = await adminClient
        .from('profiles')
        .select('id, is_active')
        .eq('phone', normalizedPhone)
        .order('is_active', { ascending: false })
        .limit(1)
        .maybeSingle();

    const authUser = await ensureLegacyAuthUser({
        adminClient,
        existingProfileId: existingProfile?.id,
        name,
        normalizedPhone,
        preferredEmail,
        authPassword,
    });

    if (existingProfile?.id) {
        const { error: updateProfileError } = await adminClient
            .from('profiles')
            .update({
                name,
                email: authUser.authEmail,
                phone: normalizedPhone,
                role: 'socio',
                is_active: true,
            })
            .eq('id', existingProfile.id);

        if (updateProfileError) {
            throw new Error(updateProfileError.message || 'Falha ao atualizar perfil do atleta.');
        }

        return {
            profileId: existingProfile.id,
            authUserId: authUser.userId,
            alreadyProvisioned: Boolean(existingProfile.is_active && !authUser.created),
        };
    }

    const { error: upsertProfileError } = await adminClient
        .from('profiles')
        .upsert({
            id: authUser.userId,
            name,
            email: authUser.authEmail,
            phone: normalizedPhone,
            role: 'socio',
            is_active: true,
        });

    if (upsertProfileError) {
        throw new Error(upsertProfileError.message || 'Falha ao criar perfil do atleta.');
    }

    return {
        profileId: authUser.userId,
        authUserId: authUser.userId,
        alreadyProvisioned: false,
    };
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
        return json(500, { error: 'Configuração de ambiente incompleta para a função.' });
    }

    try {
        const { adminClient, adminUserId, error } = await getAdminContext(req);
        if (error) return error;

        const body = await req.json();
        const action = body?.action;

        if (!action) {
            return json(400, { error: 'Campo action é obrigatório.' });
        }

        if (action === 'approve_request') {
            const requestId = body?.requestId;
            if (!requestId) {
                return json(400, { error: 'requestId é obrigatório para approve_request.' });
            }

            const { data: requestRow, error: requestError } = await adminClient
                .from('access_requests')
                .select('*')
                .eq('id', requestId)
                .single();

            if (requestError || !requestRow) {
                return json(404, { error: 'Solicitação não encontrada.' });
            }

            if (requestRow.status === 'approved') {
                return json(200, { success: true, alreadyApproved: true });
            }

            const name = (requestRow.name || '').trim();
            if (!name) {
                return json(400, { error: 'Solicitação inválida: nome é obrigatório.' });
            }

            const provision = await provisionAthlete({
                adminClient,
                name,
                phone: requestRow.phone_normalized || requestRow.phone,
                email: requestRow.email,
            });

            const { error: updateRequestError } = await adminClient
                .from('access_requests')
                .update({
                    status: 'approved',
                    rejection_reason: null,
                    decided_by: adminUserId,
                    decided_at: new Date().toISOString(),
                })
                .eq('id', requestId);

            if (updateRequestError) {
                throw new Error(updateRequestError.message || 'Erro ao atualizar status da solicitação.');
            }

            return json(200, {
                success: true,
                requestId,
                profileId: provision.profileId,
                alreadyProvisioned: provision.alreadyProvisioned,
            });
        }

        if (action === 'reject_request') {
            const requestId = body?.requestId;
            const rejectionReason = body?.rejectionReason || null;

            if (!requestId) {
                return json(400, { error: 'requestId é obrigatório para reject_request.' });
            }

            const { error: updateRequestError } = await adminClient
                .from('access_requests')
                .update({
                    status: 'rejected',
                    rejection_reason: rejectionReason,
                    decided_by: adminUserId,
                    decided_at: new Date().toISOString(),
                })
                .eq('id', requestId);

            if (updateRequestError) {
                throw new Error(updateRequestError.message || 'Erro ao rejeitar solicitação.');
            }

            return json(200, { success: true, requestId });
        }

        if (action === 'create_athlete') {
            const name = (body?.name || '').trim();
            const phone = (body?.phone || '').trim();
            const email = body?.email ? String(body.email).trim() : null;

            if (!name || !phone) {
                return json(400, { error: 'Nome e telefone são obrigatórios para create_athlete.' });
            }

            const provision = await provisionAthlete({
                adminClient,
                name,
                phone,
                email,
            });

            const normalizedPhone = normalizePhoneBr(phone);

            await adminClient
                .from('access_requests')
                .update({
                    status: 'approved',
                    rejection_reason: null,
                    decided_by: adminUserId,
                    decided_at: new Date().toISOString(),
                })
                .eq('phone_normalized', normalizedPhone)
                .eq('status', 'pending');

            return json(200, {
                success: true,
                profileId: provision.profileId,
                alreadyProvisioned: provision.alreadyProvisioned,
            });
        }

        return json(400, { error: `Ação inválida: ${action}` });
    } catch (error) {
        console.error('[admin-athlete-access]', error);
        return json(400, {
            error: error instanceof Error ? error.message : 'Erro inesperado ao processar ação.',
        });
    }
});
