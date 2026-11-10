/**
 * Laboratório de design — NÃO faz parte do app nem do build.
 *
 * Monta as telas reais fora do login, com o banco SIMULADO: toda chamada ao
 * Supabase é respondida aqui, sem sair da máquina. Serve para olhar e medir
 * (fabuloso-design `capturar`) antes e depois de cada mudança de design.
 *
 * Rotas: #agenda #ranking #desafios #campeonatos #meu-financeiro #vitrine
 * Papel: ?papel=admin|socio|lanchonete   Escuro: ?tema=escuro
 * Todos os nomes, horários e números aqui são de DEMONSTRAÇÃO.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';

// ---------------------------------------------------------------------------
// Banco simulado (precisa existir antes de qualquer import que crie o cliente)
// ---------------------------------------------------------------------------
const hoje = new Date();
const dia = (d: number) => {
    const x = new Date(hoje);
    x.setDate(x.getDate() + d);
    return x.toISOString().slice(0, 10);
};
const ME = '00000000-0000-0000-0000-000000000001';
const nomes = ['Ana Demo', 'Bruno Demo', 'Carla Demo', 'Diego Demo', 'Elisa Demo', 'Fábio Demo', 'Gabriela Demo Nome Bem Comprido da Silva', 'Heitor Demo'];
const profiles = nomes.map((name, i) => ({
    id: i === 0 ? ME : `00000000-0000-0000-0000-00000000000${i + 1}`,
    name,
    email: `demo${i}@exemplo.test`,
    phone: '',
    role: i === 0 ? 'socio' : 'socio',
    category: ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe'][i % 4],
    avatar_url: null,
    is_active: true,
    legacy_points: 120 - i * 11,
    legacy_wins: 9 - i,
    legacy_losses: i,
    legacy_matches_played: 9,
}));
const courts = [
    { id: 'c1', name: 'Quadra 1', type: 'Saibro', is_active: true },
    { id: 'c2', name: 'Quadra 2', type: 'Saibro', is_active: true },
    { id: 'c3', name: 'Quadra 3', type: 'Rápida', is_active: true },
];
const reservations = [
    { id: 'r1', type: 'Play', date: dia(0), start_time: '07:00', end_time: '08:00', court_id: 'c1', creator_id: ME, participant_ids: [ME, profiles[1].id], status: 'active' },
    { id: 'r2', type: 'Aula', date: dia(0), start_time: '08:00', end_time: '09:00', court_id: 'c2', creator_id: profiles[2].id, participant_ids: [profiles[2].id], status: 'active' },
    { id: 'r3', type: 'Desafio', date: dia(0), start_time: '18:00', end_time: '19:30', court_id: 'c1', creator_id: profiles[3].id, participant_ids: [profiles[3].id, profiles[4].id], status: 'active' },
    { id: 'r4', type: 'Play', date: dia(1), start_time: '19:00', end_time: '20:00', court_id: 'c3', creator_id: profiles[5].id, participant_ids: [profiles[5].id, profiles[6].id], status: 'active' },
];
const tabelas: Record<string, unknown[]> = {
    profiles,
    courts,
    reservations,
    challenges: [],
    matches: [],
    championships: [],
    professors: [],
    student_profiles: [],
    non_socio_students: [],
};

const json = (body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...extra } });

const fetchOriginal = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!/supabase\.(co|in)|\/rest\/v1|\/auth\/v1|\/functions\/v1|\/storage\/v1/.test(url.href)) return fetchOriginal(input, init);
    if (url.pathname.includes('/auth/v1')) return json({ user: null, session: null });
    if (url.pathname.includes('/functions/v1') || url.pathname.includes('/storage/v1')) return json({});
    const m = url.pathname.match(/\/rest\/v1\/(rpc\/)?([^/?]+)/);
    if (!m) return json([]);
    if (m[1]) return json([]);
    const linhas = (tabelas[m[2]] ?? []) as unknown[];
    const headers = new Headers(init?.headers);
    const metodo = (init?.method ?? 'GET').toUpperCase();
    if (metodo !== 'GET' && metodo !== 'HEAD') return json([]);
    const intervalo = { 'content-range': `0-${Math.max(linhas.length - 1, 0)}/${linhas.length}` };
    if ((headers.get('accept') ?? '').includes('vnd.pgrst.object')) {
        return linhas[0] ? json(linhas[0], intervalo) : new Response('{}', { status: 406 });
    }
    return json(linhas, intervalo);
};
// Realtime: nenhum socket sai da máquina.
class SocketMudo extends EventTarget {
    readyState = 3;
    send() {}
    close() {}
}
const WsOriginal = window.WebSocket;
window.WebSocket = function (this: unknown, url: string | URL, p?: string | string[]) {
    if (String(url).includes('supabase')) return new SocketMudo() as unknown as WebSocket;
    return new WsOriginal(url, p);
} as unknown as typeof WebSocket;

// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const papel = (params.get('papel') ?? 'socio') as 'admin' | 'socio' | 'lanchonete';
if (params.get('tema') === 'escuro') document.documentElement.dataset.tema = 'escuro';
// O convite de notificações cobre a tela inteira; no laboratório ele já foi dispensado.
try { localStorage.setItem('push_prompt_dismissed', String(Date.now())); } catch { /* sem armazenamento */ }

async function montar() {
    const [{ Layout }, { ConfirmProvider }, { Toaster }, telas] = await Promise.all([
        import('./components/Layout'),
        import('./components/ui/ConfirmProvider'),
        import('sonner'),
        Promise.all([
            import('./components/Agenda'),
            import('./components/Ranking'),
            import('./components/Challenges'),
            import('./components/Championships'),
            import('./components/finance/MemberFinance'),
            import('./design-lab-vitrine'),
        ]),
    ]);
    const [{ Agenda }, { Ranking }, { ChallengesView }, { Championships }, { MemberFinance }, { Vitrine }] = telas;
    const user = { id: ME, name: 'Ana Demo', role: papel, email: 'demo0@exemplo.test', isActive: true };

    const Lab = () => {
        const [view, setView] = React.useState(() => location.hash.slice(1) || 'agenda');
        React.useEffect(() => {
            const on = () => setView(location.hash.slice(1) || 'agenda');
            window.addEventListener('hashchange', on);
            return () => window.removeEventListener('hashchange', on);
        }, []);
        const ir = (v: string) => { location.hash = v; };
        if (view === 'vitrine') return <><Toaster position="top-center" richColors /><Vitrine /></>;
        return (
            <ConfirmProvider>
                <Toaster position="top-center" richColors />
                <Layout view={view} setView={ir} currentUser={user} onLogout={() => {}}>
                    {view === 'agenda' && <Agenda currentUser={user} />}
                    {view === 'ranking' && <Ranking onSelectProfile={() => {}} />}
                    {view === 'desafios' && <ChallengesView currentUser={user} />}
                    {(view === 'campeonatos' || view === 'competicao') && <Championships currentUser={user} />}
                    {view === 'meu-financeiro' && <MemberFinance currentUser={user} />}
                </Layout>
            </ConfirmProvider>
        );
    };
    createRoot(document.getElementById('root')!).render(<Lab />);
}
montar();
