// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveAllowedOrigin } from '../../supabase/functions/_shared/adminRequest';

// Valor real de STC_PUBLIC_ORIGIN: o celular na rede local abre o app por IP:3000 (porta do `npm run dev`),
// que não estava na lista e recebia ORIGIN_FORBIDDEN enquanto o desktop (localhost) funcionava.
const ENV = 'https://stcplay.com.br,https://www.stcplay.com.br,http://localhost:5173,http://localhost:3000,http://192.168.0.42:5173';

describe('resolveAllowedOrigin (CORS do painel de Conversas)', () => {
  it.each([
    'https://stcplay.com.br',
    'http://localhost:3000',
    'http://192.168.0.42:3000',
    'http://192.168.1.15:5173',
    'http://10.0.0.7:3000',
    'https://app.stcplay.com.br',
  ])('aceita %s', (origin) => {
    expect(resolveAllowedOrigin(origin, ENV)).toBe(origin);
  });

  it('aceita o Referer quando o navegador não manda Origin, devolvendo só a origem', () => {
    expect(resolveAllowedOrigin('http://192.168.0.42:3000/conversas?x=1', ENV)).toBe('http://192.168.0.42:3000');
  });

  it.each([
    'https://evil.example',
    'https://stcplay.com.br.evil.example',
    'https://evilstcplay.com.br',
    'http://192.169.0.1:3000',
    'http://8.8.8.8:3000',
  ])('recusa %s', (origin) => {
    expect(resolveAllowedOrigin(origin, ENV)).toBeNull();
  });

  it('recusa quando não há origem nem referer', () => {
    expect(resolveAllowedOrigin(null, ENV)).toBeNull();
  });
});
