// Localização do aparelho no momento de assinar.
//
// Chamar `requestSigningLocation()` abre a tela do SISTEMA (iOS/Android/navegador) que pede permissão
// de localização, se o sócio ainda não decidiu. Quem chama é o clique em "Assinar digitalmente"
// (via `requestSignatureCode`): a permissão pedida dentro do fluxo, com o contexto na tela, é a que o
// sócio entende e aceita. O GPS é um complemento do dossiê (o IP é gravado sempre) e NUNCA bloqueia:
// negar, falhar ou demorar só significa que o comprovante registra o local pelo IP.
//
// Navegadores só mostram o pedido uma vez; depois de "Não permitir", o app não consegue pedir de novo
// (só o sócio, nos ajustes do aparelho). `getLocationPermission` existe para a tela avisar isso.

export type LocationStatus = 'granted' | 'denied' | 'unavailable' | 'timeout' | 'unsupported';
export type SigningPosition = { lat: number; lng: number; accuracy_m?: number };
export type LocationResult =
  | { status: 'granted'; position: SigningPosition }
  | { status: Exclude<LocationStatus, 'granted'> };

/** Texto para a tela, antes/ao lado do botão: por que pedimos e que é opcional. */
export const LOCATION_NOTICE =
  'Vamos pedir a sua localização só para registrar, no comprovante, onde a assinatura foi feita. '
  + 'É opcional: se você não permitir, a assinatura segue normalmente e o local é registrado pelo IP.';

/** Frase curta sobre o resultado (mostrada depois do pedido, sem travar nada). */
export function locationHint(status: LocationStatus): string | null {
  switch (status) {
    case 'granted': return null;
    case 'denied': return 'Localização não permitida: a assinatura segue só com o IP. Para registrar o local, libere a localização do STC nos ajustes do celular.';
    case 'timeout': return 'Não deu para obter a localização a tempo: a assinatura segue só com o IP.';
    case 'unavailable': return 'Localização indisponível neste aparelho agora: a assinatura segue só com o IP.';
    case 'unsupported': return 'Este aparelho ou navegador não informa a localização: a assinatura segue só com o IP.';
  }
}

type GeoLike = Pick<Geolocation, 'getCurrentPosition'>;

export type LocationOptions = {
  /** Injeção para teste; por padrão `navigator.geolocation`. `null` = aparelho sem o recurso. */
  geolocation?: GeoLike | null;
  /** Limite do GPS depois que a permissão existe (o navegador não conta o tempo do pedido). */
  timeoutMs?: number;
  /** Rede de segurança: alguns navegadores nunca chamam de volta se o pedido ficar sem resposta. */
  guardMs?: number;
};

const round = (n: number, places: number) => Number(n.toFixed(places));

function fromPosition(p: GeolocationPosition): LocationResult {
  const { latitude, longitude, accuracy } = p?.coords ?? ({} as GeolocationCoordinates);
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { status: 'unavailable' };
  }
  const position: SigningPosition = { lat: round(latitude, 6), lng: round(longitude, 6) };
  if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0) position.accuracy_m = round(accuracy, 1);
  return { status: 'granted', position };
}

/** Nunca lança e sempre resolve: o chamador só decide o que mostrar. */
export function requestSigningLocation(options: LocationOptions = {}): Promise<LocationResult> {
  return new Promise((resolve) => {
    const geo = options.geolocation === undefined
      ? (typeof navigator !== 'undefined' ? navigator.geolocation : undefined)
      : options.geolocation;
    if (!geo || typeof geo.getCurrentPosition !== 'function') { resolve({ status: 'unsupported' }); return; }

    let settled = false;
    let guard: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: LocationResult) => {
      if (settled) return;
      settled = true;
      if (guard) clearTimeout(guard);
      resolve(r);
    };
    // Tempo para o sócio ler e responder o pedido do sistema, com folga.
    guard = setTimeout(() => finish({ status: 'timeout' }), options.guardMs ?? 45_000);

    try {
      geo.getCurrentPosition(
        (p) => finish(fromPosition(p)),
        (e) => finish({ status: e?.code === 1 ? 'denied' : e?.code === 3 ? 'timeout' : 'unavailable' }),
        { enableHighAccuracy: true, timeout: options.timeoutMs ?? 12_000, maximumAge: 15_000 },
      );
    } catch {
      finish({ status: 'unsupported' });
    }
  });
}

export type LocationPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/** Estado atual da permissão, sem abrir o pedido. `unknown` onde o navegador não informa (ex.: iOS antigo). */
export async function getLocationPermission(): Promise<LocationPermission> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    const s = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return s.state === 'granted' || s.state === 'prompt' || s.state === 'denied' ? s.state : 'unknown';
  } catch {
    return 'unknown';
  }
}
