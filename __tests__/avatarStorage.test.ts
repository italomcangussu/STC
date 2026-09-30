import { describe, expect, it, vi } from 'vitest';
import {
    AVATAR_BUCKET,
    LEGACY_AVATAR_FOLDER,
    buildAvatarPath,
    pruneOldAvatars,
    type AvatarStorageBucket,
} from '../lib/avatarStorage';

const USER = '8f8f7041-22b2-4bd1-9b89-ccf6672e8f33';

function bucketWith(own: string[], legacy: string[]) {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    const list = vi.fn(async (path: string) => ({
        data: (path === LEGACY_AVATAR_FOLDER ? legacy : own).map(name => ({ name })),
        error: null,
    }));
    return { bucket: { list, remove } as unknown as AvatarStorageBucket, list, remove };
}

describe('buildAvatarPath', () => {
    it('põe a foto na pasta do sócio, que é o que o RLS confere', () => {
        expect(buildAvatarPath(USER, 'selfie.JPEG', 1770000000000)).toBe(`${USER}/1770000000000.jpeg`);
    });

    it('muda de nome a cada troca, para o navegador não servir a foto velha', () => {
        expect(buildAvatarPath(USER, 'a.png', 1)).not.toBe(buildAvatarPath(USER, 'a.png', 2));
    });

    it('aceita arquivo sem extensão sem inventar uma', () => {
        expect(buildAvatarPath(USER, 'sem-extensao', 7)).toBe(`${USER}/7`);
    });

    it('usa o bucket público de avatares', () => {
        expect(AVATAR_BUCKET).toBe('avatars');
    });
});

describe('pruneOldAvatars', () => {
    it('apaga as fotos anteriores e preserva a recém-enviada', async () => {
        const keep = `${USER}/1770000000000.jpeg`;
        const { bucket, remove } = bucketWith(['1770000000000.jpeg', '1760000000000.jpeg'], []);

        const removed = await pruneOldAvatars(bucket, USER, keep);

        expect(removed).toEqual([`${USER}/1760000000000.jpeg`]);
        expect(remove).toHaveBeenCalledWith([`${USER}/1760000000000.jpeg`]);
    });

    /** 31 arquivos e 23 MB do esquema antigo estavam presos na raiz do bucket. */
    it('varre também os arquivos do esquema antigo, na raiz', async () => {
        const keep = `${USER}/1770000000000.jpeg`;
        const { bucket, remove, list } = bucketWith(['1770000000000.jpeg'], [`${USER}-0.99.jpeg`]);

        const removed = await pruneOldAvatars(bucket, USER, keep);

        expect(removed).toEqual([`${LEGACY_AVATAR_FOLDER}/${USER}-0.99.jpeg`]);
        expect(list).toHaveBeenCalledWith(LEGACY_AVATAR_FOLDER, expect.objectContaining({ search: USER }));
        expect(remove).toHaveBeenCalledOnce();
    });

    it('não chama o Storage quando não há nada para apagar', async () => {
        const keep = `${USER}/1770000000000.jpeg`;
        const { bucket, remove } = bucketWith(['1770000000000.jpeg'], []);

        expect(await pruneOldAvatars(bucket, USER, keep)).toEqual([]);
        expect(remove).not.toHaveBeenCalled();
    });

    it('propaga a falha do remove para quem chama decidir', async () => {
        const { bucket } = bucketWith(['antiga.jpeg'], []);
        (bucket.remove as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: new Error('sem permissão') });

        await expect(pruneOldAvatars(bucket, USER, `${USER}/nova.jpeg`)).rejects.toThrow('sem permissão');
    });
});
