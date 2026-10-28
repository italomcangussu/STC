// @vitest-environment node
/**
 * Comprovantes do torneio que o João não leu (28/10), com o texto que o pdfjs tira deles:
 *  · Mercado Pago (Francielton, Gustavo): valor sem centavos ("R$ 130"), data por extenso ("28/outubro/2026")
 *    e favorecido sem rótulo, só o bloco "Origem e destino";
 *  · Banco do Brasil (Marcelo): favorecido no rótulo "PAGO PARA:".
 */
import { describe, expect, it } from 'vitest';
import { columnFallback, parseReceiptText } from '../../supabase/functions/_shared/financeReceiptOcr';

const MERCADO_PAGO = ['Comprovante de Pix', '', '28/outubro/2026 às 10:40:23.', '', 'R$ 130', '', 'Origem e destino', '', 'Fulano de Tal', '',
  'Mercado Pago', 'CPF: ***.111.222-**', '', 'Sobral Tenis Clube', '', 'CORA SOCIEDADE DE CRÉDITO DIRETO S.A.', 'CNPJ: 52.393.541/0001-20',
  'N.° transação do Mercado Pago', '', '186496627418', '', 'ID de transação Pix', '', 'E10573521202610281340nnS4yjlATk3'].join('\n');

const BANCO_DO_BRASIL = ['Comprovante Pix', 'CLIENTE: FULANO DE TAL', 'ID:', ' ', 'E0000000020261028122921509550721', 'VALOR:', ' ', 'R$130,00',
  'DATA:', ' ', '28/10/2026 - 09:29:43', '------------------------------------------------', 'PAGO PARA:', ' ', 'Sobral Tenis Clube',
  'CNPJ: 52.393.541/0001-20', 'CHAVE PIX: 52393541000120', 'INSTITUICAO: 37880206 CORA SCFI'].join('\n');

describe('Mercado Pago', () => {
  const r = parseReceiptText(MERCADO_PAGO) as any;
  it('lê o valor sem centavos', () => expect(r.amount_cents).toBe(13000));
  it('lê a data por extenso com barras', () => expect(r.paid_on).toBe('2026-10-28'));
  it('acha o CNPJ do clube mesmo sem rótulo de favorecido', () => expect(r.payee_document).toBe('52393541000120'));
});

describe('Banco do Brasil', () => {
  const r = parseReceiptText(BANCO_DO_BRASIL) as any;
  it('"PAGO PARA:" é o favorecido', () => expect(r.payee).toBe('Sobral Tenis Clube'));
  it('o CNPJ do favorecido sai do bloco dele', () => expect(r.payee_document).toBe('52393541000120'));
  it('o valor segue certo', () => expect(r.amount_cents).toBe(13000));
});

describe('sem favorecido claro, não inventa CNPJ', () => {
  it('dois CNPJs diferentes sem rótulo: nenhum', () => {
    const r = parseReceiptText(['R$ 50,00', 'CNPJ: 11.222.333/0001-81', 'CNPJ: 52.393.541/0001-20'].join('\n')) as any;
    expect(r.payee_document).toBeNull();
  });
  it('"R$ 130,00" não vira R$ 130 duas vezes nem R$ 13', () => {
    expect((parseReceiptText('Valor: R$ 130,00') as any).amount_cents).toBe(13000);
    expect((parseReceiptText('Total R$ 1.234,56') as any).amount_cents).toBe(123456);
  });
});

describe('foto em que a leitura automática pula o valor grande', () => {
  const SEM_VALOR = ['Comprovante de Pix', '28/outubro/2026 às 10:40:23.', 'Origem e destino', 'CNPJ: 52.393.541/0001-20'].join('\n');
  it('relê em coluna única e acha o "R$130"', async () => {
    const t = await columnFallback(SEM_VALOR, async () => 'R$130\nFaça um Pix de\nR$50 para Ana');
    expect((parseReceiptText(t) as any).amount_cents).toBe(13000);
  });
  it('com valor já lido, não relê', async () => {
    let releu = false;
    await columnFallback('Valor: R$ 130,00', async () => { releu = true; return ''; });
    expect(releu).toBe(false);
  });
  it('a releitura falhou: fica o texto que já tinha', async () => {
    expect(await columnFallback(SEM_VALOR, async () => { throw new Error('x'); })).toBe(SEM_VALOR);
  });
  it('anúncio "R$50 para Ana" não é valor', () => {
    expect((parseReceiptText('Faça um Pix de\nR$50 para Ana') as any).amount_cents).toBeNull();
  });
});
