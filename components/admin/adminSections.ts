export type AdminTabId =
    | 'dashboard' | 'formularios' | 'lancamentos' | 'superset' | 'torneios'
    | 'reservas' | 'desafios' | 'financeiro' | 'acessos' | 'socios'
    | 'alunos' | 'professores' | 'regras' | 'avisos' | 'conversas' | 'documentos';

export interface AdminSection {
    id: AdminTabId;
    label: string;
    hint: string;
    keywords: string[];
}

export interface AdminGroup {
    id: string;
    label: string;
    sections: AdminSection[];
}

export const ADMIN_GROUPS: AdminGroup[] = [
    {
        id: 'inicio', label: 'Início', sections: [
            { id: 'dashboard', label: 'Visão geral', hint: 'Indicadores do clube', keywords: ['dashboard', 'resumo', 'indicadores'] },
        ],
    },
    {
        id: 'quadra', label: 'Quadra', sections: [
            { id: 'reservas', label: 'Reservas', hint: 'Horários e cancelamentos', keywords: ['agenda', 'quadra', 'horario'] },
            { id: 'desafios', label: 'Desafios', hint: 'Propostas e resultados', keywords: ['desafio', 'partida'] },
            { id: 'lancamentos', label: 'Lançamentos', hint: 'Registrar jogos e resetar ranking', keywords: ['ranking', 'auditoria', 'reset'] },
            { id: 'superset', label: 'SuperSet', hint: 'Partidas SuperSet', keywords: ['super set'] },
        ],
    },
    {
        id: 'competicoes', label: 'Competições', sections: [
            { id: 'torneios', label: 'Torneios', hint: 'Campeonatos e chaves', keywords: ['campeonato', 'chave', 'grupo'] },
            { id: 'formularios', label: 'Formulários', hint: 'Inscrições e votações', keywords: ['inscricao', 'votacao', 'form'] },
        ],
    },
    {
        id: 'pessoas', label: 'Pessoas', sections: [
            { id: 'acessos', label: 'Acessos', hint: 'Aprovar novos cadastros', keywords: ['solicitacao', 'aprovar', 'cadastro', 'login'] },
            { id: 'socios', label: 'Sócios', hint: 'Editar sócios e papéis', keywords: ['socio', 'membro', 'atleta', 'perfil'] },
            { id: 'alunos', label: 'Alunos', hint: 'Alunos e dependentes', keywords: ['aluno', 'dependente', 'aula'] },
            { id: 'professores', label: 'Professores', hint: 'Professores e agenda', keywords: ['professor', 'treinador'] },
        ],
    },
    {
        id: 'clube', label: 'Clube', sections: [
            { id: 'financeiro', label: 'Financeiro', hint: 'Cobranças e pagamentos', keywords: ['pagamento', 'mensalidade', 'cobranca', 'dinheiro'] },
            { id: 'conversas', label: 'Conversas', hint: 'WhatsApp, automações e IA', keywords: ['whatsapp', 'chat', 'mensagem', 'atendimento', 'automacao', 'ia', 'bot', 'grupo'] },
            { id: 'documentos', label: 'Documentos', hint: 'Assinaturas dos sócios', keywords: ['assinatura', 'assinar', 'termo', 'contrato', 'pdf', 'regimento', 'autorizacao', 'documento'] },
            { id: 'avisos', label: 'Avisos', hint: 'Comunicados aos sócios', keywords: ['comunicado', 'anuncio', 'banner'] },
            { id: 'regras', label: 'Regras', hint: 'Regras do clube', keywords: ['regulamento', 'config'] },
        ],
    },
];

const STORAGE_KEY = 'admin-panel-last-tab';

const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export const ALL_SECTIONS: AdminSection[] = ADMIN_GROUPS.flatMap(g => g.sections);

export const isAdminTabId = (value: unknown): value is AdminTabId =>
    typeof value === 'string' && ALL_SECTIONS.some(s => s.id === value);

export const groupOf = (id: AdminTabId): AdminGroup =>
    ADMIN_GROUPS.find(g => g.sections.some(s => s.id === id)) ?? ADMIN_GROUPS[0];

export const searchSections = (query: string): AdminSection[] => {
    const q = normalize(query);
    if (!q) return [];
    return ALL_SECTIONS.filter(s =>
        [s.label, s.hint, ...s.keywords].some(t => normalize(t).includes(q)));
};

export const loadLastTab = (): AdminTabId => {
    try {
        const hash = window.location.hash.replace('#admin=', '');
        if (isAdminTabId(hash)) return hash;
        const saved = localStorage.getItem(STORAGE_KEY);
        if (isAdminTabId(saved)) return saved;
    } catch { /* storage indisponível */ }
    return 'dashboard';
};

export const saveLastTab = (id: AdminTabId) => {
    try {
        localStorage.setItem(STORAGE_KEY, id);
        window.history.replaceState(null, '', `#admin=${id}`);
    } catch { /* ignore */ }
};
