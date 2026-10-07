// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  codeMessage, composeNotification, documentLink, firstName, formatDue, maskPhone, plainTitle, publishMessage, reminderMessage, toWhatsappNumber,
} from '../../../supabase/functions/_shared/signatureMessages';
import { clientIp, createGeoResolver, geoFromProviderBody, isPublicIp } from '../../../supabase/functions/_shared/signatureGeo';

const DOC = '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ctx = { name: 'Ana Souza', title: 'Termo de uso', dueAt: '2026-10-20T21:00:00Z', documentId: DOC, appUrl: 'https://stcplay.com.br' };

describe('telefone → número do WhatsApp', () => {
  it('o cadastro guarda DDD + número; o envio leva o DDI 55', () => {
    expect(toWhatsappNumber('88999991234')).toBe('5588999991234');
    expect(toWhatsappNumber('(88) 99999-1234')).toBe('5588999991234');
    expect(toWhatsappNumber('+55 88 99999-1234')).toBe('5588999991234');
    expect(toWhatsappNumber('5588999991234')).toBe('5588999991234');
    expect(toWhatsappNumber('8832221234')).toBe('558832221234'); // fixo/antigo, 10 dígitos
  });
  it('o que não parece telefone não vira destino', () => {
    for (const v of [null, undefined, '', '123', 'abc', '8899999']) expect(toWhatsappNumber(v as string)).toBeNull();
  });
  it('máscara mostra o DDD e os 4 últimos dígitos, nunca o número inteiro', () => {
    expect(maskPhone('88999991234')).toBe('(88) •••••-1234');
    expect(maskPhone('88999991234')).not.toContain('99999');
    expect(maskPhone('')).toBe('');
  });
});

describe('texto', () => {
  it('primeiro nome; perfil sem nome (só número) não vira "Olá, 5585…"', () => {
    expect(firstName('Maria Souza')).toBe('Maria');
    expect(firstName('+5585988880002')).toBe('');
    expect(firstName(null)).toBe('');
  });
  it('título do admin não quebra a formatação do WhatsApp', () => {
    expect(plainTitle(' Termo *de* _uso_ `x` ~y~ \n  2026 ')).toBe('Termo de uso x y 2026');
  });
  it('prazo no fuso de Fortaleza (UTC-3), formato do Brasil', () => {
    expect(formatDue('2026-10-20T21:00:00Z')).toBe('20/10/2026 às 18:00');
    expect(formatDue('2026-10-21T03:05:00Z')).toBe('21/10/2026 às 00:05');
    expect(formatDue(null)).toBeNull();
    expect(formatDue('lixo')).toBeNull();
  });
  it('link é o atalho por hash, sem barra dupla', () => {
    expect(documentLink('https://stcplay.com.br', DOC)).toBe(`https://stcplay.com.br/#documentos/${DOC}`);
    expect(documentLink('https://stcplay.com.br/', DOC)).toBe(`https://stcplay.com.br/#documentos/${DOC}`);
    expect(documentLink('', DOC)).toBe(`https://stcplay.com.br/#documentos/${DOC}`);
  });
});

describe('aviso de publicação: link + passo a passo', () => {
  const m = publishMessage(ctx);
  it('traz o documento, o prazo, o link e os 4 passos', () => {
    expect(m).toContain('Olá, Ana!');
    expect(m).toContain('*Termo de uso*');
    expect(m).toContain('Prazo: 20/10/2026 às 18:00');
    expect(m).toContain(`https://stcplay.com.br/#documentos/${DOC}`);
    expect(m).toContain('Documentos e Assinaturas'); // onde achar a aba
    for (const passo of ['1️⃣', '2️⃣', '3️⃣', '4️⃣']) expect(m).toContain(passo);
    expect(m).toContain('Li e concordo');
    expect(m).toContain('Assinar digitalmente');
    expect(m).toContain('código de 6 dígitos');
  });
  it('avisa para não passar o código a ninguém', () => {
    expect(m).toMatch(/Não passe para ninguém/);
  });
  it('sem prazo não inventa prazo; sem nome não diz "undefined"', () => {
    const s = publishMessage({ ...ctx, dueAt: null, name: '' });
    expect(s).not.toContain('Prazo');
    expect(s.startsWith('Olá! 👋')).toBe(true);
    for (const x of [m, s]) expect(x).not.toMatch(/undefined|null|NaN/);
  });
  it('sócio novo recebe boas-vindas e o mesmo passo a passo', () => {
    const s = publishMessage(ctx, true);
    expect(s).toContain('Bem-vindo(a) ao STC');
    expect(s).toContain(`#documentos/${DOC}`);
  });
});

describe('lembretes', () => {
  it('3 dias antes: diz o prazo e repete o passo a passo e o link', () => {
    const m = reminderMessage({ ...ctx, slot: 'd-3@2026-10-20' });
    expect(m).toContain('Faltam 3 dias');
    expect(m).toContain('prazo: 20/10/2026 às 18:00');
    expect(m).toContain(`#documentos/${DOC}`);
    expect(m).toContain('4️⃣');
  });
  it('no dia do prazo: diz até que horas', () => {
    const m = reminderMessage({ ...ctx, slot: 'd0@2026-10-20' });
    expect(m).toContain('Hoje é o último dia');
    expect(m).toContain('até 18:00');
    expect(m).not.toContain('Faltam 3 dias');
  });
});

describe('o que a fila pode mandar', () => {
  it('cada tipo tem texto; tipo desconhecido não é enviado', () => {
    const base = { ...ctx, slot: '' };
    expect(composeNotification({ ...base, kind: 'publish' })).toContain('esperando a sua assinatura');
    expect(composeNotification({ ...base, kind: 'new_member' })).toContain('Bem-vindo(a)');
    expect(composeNotification({ ...base, kind: 'reminder', slot: 'd0@2026-10-20' })).toContain('último dia');
    expect(composeNotification({ ...base, kind: 'promo' })).toBeNull();
  });
});

describe('mensagem do código', () => {
  const m = codeMessage({ name: 'Ana', title: 'Termo *de* uso', code: '482913' });
  it('o código fica sozinho em uma linha (dá para tocar e copiar) e a validade é dita', () => {
    expect(m.split('\n')).toContain('*482913*');
    expect(m).toContain('Vale por 10 minutos');
    expect(m).toContain('Documento: Termo de uso');
  });
  it('manda não compartilhar', () => {
    expect(m).toContain('Nunca compartilhe');
  });
});

describe('IP do cliente', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it('prefere o que o Cloudflare escreve; depois x-real-ip; por fim o primeiro do x-forwarded-for', () => {
    expect(clientIp(h({ 'cf-connecting-ip': '203.0.113.7', 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '192.0.2.9' }))).toBe('203.0.113.7');
    expect(clientIp(h({ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '192.0.2.9' }))).toBe('198.51.100.1');
    expect(clientIp(h({ 'x-forwarded-for': '192.0.2.9, 10.0.0.1' }))).toBe('192.0.2.9');
    expect(clientIp(h({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });
  it('lixo no cabeçalho não vira IP', () => {
    expect(clientIp(h({}))).toBeNull();
    expect(clientIp(h({ 'cf-connecting-ip': '<script>' }))).toBeNull();
    expect(clientIp(h({ 'x-forwarded-for': "1.2.3.4'; drop table x;--" }))).toBeNull();
  });
});

describe('só IP público sai para consulta externa', () => {
  it.each(['10.1.2.3', '127.0.0.1', '192.168.0.9', '172.16.0.1', '172.31.255.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '999.1.1.1', '1.2.3'])(
    '%s é recusado', (ip) => expect(isPublicIp(ip)).toBe(false));
  it.each(['203.0.113.7', '8.8.8.8', '172.32.0.1', '2001:db8::1'])('%s é aceito', (ip) => expect(isPublicIp(ip)).toBe(true));
});

describe('resposta do serviço de localização', () => {
  it('entende os formatos comuns e ignora erro', () => {
    expect(geoFromProviderBody({ success: true, city: 'Fortaleza', region: 'Ceará', country: 'Brazil' })).toEqual({ city: 'Fortaleza', region: 'Ceará', country: 'Brazil' });
    expect(geoFromProviderBody({ city: 'Sobral', regionName: 'Ceará', country: 'Brazil' })).toEqual({ city: 'Sobral', region: 'Ceará', country: 'Brazil' });
    expect(geoFromProviderBody({ city: 'X', region_name: 'Y', country_name: 'Z' })).toEqual({ city: 'X', region: 'Y', country: 'Z' });
    expect(geoFromProviderBody({ success: false, message: 'limit' })).toBeNull();
    expect(geoFromProviderBody({ status: 'fail' })).toBeNull();
    expect(geoFromProviderBody({})).toBeNull();
    expect(geoFromProviderBody(null)).toBeNull();
    expect(geoFromProviderBody('x')).toBeNull();
  });
});

describe('consulta da cidade: complemento que nunca atrapalha', () => {
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  it('consulta o IP público no endereço configurado (com o IP codificado)', async () => {
    const f = ok({ city: 'Fortaleza', region: 'CE', country: 'BR' });
    const geo = createGeoResolver({ urlTemplate: 'https://geo.example/json/{ip}', fetcher: f as unknown as typeof fetch });
    expect(await geo('203.0.113.7')).toEqual({ city: 'Fortaleza', region: 'CE', country: 'BR' });
    expect((f.mock.calls[0] as unknown[])[0]).toBe('https://geo.example/json/203.0.113.7');
  });
  it('IP privado, vazio ou lixo nunca sai do servidor', async () => {
    const f = ok({ city: 'X' });
    const geo = createGeoResolver({ fetcher: f as unknown as typeof fetch });
    for (const ip of [null, '', '10.0.0.5', '127.0.0.1', 'abc']) expect(await geo(ip)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('"off", endereço sem HTTPS ou sem {ip} desliga a consulta', async () => {
    const f = ok({ city: 'X' });
    for (const urlTemplate of ['off', 'OFF', 'http://geo.example/{ip}', 'https://geo.example/fixo']) {
      expect(await createGeoResolver({ urlTemplate, fetcher: f as unknown as typeof fetch })('203.0.113.7')).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
  });
  it('serviço fora do ar, lento ou com erro vira null (a assinatura segue só com o IP)', async () => {
    const quebra = vi.fn(async () => { throw new Error('rede'); });
    expect(await createGeoResolver({ fetcher: quebra as unknown as typeof fetch })('203.0.113.7')).toBeNull();
    const http500 = vi.fn(async () => new Response('x', { status: 500 }));
    expect(await createGeoResolver({ fetcher: http500 as unknown as typeof fetch })('203.0.113.8')).toBeNull();
    const naoJson = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(await createGeoResolver({ fetcher: naoJson as unknown as typeof fetch })('203.0.113.9')).toBeNull();
  });
  it('repetir o IP não repete a consulta; falha só é lembrada por 1 minuto', async () => {
    let t = 0;
    const f = ok({ city: 'Fortaleza' });
    const geo = createGeoResolver({ fetcher: f as unknown as typeof fetch, now: () => t });
    await geo('203.0.113.7'); await geo('203.0.113.7');
    expect(f).toHaveBeenCalledTimes(1);

    let calls = 0;
    const falha = vi.fn(async () => { calls += 1; if (calls === 1) throw new Error('x'); return new Response(JSON.stringify({ city: 'Sobral' }), { status: 200 }); });
    const g2 = createGeoResolver({ fetcher: falha as unknown as typeof fetch, now: () => t });
    expect(await g2('203.0.113.50')).toBeNull();
    expect(await g2('203.0.113.50')).toBeNull(); // ainda lembrado
    t += 61_000;
    expect(await g2('203.0.113.50')).toEqual({ city: 'Sobral' });
  });
});
