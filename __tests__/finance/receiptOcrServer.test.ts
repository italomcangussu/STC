// @vitest-environment node
/**
 * Leitura de comprovante no servidor (WhatsApp → baixa automática de pendência). A baixa automática só acontece
 * com confiança "high" em valor e data, então estes casos protegem contra "high" indevido.
 */
import { describe, expect, it } from 'vitest';
import { parseReceiptText } from '../../supabase/functions/_shared/financeReceiptOcr';

const PIX = `Comprovante de transferência
Pix enviado
Valor
R$ 150,00
Data da transferência
07/10/2026 - 10:42
Favorecido
Sobral Tênis Clube
CNPJ 52.393.541/0001-20
ID da transação E12345678202610071042abcdefghijk`;

describe('OCR de comprovante no servidor', () => {
  it('PIX típico: valor, data, favorecido e E2E com confiança alta', () => {
    const r = parseReceiptText(PIX) as any;
    expect(r).toMatchObject({ amount_cents: 15000, paid_on: '2026-10-07', payee: 'Sobral Tênis Clube' });
    expect(r.identifier).toMatch(/^E12345678/);
    expect(r.confidence).toEqual({ amount: 'high', date: 'high', identifier: 'high', payee: 'high' });
  });

  it('tarifa, saldo e juros não viram o valor pago', () => {
    const r = parseReceiptText(`Valor pago\nR$ 80,00\nTarifa R$ 2,50\nSaldo disponível R$ 1.234,56\nData do pagamento 01/10/2026`) as any;
    expect(r.amount_cents).toBe(8000);
    expect(r.confidence.amount).toBe('high');
  });

  it('dois valores "principais" diferentes: confiança baixa (vai para revisão)', () => {
    const r = parseReceiptText(`Valor total R$ 100,00\nValor total R$ 120,00\nPago em 01/10/2026`) as any;
    expect(r.confidence.amount).toBe('low');
  });

  it('só valor solto, sem rótulo: confiança baixa', () => {
    const r = parseReceiptText(`R$ 50,00\n01/10/2026`) as any;
    expect(r.amount_cents).toBe(5000);
    expect(r.confidence.amount).toBe('low');
    expect(r.confidence.date).toBe('low');
  });

  it('data de vencimento/agendamento não é data de pagamento', () => {
    const r = parseReceiptText(`Valor do pagamento R$ 30,00\nVencimento 15/10/2026\nAgendado para 15/10/2026`) as any;
    expect(r.paid_on).toBeNull();
    expect(r.confidence.date).toBe('none');
  });

  it('data impossível é descartada; mês por extenso é entendido', () => {
    expect((parseReceiptText(`Valor pago R$ 10,00\nData 31/02/2026`) as any).paid_on).toBeNull();
    expect((parseReceiptText(`Valor pago R$ 10,00\nRealizado em 7 de outubro de 2026`) as any).paid_on).toBe('2026-10-07');
  });

  it('favorecido com CPF/CNPJ/banco no lugar do nome não é aceito', () => {
    expect((parseReceiptText(`Favorecido: 123.456.789-00\nValor pago R$ 10,00`) as any).payee).toBeNull();
    expect((parseReceiptText(`Recebedor\nBanco do Brasil\nValor pago R$ 10,00`) as any).payee).toBeNull();
  });

  it('o resultado não carrega o texto bruto', () => {
    const r = parseReceiptText(PIX);
    expect(Object.keys(r).sort()).toEqual(['amount_cents', 'confidence', 'identifier', 'paid_on', 'payee']);
    expect(JSON.stringify(r)).not.toContain('Comprovante de transferência');
  });

  it('comprovante do Nubank (duas colunas): rótulo "Nome" some do favorecido e a data com hora vale', () => {
    const r = parseReceiptText(`Comprovante de
transferência
07 OUT 2026 - 16:11:33
Valor R$ 200,00
Tipo de transferência Pix
Destino
Nome Sobral Tenis Clube
CNPJ 52393541000120
Instituição CORA SCFI
Origem
Nome Diego Memória Braga Paiva
ID da transação:
E18236120202610071911s058335b68b`) as any;
    expect(r).toMatchObject({ amount_cents: 20000, paid_on: '2026-10-07', payee: 'Sobral Tenis Clube', identifier: 'E18236120202610071911s058335b68b' });
    expect(r.confidence).toEqual({ amount: 'high', date: 'high', identifier: 'high', payee: 'high' });
  });

  it('o favorecido é o do Destino, nunca o da Origem', () => {
    const r = parseReceiptText(`Origem\nNome Fulano de Tal\nDestino\nNome Sobral Tenis Clube`) as any;
    expect(r.payee).toBe('Sobral Tenis Clube');
  });
});
