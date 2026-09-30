/**
 * Caminho e faxina dos arquivos de foto de perfil no bucket `avatars`.
 *
 * O esquema antigo gravava em `avatars/<id>-<random>.<ext>` e nunca apagava
 * nada: cada troca de foto deixava o arquivo anterior no bucket para sempre
 * (31 arquivos e 23 MB para 3 sócios, quando medimos). Duas mudanças resolvem:
 *
 * 1. cada sócio passa a ter a própria pasta (`<id>/<timestamp>.<ext>`), o que
 *    deixa o RLS amarrar escrita e remoção ao dono pelo primeiro segmento;
 * 2. toda troca de foto varre o que ficou para trás — inclusive os arquivos do
 *    esquema antigo, que continuam na raiz.
 *
 * O nome carrega o timestamp de propósito: a URL pública muda a cada troca, e
 * o navegador não fica exibindo a foto velha do cache.
 */

/** Bucket público onde as fotos de perfil vivem. */
export const AVATAR_BUCKET = 'avatars';

/** Pasta na raiz do bucket usada antes da pasta por sócio. */
export const LEGACY_AVATAR_FOLDER = 'avatars';

/** O `list` do Storage pagina; 100 cobre com folga o histórico de um sócio. */
const LIST_LIMIT = 100;

/** Só o que o Storage aceita como extensão — o resto vira arquivo sem extensão. */
function extensionOf(fileName: string): string {
    const match = /\.([A-Za-z0-9]{1,10})$/.exec(fileName);
    return match ? `.${match[1].toLowerCase()}` : '';
}

/**
 * Onde a foto nova do sócio será gravada.
 *
 * @param now Injetável para o teste; por padrão, o relógio.
 */
export function buildAvatarPath(userId: string, fileName: string, now: number = Date.now()): string {
    return `${userId}/${now}${extensionOf(fileName)}`;
}

/** O pedaço do `supabase.storage.from(...)` que a faxina usa. */
export interface AvatarStorageBucket {
    list(
        path: string,
        options?: { limit?: number; search?: string }
    ): Promise<{ data: { name: string }[] | null; error: unknown }>;
    remove(paths: string[]): Promise<{ data: unknown; error: unknown }>;
}

/**
 * Apaga todas as fotos anteriores do sócio, mantendo apenas `keepPath`.
 *
 * Melhor-esforço por natureza: a foto nova já está no ar quando isto roda, e
 * uma falha na limpeza não pode custar a troca ao sócio. Quem chama decide o
 * que fazer com o erro — nunca deixe ele derrubar o upload.
 *
 * @returns Os caminhos removidos.
 */
export async function pruneOldAvatars(
    bucket: AvatarStorageBucket,
    userId: string,
    keepPath: string
): Promise<string[]> {
    const stale: string[] = [];

    const own = await bucket.list(userId, { limit: LIST_LIMIT });
    for (const file of own.data ?? []) {
        const path = `${userId}/${file.name}`;
        if (path !== keepPath) stale.push(path);
    }

    // Esquema antigo: tudo na raiz, com o id do sócio no começo do nome.
    const legacy = await bucket.list(LEGACY_AVATAR_FOLDER, { limit: LIST_LIMIT, search: userId });
    for (const file of legacy.data ?? []) {
        const path = `${LEGACY_AVATAR_FOLDER}/${file.name}`;
        if (path !== keepPath) stale.push(path);
    }

    if (stale.length === 0) return [];

    const { error } = await bucket.remove(stale);
    if (error) throw error;

    return stale;
}
