export type PublicChampionshipRoute =
  | { type: 'list' }
  | { type: 'slug'; slug: string }
  | { type: 'none' };

const PUBLIC_CHAMPIONSHIPS_PATH = 'campeonatos-publico';

const APP_PATHS = new Set([
  'agenda',
  'dashboard',
  'klanches',
  'desafios',
  'superset',
  'tenisproplayer',
  'campeonatos',
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

export function getPublicChampionshipRoute(pathname: string): PublicChampionshipRoute {
  const [pathWithoutQuery] = pathname.split(/[?#]/);
  const normalized = pathWithoutQuery.replace(/^\/+|\/+$/g, '');

  if (!normalized || normalized.includes('.') || normalized.includes('/')) {
    return { type: 'none' };
  }

  if (normalized === PUBLIC_CHAMPIONSHIPS_PATH) {
    return { type: 'list' };
  }

  if (APP_PATHS.has(normalized)) {
    return { type: 'none' };
  }

  return { type: 'slug', slug: normalized };
}
