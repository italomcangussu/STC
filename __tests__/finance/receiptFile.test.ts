import { describe, expect, it } from 'vitest';
import { RECEIPT_MAX_BYTES, receiptStoragePath, safeReceiptFileName, sha256Hex, sniffReceiptType, validateReceiptFile } from '../../lib/finance/receiptFile';

const bytes = (...b: number[]) => Uint8Array.from([...b, ...new Array(Math.max(0, 16 - b.length)).fill(0)]);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
const HEIC = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00);

describe('validação do arquivo do comprovante (tipo, tamanho e conteúdo)', () => {
  it('reconhece o tipo pelos bytes, não pela extensão', () => {
    expect(sniffReceiptType(PDF)).toBe('application/pdf');
    expect(sniffReceiptType(PNG)).toBe('image/png');
    expect(sniffReceiptType(JPG)).toBe('image/jpeg');
    expect(sniffReceiptType(WEBP)).toBe('image/webp');
    expect(sniffReceiptType(HEIC)).toBe('image/heic');
    expect(sniffReceiptType(EXE)).toBeNull();
  });

  it('aceita arquivos válidos', () => {
    expect(validateReceiptFile({ name: 'a.pdf', type: 'application/pdf', size: 1000 }, PDF)).toEqual({ ok: true, type: 'application/pdf' });
    expect(validateReceiptFile({ name: 'foto.jpg', type: 'image/jpeg', size: 4_000_000 }, JPG)).toEqual({ ok: true, type: 'image/jpeg' });
    // alguns celulares não informam o tipo
    expect(validateReceiptFile({ name: 'foto', type: '', size: 1000 }, PNG)).toEqual({ ok: true, type: 'image/png' });
    expect(validateReceiptFile({ name: 'foto', type: 'application/octet-stream', size: 1000 }, HEIC)).toEqual({ ok: true, type: 'image/heic' });
  });

  it('recusa vazio, grande demais, formato estranho e conteúdo que mente sobre o tipo', () => {
    expect(validateReceiptFile({ name: 'a.png', type: 'image/png', size: 0 }, PNG).ok).toBe(false);
    const big = validateReceiptFile({ name: 'a.png', type: 'image/png', size: RECEIPT_MAX_BYTES + 1 }, PNG);
    expect(big).toMatchObject({ ok: false });
    expect(validateReceiptFile({ name: 'a.png', type: 'image/png', size: RECEIPT_MAX_BYTES }, PNG).ok).toBe(true);
    expect(validateReceiptFile({ name: 'virus.png', type: 'image/png', size: 1000 }, EXE)).toMatchObject({ ok: false });
    expect(validateReceiptFile({ name: 'x.pdf', type: 'application/pdf', size: 1000 }, PNG)).toMatchObject({ ok: false, reason: expect.stringContaining('não corresponde') });
    expect(validateReceiptFile({ name: 'x.zip', type: 'application/zip', size: 1000 }, PNG)).toMatchObject({ ok: false });
  });

  it('nome seguro: sem caminho, acento ou caracteres especiais; extensão do tipo real', () => {
    expect(safeReceiptFileName('Comprovante Pix (Ação).PNG', 'image/png')).toBe('Comprovante-Pix-Acao.png');
    expect(safeReceiptFileName('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf');
    expect(safeReceiptFileName('../../etc/passwd', 'application/pdf')).not.toContain('/');
    expect(safeReceiptFileName('', 'image/jpeg')).toBe('comprovante.jpg');
    expect(safeReceiptFileName('a'.repeat(200) + '.png', 'image/png').length).toBeLessThanOrEqual(64);
  });

  it('sha256 estável (detecta o mesmo arquivo reenviado)', async () => {
    const a = await sha256Hex(new TextEncoder().encode('abc'));
    expect(a).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(new TextEncoder().encode('abd'))).not.toBe(a);
  });

  it('caminho no bucket: <uid>/<envio>/<arquivo>', () => {
    expect(receiptStoragePath('u', 's', 'f.png')).toBe('u/s/f.png');
  });
});
