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

const CHAMPIONSHIPS_HOST = 'camp.stcplay.com.br';

function normalizePath(pathname: string): string {
  const [pathWithoutQuery] = pathname.split(/[?#]/);
  return pathWithoutQuery.replace(/^\/+|\/+$/g, '');
}

/** Formulário/votação: ?form=slug, ?votacao=slug, /votacao/:slug ou /form/:slug. */
function formSlugFrom(path: string, search: string): string | null {
  const params = new URLSearchParams(search);
  const fromQuery = params.get('form') || params.get('votacao');
  if (fromQuery) return fromQuery.trim();
  const fromPath = path.match(/^(?:votacao|form|forms|formulario)\/([a-zA-Z0-9_-]+)$/i);
  return fromPath ? fromPath[1] : null;
}

/**
 * Link público do campeonato: /campeonato/<slug> abre a página de quem não é sócio;
 * /campeonato sozinho abre o campeonato em andamento. O prefixo próprio evita
 * disputar caminho com as telas do app (o slug solto na raiz foi aposentado).
 */
function championshipRouteFrom(path: string): PublicAppRoute {
  const match = path.match(/^campeonato(?:\/([a-z0-9_-]+))?$/i);
  if (!match) return { type: 'none' };
  return match[1] ? { type: 'slug', slug: match[1].toLowerCase() } : { type: 'list' };
}

export function getPublicAppRoute(pathname: string, search = '', hostname = ''): PublicAppRoute {
  const path = normalizePath(pathname);
  const formSlug = formSlugFrom(path, search);
  if (formSlug) return { type: 'form-slug', slug: formSlug };
  if (hostname.toLowerCase() === CHAMPIONSHIPS_HOST) return { type: 'none' };
  return championshipRouteFrom(path);
}

/** Caminho do link público de um campeonato (o que o admin compartilha). */
export function publicChampionshipPath(slug: string): string {
  return `/campeonato/${slug}`;
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
