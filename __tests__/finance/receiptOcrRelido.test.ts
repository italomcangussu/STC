// @vitest-environment node
/**
 * Caso Bruno (28/10), o mesmo Pix de R$ 130 em PDF e em imagem:
 *  · PDF com títulos em negrito: o texto vem com "Recebedor" repetido e o favorecido saía "Recebedor";
 *  · imagem: o Tesseract leu "R$ 180,00" na página inteira (confiança 67); relendo só a linha do valor, "130,00" (94).
 */
import { describe, expect, it } from 'vitest';
import { parseReceiptText, refineMoneyLines } from '../../supabase/functions/_shared/financeReceiptOcr';

const PDF_NEGRITO = ['Comprovante de Pix', 'Comprovante de Pix', 'Pix enviado', 'Pix enviado', '', '28/10/2026, 09:11:36', 'Valor', ' ', 'R$ 130,00', '',
  'Recebedor', 'Recebedor', 'Recebedor', 'Recebedor', '', 'Nome', ' ', 'Sobral Tenis Clube', 'CNPJ', ' ', '52.393.541/0001-20', 'Instituição', ' ', 'CORA SCD S.A.', '',
  'Pagador', 'Pagador', 'Pagador', '', 'Nome', ' ', 'Fulano de Tal', 'CPF', ' ', '***.111.222-**'].join('\n');

describe('PDF com títulos repetidos', () => {
  it('o favorecido é o nome do clube, não a palavra "Recebedor"', () => {
    const r = parseReceiptText(PDF_NEGRITO) as any;
    expect(r.payee).toBe('Sobral Tenis Clube');
    expect(r.payee_document).toBe('52393541000120');
    expect(r.amount_cents).toBe(13000);
  });
});

type Line = { text: string; words: { text: string; confidence: number }[]; bbox: { x0: number; y0: number; x1: number; y1: number } };
const linha = (text: string, conf: number, y = 520): Line => ({ text: `${text}\n`, bbox: { x0: 40, y0: y, x1: 700, y1: y + 30 },
  words: text.split(' ').map((w) => ({ text: w, confidence: /\d,\d{2}/.test(w) ? conf : 96 })) });
const PAGINA = 'Pix enviado\n28/10/2026, 09:11:36\nValor R$ 180,00\nRecebedor\nNome Sobral Tenis Clube\n';

describe('valor relido só na linha dele', () => {
  it('a releitura mais confiável troca o valor (180 → 130)', async () => {
    const pedidos: unknown[] = [];
    const texto = await refineMoneyLines(PAGINA, [linha('Valor R$ 180,00', 67)], async (r) => { pedidos.push(r); return [linha('Valor R$ 130,00', 94)]; });
    expect(pedidos).toHaveLength(1);
    expect((parseReceiptText(texto) as any).amount_cents).toBe(13000);
  });

  it('releitura menos confiável não muda nada', async () => {
    const texto = await refineMoneyLines(PAGINA, [linha('Valor R$ 180,00', 95)], async () => [linha('Valor R$ 130,00', 60)]);
    expect((parseReceiptText(texto) as any).amount_cents).toBe(18000);
  });

  it('linha sem dinheiro não é relida, e no máximo 4 linhas são', async () => {
    let n = 0;
    const linhas = [linha('Recebedor', 90, 600), ...Array.from({ length: 6 }, (_, i) => linha(`Valor R$ ${i}0,00`, 50, 100 + i * 40))];
    await refineMoneyLines(PAGINA, linhas, async () => { n += 1; return []; });
    expect(n).toBe(4);
  });

  it('releitura que falha deixa a leitura original', async () => {
    const texto = await refineMoneyLines(PAGINA, [linha('Valor R$ 180,00', 67)], async () => { throw new Error('motor'); });
    expect(texto).toBe(PAGINA);
  });
});
