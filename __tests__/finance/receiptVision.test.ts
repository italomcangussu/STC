// @vitest-environment node
// Caso Diego (04/11): mensalidade de R$ 320 em PDF e imagem; o OCR leu R$ 320 com confiança baixa e, no PDF, "Pagador"
// como favorecido. A segunda leitura por IA confirma o que o OCR leu e corrige o favorecido.
import { describe, expect, it } from 'vitest';
import { mergeVision, needsSecondRead, parseVision, visionRead } from '../../supabase/functions/_shared/receiptVision';
import { parseReceiptText } from '../../supabase/functions/_shared/financeReceiptOcr';

const ocrDiegoImagem = { engine: 'tesseract-server', amount_cents: 32000, paid_on: '2026-11-04', payee: 'Sobral Tenis Clube', payee_document: '52393541000120',
  identifier: null, confidence: { amount: 'low', date: 'high', payee: 'high', identifier: 'none' } } as const;
const ocrDiegoPdf = { engine: 'pdfjs-server', amount_cents: 32000, paid_on: '2026-11-04', payee: 'Pagador', payee_document: null,
  identifier: 'E0000000020261104140025766704895', confidence: { amount: 'low', date: 'high', payee: 'high', identifier: 'high' } } as const;
const ia = { amount_cents: 32000, paid_on: '2026-11-04', payee: 'Sobral Tenis Clube', payee_document: '52393541000120', identifier: null, completed: true };

describe('segunda leitura do comprovante por IA', () => {
  it('só chama a IA quando o OCR ficou em dúvida ou leu um rótulo como favorecido', () => {
    expect(needsSecondRead(ocrDiegoImagem)).toBe(true);
    expect(needsSecondRead(ocrDiegoPdf)).toBe(true);
    expect(needsSecondRead({ ...ocrDiegoImagem, confidence: { amount: 'high', date: 'high', payee: 'high' } })).toBe(false);
    expect(needsSecondRead(null)).toBe(true);
  });

  it('imagem do Diego: as duas leituras concordam no valor e ele fica confiável', () => {
    const r = mergeVision(ocrDiegoImagem, ia, 'image/jpeg')!;
    expect(r.amount_cents).toBe(32000);
    expect(r.confidence).toMatchObject({ amount: 'high', date: 'high', payee: 'high' });
    expect(r.ai_checked).toBe(true);
  });

  it('PDF do Diego: o favorecido "Pagador" é trocado pelo que a IA leu', () => {
    const r = mergeVision(ocrDiegoPdf, ia, 'application/pdf')!;
    expect(r.payee).toBe('Sobral Tenis Clube');
    expect(r.payee_document).toBe('52393541000120');
    expect(r.confidence).toMatchObject({ amount: 'high', payee: 'high' });
    expect(r.identifier).toBe('E0000000020261104140025766704895');
  });

  it('OCR certo e IA discordando: fica o OCR, mas em dúvida', () => {
    const certo = { ...ocrDiegoImagem, confidence: { amount: 'high', date: 'high', payee: 'high', identifier: 'none' } };
    const r = mergeVision(certo, { ...ia, amount_cents: 18000 }, 'image/jpeg')!;
    expect(r.amount_cents).toBe(32000);
    expect((r.confidence as Record<string, string>).amount).toBe('low');
  });

  it('OCR não leu nada e a IA leu: vale a IA', () => {
    const r = mergeVision(null, ia, 'image/jpeg')!;
    expect(r).toMatchObject({ amount_cents: 32000, paid_on: '2026-11-04', engine: 'tesseract-server' });
  });

  it('IA diz que é agendamento: fica como pagamento não concluído', () => {
    const r = mergeVision(ocrDiegoImagem, { ...ia, completed: false }, 'image/jpeg')!;
    expect(r.payment_status).toBe('pending');
  });

  it('IA falhou: a leitura do OCR fica como estava', () => {
    expect(mergeVision(ocrDiegoImagem, null, 'image/jpeg')).toBe(ocrDiegoImagem);
  });

  it('resposta da IA é validada campo a campo', () => {
    expect(parseVision('{"amount_cents":32000,"paid_on":"04/11/2026","payee":"","payee_document":"52.393.541/0001-20","completed":"sim"}'))
      .toEqual({ amount_cents: 32000, paid_on: null, payee: null, payee_document: '52393541000120', identifier: null, completed: null });
    expect(parseVision('não sei')).toBeNull();
  });

  it('manda o PDF como arquivo e a imagem como imagem; erro do provedor devolve null', async () => {
    const corpos: Record<string, unknown>[] = [];
    const fetch = async (_: string, init: { body: string }) => {
      corpos.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ia) } }] }));
    };
    const deps = { apiKey: 'k', model: 'm', fetch: fetch as never };
    expect(await visionRead(new Uint8Array([1, 2]), 'application/pdf', deps)).toMatchObject({ amount_cents: 32000 });
    await visionRead(new Uint8Array([1, 2]), 'image/jpeg', deps);
    const partes = (c: Record<string, unknown>) => ((c.messages as { content: unknown }[])[1].content as { type: string }[]).map((p) => p.type);
    expect(partes(corpos[0])).toContain('file');
    expect(partes(corpos[1])).toContain('image_url');
    expect(await visionRead(new Uint8Array([1]), 'image/jpeg', { ...deps, fetch: (async () => new Response('x', { status: 500 })) as never })).toBeNull();
  });
});

it('OCR não usa o rótulo "Pagador" como favorecido', () => {
  const texto = 'Comprovante Pix\nValor\nR$ 320,00\nPara\nPagador\nDiego Parente\nData 04/11/2026 11:00';
  expect(parseReceiptText(texto).payee).not.toBe('Pagador');
});
