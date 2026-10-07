// Criação do acesso de um sócio no Auth + perfil, com o MESMO critério da função do painel (admin-athlete-access):
// e-mail e senha legados derivados do telefone, perfil `socio` ativo. Fica aqui para o João cadastrar sócios sem
// passar pelo navegador; quem chama já decidiu (proposta + "sim") e roda com a chave de serviço.

export type ProvisionInput = { name: string; phone: string; email?: string | null };
export type ProvisionResult = { ok: true; profileId: string; alreadyProvisioned: boolean } | { ok: false; error: string };
export type Provision = (input: ProvisionInput) => Promise<ProvisionResult>;

// deno-lint-ignore no-explicit-any
type Admin = any;

export const normalizePhoneBr = (phone: string): string => {
  let local = (phone || '').replace(/\D/g, '');
  if (local.startsWith('55') && local.length >= 12) local = local.slice(2);
  if (local.length > 11) local = local.slice(-11);
  return local;
};

const legacyEmail = (phone: string) => `${normalizePhoneBr(phone)}@reserva.com`;
const legacyPassword = (phone: string) => `sct${normalizePhoneBr(phone)}2024`;
const isDuplicate = (e: { message?: string } | null) => /already|duplicate|exists/i.test(String(e?.message || ''));

async function ensureAuthUser(admin: Admin, o: { existingProfileId?: string; name: string; phone: string; preferredEmail: string }) {
  const candidates = Array.from(new Set([o.preferredEmail, legacyEmail(o.phone), `legacy.${o.phone}@reserva.com`]
    .map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)));
  const base = { password: legacyPassword(o.phone), email_confirm: true, user_metadata: { name: o.name, phone: o.phone } };

  if (o.existingProfileId) {
    const found = await admin.auth.admin.getUserById(o.existingProfileId);
    if (found.error && found.error.status !== 404) throw new Error(found.error.message || 'Falha ao buscar usuário existente no Auth.');
    if (found.data?.user?.id) {
      for (const email of candidates) {
        const { error } = await admin.auth.admin.updateUserById(o.existingProfileId, { ...base, email });
        if (!error) return { userId: o.existingProfileId, created: false, email };
        if (!isDuplicate(error)) throw new Error(error.message || 'Falha ao atualizar credenciais do Auth.');
      }
      throw new Error('Todos os e-mails candidatos já estão em uso.');
    }
  }
  for (const email of candidates) {
    const { data, error } = await admin.auth.admin.createUser({ ...base, email });
    if (!error && data?.user?.id) return { userId: data.user.id as string, created: true, email };
    if (!isDuplicate(error)) throw new Error(error?.message || 'Falha ao criar usuário no Auth.');
  }
  throw new Error('Todos os e-mails candidatos já estão em uso.');
}

/** Cria (ou reativa) o sócio. Nunca mexe em quem já é professor ou administrador. */
export function makeProvision(admin: Admin): Provision {
  return async ({ name, phone, email }) => {
    try {
      const normalized = normalizePhoneBr(phone);
      if (!normalized) return { ok: false, error: 'Telefone inválido.' };
      const { data: existing } = await admin.from('profiles').select('id, is_active, role').eq('phone', normalized)
        .order('is_active', { ascending: false }).limit(1).maybeSingle();
      if (existing && existing.role !== 'socio') return { ok: false, error: 'Esse telefone já pertence a outro tipo de cadastro.' };
      const user = await ensureAuthUser(admin, { existingProfileId: existing?.id, name, phone: normalized,
        preferredEmail: (email && String(email).trim()) || legacyEmail(normalized) });
      if (existing?.id) {
        const { error } = await admin.from('profiles').update({ name, email: user.email, phone: normalized, role: 'socio', is_active: true }).eq('id', existing.id);
        if (error) return { ok: false, error: error.message || 'Falha ao atualizar o perfil.' };
        return { ok: true, profileId: existing.id, alreadyProvisioned: Boolean(existing.is_active && !user.created) };
      }
      const { error } = await admin.from('profiles').upsert({ id: user.userId, name, email: user.email, phone: normalized, role: 'socio', is_active: true });
      if (error) return { ok: false, error: error.message || 'Falha ao criar o perfil.' };
      return { ok: true, profileId: user.userId, alreadyProvisioned: false };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Erro inesperado.' };
    }
  };
}
