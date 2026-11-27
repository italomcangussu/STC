import React, { useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { notify } from '../lib/notifications';
import { publicChampionshipPath } from '../lib/publicRoutes';

interface Props {
    slug: string;
    championshipName: string;
}

/**
 * Compartilha o link público do campeonato (quem não é sócio vê a chave sem login).
 * No celular abre o menu de compartilhar; sem ele, copia o link.
 */
export const PublicChampionshipLinkButton: React.FC<Props> = ({ slug, championshipName }) => {
    const [copied, setCopied] = useState(false);
    const url = `${window.location.origin}${publicChampionshipPath(slug)}`;

    const copyLink = async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        notify.success('Link público copiado.', { description: 'Quem abrir vê o campeonato sem precisar entrar no app.' });
        window.setTimeout(() => setCopied(false), 2000);
    };

    const share = async () => {
        try {
            if (navigator.share) {
                await navigator.share({ title: championshipName, url });
                return;
            }
            await copyLink();
        } catch (error) {
            if ((error as DOMException)?.name === 'AbortError') return;
            notify.failure(error, 'Não foi possível copiar o link.', { event: 'public_link_share_failed' });
        }
    };

    return (
        <button
            type="button"
            onClick={share}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-white/20 px-4 text-xs font-extrabold uppercase tracking-widest text-white backdrop-blur-sm transition-colors hover:bg-white/30"
        >
            {copied ? <Check size={16} /> : <Link2 size={16} />}
            {copied ? 'Link copiado' : 'Link público'}
        </button>
    );
};
