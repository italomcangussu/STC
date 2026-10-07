// IP do cliente e cidade aproximada, para o dossiê da assinatura. Puro (o `fetch` é injetado).
//
// A cidade é um COMPLEMENTO: o IP fica gravado de qualquer jeito e uma falha aqui (serviço fora do ar,
// sem rede, IP privado) nunca impede a assinatura — devolve `null` e o dossiê segue com o IP.
//
// Não usamos cabeçalhos de localização (`cf-ipcity`…): sem a regra de transformação ligada no
// Cloudflare eles não são preenchidos, e então um cliente poderia mandar o próprio valor e ele
// chegaria até aqui. O IP, esse sim, é escrito pelo Cloudflare (`cf-connecting-ip`).

export type Geo = { city?: string; region?: string; country?: string };

/** Consulta padrão (HTTPS, sem chave). Troque com `STC_GEOIP_URL` (use `{ip}` no lugar do IP) ou desligue com `off`. */
export const DEFAULT_GEOIP_URL = 'https://ipwho.is/{ip}';

const IP_SHAPE = /^[0-9a-fA-F:.]{3,45}$/;

/** IP do cliente como o servidor o viu: `cf-connecting-ip` → `x-real-ip` → primeiro de `x-forwarded-for`. */
export function clientIp(headers: Headers): string | null {
  const raw = headers.get('cf-connecting-ip') || headers.get('x-real-ip')
    || (headers.get('x-forwarded-for') ?? '').split(',')[0] || '';
  const ip = raw.trim();
  return IP_SHAPE.test(ip) ? ip : null;
}

/** Só IP público é consultado fora: endereço privado/local nunca sai do servidor. */
export function isPublicIp(ip: string): boolean {
  if (!IP_SHAPE.test(ip)) return false;
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return !(v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('::ffff:'));
  }
  const p = ip.split('.').map((x) => Number(x));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  return true;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined);

/** Aceita os formatos dos serviços comuns (ipwho.is, ipapi.co, ip-api.com, ipinfo.io). */
export function geoFromProviderBody(body: unknown): Geo | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.success === false || b.status === 'fail' || b.error) return null;
  const geo: Geo = {
    city: str(b.city),
    region: str(b.region) ?? str(b.regionName) ?? str(b.region_name),
    country: str(b.country) ?? str(b.country_name) ?? str(b.country_code),
  };
  return geo.city || geo.region || geo.country ? JSON.parse(JSON.stringify(geo)) : null;
}

export type GeoResolver = (ip: string | null) => Promise<Geo | null>;

export function createGeoResolver(opts: {
  urlTemplate?: string | null; fetcher?: typeof fetch; ttlMs?: number; timeoutMs?: number; now?: () => number; maxEntries?: number;
}): GeoResolver {
  const template = (opts.urlTemplate ?? '').trim() || DEFAULT_GEOIP_URL;
  if (template.toLowerCase() === 'off' || !template.startsWith('https://') || !template.includes('{ip}')) return async () => null;
  const fetcher = opts.fetcher ?? fetch;
  const ttl = opts.ttlMs ?? 10 * 60 * 1000;
  const timeout = opts.timeoutMs ?? 2500;
  const now = opts.now ?? Date.now;
  const max = opts.maxEntries ?? 200;
  // Sócio errando o código várias vezes não vira várias consultas externas.
  const cache = new Map<string, { until: number; geo: Geo | null }>();

  return async (ip) => {
    if (!ip || !isPublicIp(ip)) return null;
    const hit = cache.get(ip);
    if (hit && now() < hit.until) return hit.geo;
    let geo: Geo | null = null;
    try {
      const r = await fetcher(template.replace('{ip}', encodeURIComponent(ip)), { signal: AbortSignal.timeout(timeout) });
      if (r.ok) geo = geoFromProviderBody(await r.json().catch(() => null));
    } catch {
      geo = null;
    }
    if (cache.size >= max) cache.delete(cache.keys().next().value as string);
    // Falha (serviço fora, limite de uso) vale 1 minuto: não trava nem martela o serviço.
    cache.set(ip, { until: now() + (geo ? ttl : 60_000), geo });
    return geo;
  };
}
