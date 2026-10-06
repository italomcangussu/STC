import { describe, expect, it } from 'vitest';
import { isReadable, parseReceiptText, toStoredOcr } from '../../lib/finance/receiptText';

// Textos SINTÉTICOS no formato que bancos brasileiros costumam usar. A precisão em
// comprovantes reais depende do banco e da qualidade da foto: por isso a leitura é só sugestão.
const NUBANK_LIKE = `Comprovante de transferência
05 SET 2026 - 14:32:10
Valor
R$ 150,00
Tipo de transferência
Pix
Destino
Nome
Sobral Tênis Clube
CPF/CNPJ
**.***.***/0001-**
Instituição
Banco XYZ
Origem
Nome
Maria da Silva
ID da transação
E18236120202609051432sA1b2C3d4E5`;

const ITAU_LIKE = `Comprovante de Pix
Data da transferência: 05/09/2026
Valor: R$ 1.250,00
Favorecido: SOBRAL TENIS CLUBE
Autenticação: 7A3F-92B1-C0D4-11E8`;

const BOLETO_LIKE = `Comprovante de pagamento de boleto
Valor do documento: R$ 100,00
Juros/multa: R$ 3,00
Valor pago: R$ 103,00
Data do pagamento: 06/09/2026
Vencimento: 05/09/2026
Beneficiário: SOBRAL TENIS CLUBE
Protocolo: 123456789ABC`;

describe('leitura assistida do texto do comprovante (só sugere)', () => {
  it('estilo "valor numa linha, número na seguinte"', () => {
    const r = parseReceiptText(NUBANK_LIKE);
    expect(r.amountCents).toBe(15000);
    expect(r.confidence.amount).toBe('high');
    expect(r.paidOn).toBe('2026-09-05');
    expect(r.identifier).toBe('E18236120202609051432sA1b2C3d4E5');
    expect(r.confidence.identifier).toBe('high');
    // pega o DESTINO (favorecido), não a origem (pagador)
    expect(r.payee).toBe('Sobral Tênis Clube');
  });

  it('estilo "rótulo: valor" com milhar', () => {
    const r = parseReceiptText(ITAU_LIKE);
    expect(r).toMatchObject({ amountCents: 125000, paidOn: '2026-09-05', identifier: '7A3F-92B1-C0D4-11E8', payee: 'SOBRAL TENIS CLUBE' });
    expect(r.confidence).toMatchObject({ amount: 'high', date: 'high', identifier: 'low', payee: 'high' });
  });

  it('boleto: usa o valor PAGO (com juros), ignora linha de juros/multa e o vencimento', () => {
    const r = parseReceiptText(BOLETO_LIKE);
    expect(r.amountCents).toBe(10300);
    expect(r.paidOn).toBe('2026-09-06');
    expect(r.amountCandidates).toContain(10000);
    expect(r.amountCandidates).not.toContain(300);
    expect(r.dateCandidates).not.toContain('2026-09-05'); // vencimento não é data de pagamento
    expect(r.payee).toBe('SOBRAL TENIS CLUBE');
    expect(r.identifier).toBe('123456789ABC');
  });

  it('formatos de data: dd/mm/aaaa, ISO e por extenso; datas impossíveis são ignoradas', () => {
    expect(parseReceiptText('Pago em 5 de setembro de 2026').paidOn).toBe('2026-09-05');
    expect(parseReceiptText('Data: 2026-09-05').paidOn).toBe('2026-09-05');
    expect(parseReceiptText('Data: 31/02/2026').paidOn).toBeNull();
    expect(parseReceiptText('Realizada em 05.09.2026').paidOn).toBe('2026-09-05');
  });

  it('valores ambíguos: leva o primeiro, mas marca confiança baixa e lista os candidatos', () => {
    const r = parseReceiptText('Valor: R$ 100,00\nValor: R$ 120,00');
    expect(r.amountCents).toBe(10000);
    expect(r.confidence.amount).toBe('low');
    expect(r.amountCandidates).toEqual([10000, 12000]);
  });

  it('texto sem nada útil é ilegível — nada é inventado', () => {
    const r = parseReceiptText('Lorem ipsum dolor sit amet\nsem números relevantes');
    expect(r).toMatchObject({ amountCents: null, paidOn: null, identifier: null, payee: null });
    expect(isReadable(r)).toBe(false);
    expect(isReadable(parseReceiptText('Valor: R$ 10,00'))).toBe(true);
  });

  it('não extrai nem devolve CPF/CNPJ, dados do pagador ou o texto bruto', () => {
    const r = parseReceiptText(`Favorecido: Clube\nCPF: 123.456.789-00\nPagador: Maria da Silva\nValor: R$ 50,00\nSegredo bancário 9999`);
    const dump = JSON.stringify(r);
    expect(dump).not.toContain('123.456.789-00');
    expect(dump).not.toContain('Maria da Silva');
    expect(dump).not.toContain('Segredo');
    const stored = JSON.stringify(toStoredOcr(r, 'tesseract'));
    expect(stored).not.toMatch(/raw|text|123\.456/);
    expect(toStoredOcr(r, 'tesseract')).toMatchObject({ engine: 'tesseract', amount_cents: 5000 });
  });
});
