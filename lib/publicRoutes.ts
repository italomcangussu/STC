export type PublicChampionshipRoute =
  | { type: 'list' }
  | { type: 'slug'; slug: string }
  | { type: 'none' };

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
  'resenha-open-admin',
]);

export function getPublicChampionshipRoute(pathname: string, hostname = ''): PublicChampionshipRoute {
  const [pathWithoutQuery] = pathname.split(/[?#]/);
  const normalized = pathWithoutQuery.replace(/^\/+|\/+$/g, '');
  const normalizedHost = hostname.toLowerCase();

  if (normalizedHost === 'camp.stcplay.com.br') {
    return { type: 'none' };
  }

  if (!normalized || normalized.includes('.') || normalized.includes('/')) {
    return { type: 'none' };
  }

  if (APP_PATHS.has(normalized)) {
    return { type: 'none' };
  }

  return { type: 'none' };
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
