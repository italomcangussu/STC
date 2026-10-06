import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getNowInFortaleza, formatDate } from '../../utils';
import type { AdminTabId } from './adminSections';

export interface AdminCounts {
    access: number;
    challenges: number;
    today: number;
    payments: number;
    forms: number;
}

type Filter = (q: any) => any;

const countOf = async (table: string, apply: Filter): Promise<number> => {
    const { count, error } = await apply(
        supabase.from(table).select('id', { count: 'exact', head: true }));
    return error ? 0 : count ?? 0;
};

/** Só o que pede uma ação do administrador ganha selo na navegação; "reservas hoje" e "formulários abertos" são informativos. */
export const pendingBySection = (c: AdminCounts | null): Partial<Record<AdminTabId, number>> =>
    c ? { acessos: c.access, desafios: c.challenges, financeiro: c.payments } : {};

const REFRESH_AFTER_MS = 30_000;

/**
 * Contagens de pendências do clube, carregadas uma vez para o painel inteiro
 * (selos da navegação + atalhos do início). `refresh` ignora chamadas em menos
 * de 30 s para que trocar de aba não dispare cinco consultas a cada toque.
 */
export const useAdminPending = () => {
    const [counts, setCounts] = useState<AdminCounts | null>(null);
    const loadedAt = useRef(0);
    const alive = useRef(true);

    const load = useCallback(async () => {
        loadedAt.current = Date.now();
        const [access, challenges, today, payments, forms] = await Promise.all([
            countOf('access_requests', q => q.eq('status', 'pending')),
            countOf('challenges', q => q.in('status', ['accepted', 'scheduled'])),
            countOf('reservations', q => q.eq('date', formatDate(getNowInFortaleza())).neq('status', 'cancelled')),
            countOf('reservations', q => q.eq('payment_status', 'pending').neq('status', 'cancelled')),
            countOf('club_forms', q => q.eq('is_active', true)),
        ]);
        if (alive.current) setCounts({ access, challenges, today, payments, forms });
    }, []);

    useEffect(() => {
        alive.current = true;
        void load();
        return () => { alive.current = false; };
    }, [load]);

    const refresh = useCallback(() => {
        if (Date.now() - loadedAt.current >= REFRESH_AFTER_MS) void load();
    }, [load]);

    return { counts, refresh };
};
