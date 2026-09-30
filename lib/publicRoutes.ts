export type PublicAppRoute =
  | { type: 'list' }
  | { type: 'slug'; slug: string }
  | { type: 'form-slug'; slug: string }
  | { type: 'none' };

export type PublicChampionshipRoute = PublicAppRoute;

export interface PublicChampionshipSummary {
  id: string;
  slug: string | null;
  status: string | null;
  registration_open: boolean | null;
}

const APP_PATHS = new Set([
  'agenda',
  'dashboard',
  'klanches',
  'desafios',
  'superset',
  'tenisproplayer',
  'campeonatos',
  'campeonatos-publico',
  'competicao',
  'atletas',
  'perfil',
  'ranking',
  'professor',
  'admin-students',
  'admin-professors',
  'admin-panel',
  'financeiro-admin',
  'championship-admin',
  'championship-creator',
]);

export function getPublicAppRoute(pathname: string, search = '', hostname = ''): PublicAppRoute {
  // 1. Verificar query parameters (ex: ?form=slug ou ?votacao=slug)
  if (search) {
    const params = new URLSearchParams(search);
    const formSlug = params.get('form') || params.get('votacao');
    if (formSlug) {
      return { type: 'form-slug', slug: formSlug.trim() };
    }
  }

  const [pathWithoutQuery] = pathname.split(/[?#]/);
  const normalized = pathWithoutQuery.replace(/^\/+|\/+$/g, '');
  const normalizedHost = hostname.toLowerCase();

  // 2. Verificar rotas diretas de formulário/votação (ex: /votacao/:slug ou /form/:slug)
  const formMatch = normalized.match(/^(?:votacao|form|forms|formulario)\/([a-zA-Z0-9_-]+)$/i);
  if (formMatch && formMatch[1]) {
    return { type: 'form-slug', slug: formMatch[1] };
  }

  // Se for subdomínio específico de campeonatos
  if (normalizedHost === 'camp.stcplay.com.br') {
    return { type: 'none' };
  }

  if (!normalized || normalized.includes('.')) {
    return { type: 'none' };
  }

  if (APP_PATHS.has(normalized)) {
    return { type: 'none' };
  }

  // Rotas de campeonatos públicos sem barra interna
  if (!normalized.includes('/')) {
    return { type: 'none' };
  }

  return { type: 'none' };
}

// Retrocompatibilidade
export function getPublicChampionshipRoute(pathname: string, hostname = ''): PublicAppRoute {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  return getPublicAppRoute(pathname, search, hostname);
}

export function selectPublicChampionship(championships: PublicChampionshipSummary[]) {
  const active = championships.find(c => c.status === 'active' || c.status === 'ongoing');
  const registrationOpen = championships.find(c => c.registration_open === true);
  const selected = active || registrationOpen || championships[0] || null;

  if (!selected) return null;

  return {
    id: selected.id,
    slug: selected.slug,
  };
}
