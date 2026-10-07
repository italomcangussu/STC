import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectDevice } from '../../../lib/signatures/device';
import { getLocationPermission, locationHint, requestSigningLocation, type LocationStatus } from '../../../lib/signatures/location';

type OnOk = (p: GeolocationPosition) => void;
type OnErr = (e: GeolocationPositionError) => void;
const pos = (latitude: number, longitude: number, accuracy?: number) => ({ coords: { latitude, longitude, accuracy } }) as unknown as GeolocationPosition;
const err = (code: number) => ({ code }) as GeolocationPositionError;
const geo = (impl: (ok: OnOk, fail: OnErr, opts?: PositionOptions) => void) => ({ getCurrentPosition: vi.fn(impl) });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('pedido de localização do sistema', () => {
  it('permitida: devolve a posição arredondada e abre o pedido UMA vez, com GPS e prazo', async () => {
    const g = geo((ok) => ok(pos(-3.731922222, -38.526699999, 18.26)));
    const r = await requestSigningLocation({ geolocation: g });
    expect(r).toEqual({ status: 'granted', position: { lat: -3.731922, lng: -38.5267, accuracy_m: 18.3 } });
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(g.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 });
  });

  it('sem precisão informada, a posição vai sem accuracy_m', async () => {
    const r = await requestSigningLocation({ geolocation: geo((ok) => ok(pos(-3.7, -38.5))) });
    expect(r).toEqual({ status: 'granted', position: { lat: -3.7, lng: -38.5 } });
  });

  it.each([[1, 'denied'], [2, 'unavailable'], [3, 'timeout'], [99, 'unavailable']] as [number, LocationStatus][])(
    'erro %i do aparelho vira "%s" (não lança)', async (code, status) => {
      expect(await requestSigningLocation({ geolocation: geo((_ok, fail) => fail(err(code))) })).toEqual({ status });
    });

  it('aparelho sem o recurso ou com ele quebrado: "unsupported", sem lançar', async () => {
    expect(await requestSigningLocation({ geolocation: null })).toEqual({ status: 'unsupported' });
    expect(await requestSigningLocation({ geolocation: {} as never })).toEqual({ status: 'unsupported' });
    expect(await requestSigningLocation({ geolocation: geo(() => { throw new Error('boom'); }) })).toEqual({ status: 'unsupported' });
  });

  it('coordenada absurda ou não numérica não vira localização', async () => {
    for (const p of [pos(91, 0), pos(0, 181), pos(NaN, 0), pos('1' as never, 2), { coords: undefined } as never]) {
      expect(await requestSigningLocation({ geolocation: geo((ok) => ok(p)) })).toEqual({ status: 'unavailable' });
    }
  });

  it('se o navegador nunca responder o pedido, a rede de segurança libera o fluxo (não trava a assinatura)', async () => {
    vi.useFakeTimers();
    const g = geo(() => { /* o sócio deixou o pedido aberto e o navegador não chamou de volta */ });
    const pendente = requestSigningLocation({ geolocation: g, guardMs: 45_000 });
    await vi.advanceTimersByTimeAsync(44_999);
    let resolvido = false; void pendente.then(() => { resolvido = true; });
    await Promise.resolve();
    expect(resolvido).toBe(false); // ainda dá tempo de o sócio responder
    await vi.advanceTimersByTimeAsync(2);
    expect(await pendente).toEqual({ status: 'timeout' });
  });

  it('resposta tardia depois da rede de segurança é ignorada', async () => {
    vi.useFakeTimers();
    let ok!: OnOk;
    const g = geo((o) => { ok = o; });
    const p = requestSigningLocation({ geolocation: g, guardMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toEqual({ status: 'timeout' });
    expect(() => ok(pos(-3, -38))).not.toThrow();
  });

  it('usa navigator.geolocation por padrão', async () => {
    const g = geo((ok) => ok(pos(-3.7, -38.5)));
    vi.stubGlobal('navigator', { ...navigator, geolocation: g });
    expect((await requestSigningLocation()).status).toBe('granted');
    expect(g.getCurrentPosition).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe('estado da permissão (sem abrir o pedido)', () => {
  const withPermissions = (permissions: unknown) => vi.stubGlobal('navigator', { ...navigator, permissions });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['granted', 'prompt', 'denied'])('repassa "%s"', async (state) => {
    withPermissions({ query: vi.fn(async () => ({ state })) });
    expect(await getLocationPermission()).toBe(state);
  });
  it('sem a API de permissões, ou com erro, ou estado estranho: "unknown"', async () => {
    withPermissions(undefined);
    expect(await getLocationPermission()).toBe('unknown');
    withPermissions({ query: vi.fn(async () => { throw new TypeError('x'); }) });
    expect(await getLocationPermission()).toBe('unknown');
    withPermissions({ query: vi.fn(async () => ({ state: 'novo' })) });
    expect(await getLocationPermission()).toBe('unknown');
  });
});

describe('avisos na tela', () => {
  it('só há aviso quando o GPS não veio, e todo aviso diz que a assinatura segue', () => {
    expect(locationHint('granted')).toBeNull();
    for (const s of ['denied', 'timeout', 'unavailable', 'unsupported'] as const) expect(locationHint(s)).toContain('segue só com o IP');
    expect(locationHint('denied')).toContain('ajustes do celular');
  });
});

describe('dados do aparelho para o dossiê', () => {
  it('leva o resultado do pedido de localização e só strings curtas', () => {
    const d = collectDevice('denied');
    expect(d.location).toBe('denied');
    for (const [k, v] of Object.entries(d)) { expect(typeof v, k).toBe('string'); expect(v.length, k).toBeLessThanOrEqual(80); }
    expect(JSON.stringify(d).length).toBeLessThan(500); // o banco aceita até 2000
    expect(d.timezone).toBeTruthy();
  });
});
