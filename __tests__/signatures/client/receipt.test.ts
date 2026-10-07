import { beforeEach, describe, expect, it, vi } from 'vitest';

const result = vi.hoisted(() => ({ value: { data: null as unknown, error: null as unknown } }));
vi.mock('../../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve(result.value);
  return { supabase: { from: () => chain } };
});

import { buildReceipt, formatPhone, getSignatureDossier, maskPhone, receiptFileName, renderReceiptPdf, type SignatureDossier } from '../../../lib/signatures/receipt';
import { formatDateTimeSeconds } from '../../../lib/signatures/format';

const dossier = (over: Partial<SignatureDossier> = {}): SignatureDossier => ({
  id: '3f1d2c4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', document_id: 'd1', seq: 7, signed_at: '2026-10-07T15:32:08Z',
  document_title: 'Termo de Uso das Quadras', document_version: 2, document_sha256: 'a'.repeat(64),
  signer_name: 'Ana Souza', signer_phone: '5585999911234', signer_cpf: '52998224725',
  consent_text: 'Li o documento e concordo com os termos.', accepted_at: '2026-10-07T15:30:00Z',
  read_started_at: '2026-10-07T15:25:00Z', read_completed_at: '2026-10-07T15:29:30Z', read_seconds: 270, pages_seen: 6, pages_total: 6,
  code_sent_at: '2026-10-07T15:31:00Z', code_verified_at: '2026-10-07T15:32:07Z', code_attempts: 2, provider_message_id: 'W1',
  ip: '203.0.113.9', user_agent: 'Mozilla/5.0 (iPhone)', geo: { source: 'ip', city: 'Fortaleza', region: 'Ceará', country: 'Brasil' },
  device: { location: 'denied', platform: 'iOS', mode: 'pwa', screen: '390x844@3', language: 'pt-BR', timezone: 'America/Fortaleza' },
  evidence_hash: 'b'.repeat(64), prev_chain_hash: 'c'.repeat(64), chain_hash: 'd'.repeat(64), ...over,
});
const value = (m: ReturnType<typeof buildReceipt>, label: string) => m.sections.flatMap((s) => s.rows).find((r) => r[0] === label)?.[1];

describe('horário com segundos no fuso do clube', () => {
  it('converte UTC para Fortaleza e mostra os segundos', () => {
    expect(formatDateTimeSeconds('2026-10-07T15:32:08Z')).toBe('07/10/2026 às 12:32:08');
    expect(formatDateTimeSeconds('2026-10-07T02:30:05Z')).toBe('06/10/2026 às 23:30:05');
    expect(formatDateTimeSeconds(null)).toBe('');
  });
});

describe('comprovante do sócio × cópia do administrador', () => {
  it('o sócio vê CPF e telefone mascarados; o administrador, completos', () => {
    const socio = buildReceipt(dossier(), { full: false });
    const admin = buildReceipt(dossier(), { full: true });
    expect(value(socio, 'CPF (declarado pelo assinante)')).toBe('***.982.247-**');
    expect(value(socio, 'WhatsApp que recebeu o código')).toBe('(85) *****-1234');
    expect(JSON.stringify(socio)).not.toContain('52998224725');
    expect(JSON.stringify(socio)).not.toContain('99991');
    expect(value(admin, 'CPF (declarado pelo assinante)')).toBe('529.982.247-25');
    expect(value(admin, 'WhatsApp que recebeu o código')).toBe('(85) 99991-1234');
  });

  it('só a cópia mascarada avisa que o clube guarda os dados completos', () => {
    expect(buildReceipt(dossier(), { full: false }).notes.join(' ')).toMatch(/mascarados/);
    expect(buildReceipt(dossier(), { full: true }).notes.join(' ')).not.toMatch(/mascarados/);
  });

  it('CPF ausente ou malformado vira traço, nunca "undefined"', () => {
    const m = buildReceipt(dossier({ signer_cpf: '' }), { full: true });
    expect(value(m, 'CPF (declarado pelo assinante)')).toBe('—');
    expect(JSON.stringify(m)).not.toMatch(/undefined|null/);
  });
});

describe('conteúdo do comprovante', () => {
  it('cronologia na ordem da jornada, no horário do clube', () => {
    const m = buildReceipt(dossier(), { full: true });
    const cron = m.sections.find((s) => s.heading.startsWith('Cronologia'))!;
    expect(cron.rows.map((r) => r[0])).toEqual([
      'Início da leitura', 'Leitura concluída', 'Páginas vistas / tempo de leitura', 'Aceite ("li e concordo")',
      'Código enviado ao WhatsApp', 'Código confirmado', 'Assinatura registrada',
    ]);
    expect(value(m, 'Início da leitura')).toBe('07/10/2026 às 12:25:00');
    expect(value(m, 'Páginas vistas / tempo de leitura')).toBe('6 de 6 · 4 min 30 s');
    expect(value(m, 'Código confirmado')).toBe('07/10/2026 às 12:32:07 · 2 tentativas');
    expect(value(m, 'Assinatura registrada')).toBe('07/10/2026 às 12:32:08');
    expect(buildReceipt(dossier({ code_attempts: 1 }), { full: true }).sections.flat().length).toBeGreaterThan(0);
    expect(value(buildReceipt(dossier({ code_attempts: 1 }), { full: true }), 'Código confirmado')).toContain('1 tentativa');
  });

  it('tempo de leitura curto fica em segundos; ausente vira traço', () => {
    expect(value(buildReceipt(dossier({ read_seconds: 45 }), { full: true }), 'Páginas vistas / tempo de leitura')).toBe('6 de 6 · 45 s');
    const m = buildReceipt(dossier({ read_seconds: null, pages_seen: null, pages_total: null, read_started_at: null }), { full: true });
    expect(value(m, 'Páginas vistas / tempo de leitura')).toBe('—');
    expect(value(m, 'Início da leitura')).toBe('—');
  });

  it('localização: cidade pelo IP; GPS só quando existe; negada explica o porquê', () => {
    const ip = buildReceipt(dossier(), { full: true });
    expect(value(ip, 'Localização aproximada (pelo IP)')).toBe('Fortaleza, Ceará, Brasil');
    expect(value(ip, 'Localização do aparelho (GPS)')).toBe('não registrada — negada pelo sócio');

    const gps = buildReceipt(dossier({ geo: { source: 'gps', city: 'Fortaleza', lat: -3.731922, lng: -38.5267, accuracy_m: 12.4 }, device: { location: 'granted' } }), { full: true });
    expect(value(gps, 'Localização do aparelho (GPS)')).toBe('-3.731922, -38.526700 (precisão de 12 m)');

    const none = buildReceipt(dossier({ geo: {}, ip: null, device: {} }), { full: true });
    expect(value(none, 'Localização aproximada (pelo IP)')).toBe('—');
    expect(value(none, 'Endereço IP')).toBe('—');
    expect(value(none, 'Localização do aparelho (GPS)')).toBe('não registrada — sem informação');
  });

  it('integridade: hashes completos e início da cadeia quando é a 1ª assinatura', () => {
    const m = buildReceipt(dossier({ prev_chain_hash: null, seq: 1 }), { full: true });
    expect(value(m, 'Hash anterior da cadeia')).toBe('início da cadeia');
    expect(value(m, 'Hash da evidência (SHA-256)')).toBe('b'.repeat(64));
    expect(value(m, 'Hash desta assinatura na cadeia')).toBe('d'.repeat(64));
    expect(value(m, 'Impressão digital do arquivo (SHA-256)')).toBe('a'.repeat(64));
    // hashes são desenhados em fonte monoespaçada (3º item da linha)
    expect(m.sections.find((s) => s.heading === 'Integridade do registro')!.rows.filter((r) => r[2]).length).toBe(4);
  });

  it('diz o nível da assinatura e os limites (CPF declarado, leitura informada pelo aparelho)', () => {
    const notes = buildReceipt(dossier(), { full: true }).notes.join(' ');
    expect(notes).toMatch(/Lei 14\.063\/2020/);
    expect(notes).toMatch(/não é assinatura com certificado ICP-Brasil/i);
    expect(notes).toMatch(/declarou o próprio CPF/);
    expect(notes).toMatch(/informados pelo aparelho/);
  });

  it('só usa caracteres que a fonte padrão do PDF desenha (sem −, → ou •)', () => {
    const text = JSON.stringify(buildReceipt(dossier(), { full: false }));
    expect(text).not.toMatch(/[−→•]/);
  });
});

describe('nome do arquivo', () => {
  it('sem acento, minúsculo, com versão e número da assinatura', () => {
    expect(receiptFileName({ document_title: 'Autorização de Imagem — 2026!', document_version: 3, seq: 12 })).toBe('comprovante-assinatura-autorizacao-de-imagem-2026-v3-n12.pdf');
    expect(receiptFileName({ document_title: '???', document_version: 1, seq: 1 })).toBe('comprovante-assinatura-documento-v1-n1.pdf');
  });
});

describe('telefone', () => {
  it('formata com e sem DDI e não quebra com lixo', () => {
    expect(formatPhone('5585999911234')).toBe('(85) 99991-1234');
    expect(formatPhone('85999911234')).toBe('(85) 99991-1234');
    expect(formatPhone('8532221234')).toBe('(85) 3222-1234');
    expect(formatPhone('123')).toBe('123');
    expect(maskPhone('123')).toBe('—');
  });
});

describe('PDF gerado (jsPDF real)', () => {
  const text = async (blob: Blob) => new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));

  it('é um PDF de verdade, com o nome e os hashes dentro', async () => {
    const blob = await renderReceiptPdf(buildReceipt(dossier(), { full: true }));
    expect(blob.type).toBe('application/pdf');
    const raw = await text(blob);
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain('Ana Souza');
    expect(raw).toContain('b'.repeat(64));
    expect(raw).toContain('529.982.247-25');
  });

  it('a cópia do sócio NÃO carrega o CPF completo nem o telefone no arquivo', async () => {
    const raw = await text(await renderReceiptPdf(buildReceipt(dossier(), { full: false })));
    expect(raw).not.toContain('529.982.247-25');
    expect(raw).not.toContain('52998224725');
    expect(raw).not.toContain('99991-1234');
    expect(raw).toContain('***.982.247-**');
  });

  it('muito conteúdo continua legível: quebra em várias páginas e numera todas', async () => {
    const big = buildReceipt(dossier({ user_agent: 'Mozilla/5.0 '.repeat(400), consent_text: 'Concordo. '.repeat(500) }), { full: true });
    const raw = await text(await renderReceiptPdf(big));
    const pages = (raw.match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(1);
    expect(raw).toContain(`página ${pages} de ${pages}`);
  });
});

describe('getSignatureDossier', () => {
  beforeEach(() => { result.value = { data: null, error: null }; });
  it('devolve a linha; sem linha (RLS ou id errado) vira erro, não comprovante vazio', async () => {
    result.value = { data: dossier(), error: null };
    expect((await getSignatureDossier('x')).seq).toBe(7);
    result.value = { data: null, error: null };
    await expect(getSignatureDossier('x')).rejects.toThrow('SIG_NOT_FOUND');
    result.value = { data: null, error: { message: 'boom' } };
    await expect(getSignatureDossier('x')).rejects.toMatchObject({ message: 'boom' });
  });
});
